import { useSyncExternalStore } from 'react';
import type { PartySettingsUpdateRequest, PartyTrackInsertMode } from '../api/endpoints';
import type { PartyState, Track } from '../api/types';
import { strings } from '../localization';
import { PlaybackState, type PlayerSnapshot } from '../player/playerPort';
import type { PartyQueueSyncResult, PartyQueueTarget } from '../player/controller';
import { partyErrorDetail } from './partyErrors';
import {
  canControlPartyPlayback,
  expectedHostPosition,
  isPartyTrackStored,
  isViewerKickedFromParty,
  MAX_PARTY_DRIFT_SEC,
  partyDisplayName,
  partyQueueEntries,
} from './partyModel';
import type { PartyStreamHandlers } from './partyStream';

/** Host broadcast cadence; guests extrapolate between broadcasts. */
export const PARTY_BROADCAST_INTERVAL_MS = 3_000;
/** How often a following member compares its player with the host. */
export const PARTY_FOLLOW_INTERVAL_MS = 1_000;
/** Safety refetch in case the live stream stalls without closing. */
export const PARTY_POLL_INTERVAL_MS = 20_000;
/** Reconnect delays after the live stream closes; the last one repeats. */
export const PARTY_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

export type PartyPhase = 'idle' | 'joining' | 'join-failed' | 'live' | 'stale';

export interface PartySessionSnapshot {
  code: string | null;
  party: PartyState | null;
  phase: PartyPhase;
  /** Why joining failed (join-failed) or why the shown party is out of date (stale). */
  error: string | null;
  /** The player plays something else; the party continues without this device. */
  detached: boolean;
  /** Non-host member explicitly muted local audio to control the Jam without echo. */
  controlOnly: boolean;
  /** The last failed player sync or host broadcast; cleared by the next success. */
  playbackError: string | null;
  /** Loud terminal notice when the host ends the Jam or removes this participant. */
  endedNotice: string | null;
}

export interface PartySessionRepository {
  getActiveParty?(): Promise<PartyState | null>;
  joinParty(code: string): Promise<PartyState>;
  getParty(code: string): Promise<PartyState>;
  leaveParty(code: string): Promise<void>;
  endParty?(code: string): Promise<void>;
  partyUpdateSettings?(code: string, patch: PartySettingsUpdateRequest): Promise<PartyState>;
  partyKickMember?(code: string, memberKey: string): Promise<void>;
  partyAddTrack(code: string, track: Track, insert?: PartyTrackInsertMode): Promise<void>;
  partySetCurrent(code: string, index: number): Promise<void>;
  partySetPlayback(code: string, update: { is_playing: boolean; position_sec: number }): Promise<void>;
}

export interface PartySessionPlayer {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Readonly<PlayerSnapshot>;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
}

export interface PartySessionDependencies {
  repository: PartySessionRepository;
  openStream(code: string, handlers: PartyStreamHandlers): Promise<() => void>;
  player: PartySessionPlayer;
  syncQueue(target: PartyQueueTarget): Promise<PartyQueueSyncResult>;
  activePartyItemId(code: string): number | null;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** Invoked whenever one or more party track deezer_ids transition to server-stored. */
  onTracksStored?(deezerIds: readonly string[]): void;
  /** Invoked when the active party code changes (for Connect presence metadata). */
  onPartyCodeChange?(code: string | null): void;
}

const IDLE: PartySessionSnapshot = Object.freeze({
  code: null,
  party: null,
  phase: 'idle',
  error: null,
  detached: false,
  controlOnly: false,
  playbackError: null,
  endedNotice: null,
});

/** The local player wants to play (Media3 reports buffering as not playing). */
function intendsToPlay(snapshot: Readonly<PlayerSnapshot>): boolean {
  return snapshot.isPlaying || snapshot.playbackState === PlaybackState.Buffering;
}

function currentItemId(party: PartyState): number | null {
  return party.current_index < 0 ? null : party.tracks[party.current_index]?.id ?? null;
}

interface Engine {
  code: string;
  closeStream: (() => void) | null;
  reconnectTimer: unknown;
  reconnectAttempt: number;
  pollTimer: unknown;
  followTimer: unknown;
  broadcastTimer: unknown;
  unsubscribePlayer: (() => void) | null;
  syncing: boolean;
  syncQueued: boolean;
  synced: boolean;
  lastActiveItemId: number | null;
  lastIntent: boolean | null;
  lastAppliedPlaybackRevision: number;
  forceApplyRemotePlayback: boolean;
  knownStoredIds: Set<string>;
  stopped: boolean;
}

/**
 * One Jam/party at a time, app-wide: joins, keeps the live stream open (with
 * reconnects and a slow safety poll), mirrors the party queue into the native
 * player, broadcasts the host's playback, resolves shared-control revisions
 * from participants, and pulls followers back to the host.
 * Every failure is published on the snapshot; nothing is hidden silently.
 */
export class PartySession {
  private state: PartySessionSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private engine: Engine | null = null;

  constructor(private readonly deps: PartySessionDependencies) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PartySessionSnapshot => this.state;

  activePartyCode(): string | null {
    return this.state.party === null ? null : this.state.code;
  }

  isHost(): boolean {
    return this.state.party?.is_host === true;
  }

  isControlOnly(): boolean {
    return this.state.controlOnly;
  }

  /** True while the app follows an active party (queue actions route to the Jam). */
  isFollowingParty(): boolean {
    return this.state.code !== null && this.state.party !== null && !this.state.detached;
  }

  canControlPlayback(): boolean {
    return this.state.party !== null && canControlPartyPlayback(this.state.party);
  }

  /**
   * Open a party. `created` is the state returned when this device just
   * started it (no separate join needed).
   */
  enter(code: string, created?: PartyState): void {
    if (this.engine !== null && this.engine.code === code && this.state.phase !== 'join-failed') return;
    this.stopEngine();
    const engine = this.createEngine(code);
    this.engine = engine;
    if (created !== undefined) {
      if (created.code !== code) {
        throw new Error(`Created party ${created.code} does not match the opened code ${code}`);
      }
      this.publish({ ...IDLE, code, party: created, phase: 'live' });
      this.notifyPartyCode(code);
      this.startLive(engine);
      this.applyFrame(engine, created);
      return;
    }
    this.publish({ ...IDLE, code, phase: 'joining' });
    void this.join(engine);
  }

  /** Restore an active party for the signed-in user on app launch/focus. */
  async restoreActive(): Promise<PartyState | null> {
    if (this.deps.repository.getActiveParty === undefined) {
      throw new Error('PartySession repository does not implement getActiveParty');
    }
    const active = await this.deps.repository.getActiveParty();
    if (active === null || active.ended) return null;
    if (this.engine === null) {
      this.enter(active.code, active);
    }
    return active;
  }

  retryJoin(): void {
    const code = this.state.code;
    if (code === null) throw new Error('There is no party to join again');
    this.stopEngine();
    const engine = this.createEngine(code);
    this.engine = engine;
    this.publish({ ...this.state, phase: 'joining', error: null, endedNotice: null });
    void this.join(engine);
  }

  /** Refetch the party now; resolves once fresh state is shown, rejects on failure. */
  async reload(): Promise<void> {
    const engine = this.requireEngine();
    try {
      const party = await this.deps.repository.getParty(engine.code);
      if (this.engine !== engine) return;
      this.applyFrame(engine, party);
    } catch (error) {
      if (this.engine === engine) this.markStale(strings.party.loadFailed(partyErrorDetail(error)));
      throw error;
    }
  }

  /** Leave on the server first; the session ends only once the server confirmed it. */
  async leave(): Promise<void> {
    const engine = this.requireEngine();
    await this.deps.repository.leaveParty(engine.code);
    if (this.engine !== engine) return;
    this.stopEngine();
    this.publish(IDLE);
    this.notifyPartyCode(null);
  }

  /** End the Jam for everyone (host only); ends locally only after server confirms 204. */
  async end(): Promise<void> {
    const engine = this.requireEngine();
    if (this.deps.repository.endParty === undefined) {
      throw new Error('PartySession repository does not implement endParty');
    }
    await this.deps.repository.endParty(engine.code);
    if (this.engine !== engine) return;
    this.stopEngine();
    this.publish(IDLE);
    this.notifyPartyCode(null);
  }

  /** Update Jam settings (name / guests_can_control) as host. */
  async updateSettings(patch: PartySettingsUpdateRequest): Promise<PartyState> {
    const engine = this.requireEngine();
    if (this.deps.repository.partyUpdateSettings === undefined) {
      throw new Error('PartySession repository does not implement partyUpdateSettings');
    }
    const updated = await this.deps.repository.partyUpdateSettings(engine.code, patch);
    if (this.engine === engine) this.applyFrame(engine, updated);
    return updated;
  }

  /** Remove a participant from the Jam (host only). */
  async kickMember(memberKey: string): Promise<void> {
    const engine = this.requireEngine();
    if (this.deps.repository.partyKickMember === undefined) {
      throw new Error('PartySession repository does not implement partyKickMember');
    }
    await this.deps.repository.partyKickMember(engine.code, memberKey);
  }

  /** Non-host listen mode toggle: control-only keeps local audio paused to prevent echo. */
  setControlOnly(enabled: boolean): void {
    const engine = this.requireEngine();
    const party = this.state.party;
    if (party === null || party.is_host) {
      throw new Error('Control-only mode is only available for non-host participants');
    }
    if (this.state.controlOnly === enabled) return;
    if (enabled) {
      if (this.deps.activePartyItemId(engine.code) !== null) {
        this.deps.player.pause();
      }
      this.publish({ ...this.state, controlOnly: true, detached: false, playbackError: null });
      return;
    }
    engine.synced = false;
    engine.lastActiveItemId = null;
    engine.lastIntent = null;
    this.publish({ ...this.state, controlOnly: false, detached: false, playbackError: null });
    this.scheduleSync(engine);
  }

  /** Follow the party again after the player was used for other music. */
  rejoinPlayback(): void {
    const engine = this.requireEngine();
    engine.synced = false;
    engine.lastActiveItemId = null;
    engine.lastIntent = null;
    this.publish({ ...this.state, detached: false, controlOnly: false, playbackError: null });
    this.scheduleSync(engine);
  }

  dismissEndedNotice(): void {
    if (this.state.endedNotice === null) return;
    this.publish({ ...this.state, endedNotice: null });
  }

  /** Add a song for everyone (track actions route here while following a party). */
  async addTrack(track: Track, insert?: PartyTrackInsertMode): Promise<void> {
    const engine = this.requireEngine();
    if (insert === undefined) {
      await this.deps.repository.partyAddTrack(engine.code, track);
    } else {
      await this.deps.repository.partyAddTrack(engine.code, track, insert);
    }
  }

  /** Play/pause the Jam (host or participant when guests_can_control is true). */
  async controlTogglePlay(): Promise<void> {
    const engine = this.requireEngine();
    const party = this.requireControllableParty();
    if (party.current_index < 0 || party.tracks[party.current_index] === undefined) {
      throw new Error('There is no active track in this Jam');
    }
    if (party.is_host && !this.state.detached && !this.state.controlOnly) {
      const snap = this.deps.player.getSnapshot();
      const nextPlaying = !intendsToPlay(snap);
      if (nextPlaying) this.deps.player.play();
      else this.deps.player.pause();
      await this.deps.repository.partySetPlayback(engine.code, {
        is_playing: nextPlaying,
        position_sec: Math.max(0, snap.progress.position),
      });
      return;
    }
    const position = expectedHostPosition(party, this.deps.now());
    await this.deps.repository.partySetPlayback(engine.code, {
      is_playing: !party.is_playing,
      position_sec: position,
    });
  }

  /** Skip to the next track in the Jam. */
  async controlNext(): Promise<void> {
    const engine = this.requireEngine();
    const party = this.requireControllableParty();
    const nextIndex = party.current_index + 1;
    if (nextIndex < 0 || nextIndex >= party.tracks.length) return;
    await this.deps.repository.partySetCurrent(engine.code, nextIndex);
  }

  /** Restart current track (> 3s) or skip to the previous track in the Jam. */
  async controlPrev(): Promise<void> {
    const engine = this.requireEngine();
    const party = this.requireControllableParty();
    if (party.current_index < 0) return;
    const position = party.is_host && !this.state.detached && !this.state.controlOnly
      ? Math.max(0, this.deps.player.getSnapshot().progress.position)
      : expectedHostPosition(party, this.deps.now());
    if (position > 3 || party.current_index === 0) {
      if (party.is_host && !this.state.detached && !this.state.controlOnly) {
        this.deps.player.seekTo(0);
      }
      await this.deps.repository.partySetPlayback(engine.code, {
        is_playing: party.is_playing,
        position_sec: 0,
      });
      return;
    }
    await this.deps.repository.partySetCurrent(engine.code, party.current_index - 1);
  }

  /** Seek within the current Jam track. */
  async controlSeek(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new RangeError(`Jam seek position must be non-negative and finite, got ${seconds}`);
    }
    const engine = this.requireEngine();
    const party = this.requireControllableParty();
    if (party.current_index < 0) return;
    if (party.is_host && !this.state.detached && !this.state.controlOnly) {
      this.deps.player.seekTo(seconds);
    }
    await this.deps.repository.partySetPlayback(engine.code, {
      is_playing: party.is_playing,
      position_sec: seconds,
    });
  }

  /** Forget the party locally (logout / account switch); does not leave on the server. */
  reset(): void {
    const hadCode = this.state.code !== null;
    this.stopEngine();
    this.publish(IDLE);
    if (hadCode) this.notifyPartyCode(null);
  }

  private requireEngine(): Engine {
    if (this.engine === null) throw new Error('No party is open');
    return this.engine;
  }

  private requireControllableParty(): PartyState {
    const party = this.state.party;
    if (party === null) throw new Error('No party state is loaded');
    if (!canControlPartyPlayback(party)) {
      throw new Error(strings.party.controlledByHost(party.host_name));
    }
    return party;
  }

  private notifyPartyCode(code: string | null): void {
    this.deps.onPartyCodeChange?.(code);
  }

  private publish(next: PartySessionSnapshot): void {
    this.state = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }

  private createEngine(code: string): Engine {
    return {
      code,
      closeStream: null,
      reconnectTimer: null,
      reconnectAttempt: 0,
      pollTimer: null,
      followTimer: null,
      broadcastTimer: null,
      unsubscribePlayer: null,
      syncing: false,
      syncQueued: false,
      synced: false,
      lastActiveItemId: null,
      lastIntent: null,
      lastAppliedPlaybackRevision: -1,
      forceApplyRemotePlayback: false,
      knownStoredIds: new Set<string>(),
      stopped: false,
    };
  }

  private stopEngine(): void {
    const engine = this.engine;
    if (engine === null) return;
    engine.stopped = true;
    engine.closeStream?.();
    engine.closeStream = null;
    if (engine.reconnectTimer !== null) this.deps.clearTimeout(engine.reconnectTimer);
    if (engine.pollTimer !== null) this.deps.clearInterval(engine.pollTimer);
    if (engine.followTimer !== null) this.deps.clearInterval(engine.followTimer);
    if (engine.broadcastTimer !== null) this.deps.clearInterval(engine.broadcastTimer);
    engine.unsubscribePlayer?.();
    this.engine = null;
  }

  private async join(engine: Engine): Promise<void> {
    let party: PartyState;
    try {
      party = await this.deps.repository.joinParty(engine.code);
    } catch (error) {
      if (this.engine !== engine) return;
      this.publish({
        ...IDLE,
        code: engine.code,
        phase: 'join-failed',
        error: strings.party.joinFailed(partyErrorDetail(error)),
      });
      return;
    }
    if (this.engine !== engine) return;
    this.publish({ ...this.state, party, phase: 'live', error: null, endedNotice: null });
    this.notifyPartyCode(engine.code);
    this.startLive(engine);
    this.applyFrame(engine, party);
  }

  private startLive(engine: Engine): void {
    void this.connect(engine);
    engine.pollTimer = this.deps.setInterval(() => {
      this.reload().catch(() => {
        // reload() already published the stale state with its cause.
      });
    }, PARTY_POLL_INTERVAL_MS);
    engine.followTimer = this.deps.setInterval(() => this.follow(engine), PARTY_FOLLOW_INTERVAL_MS);
    engine.broadcastTimer = this.deps.setInterval(
      () => this.broadcastTick(engine),
      PARTY_BROADCAST_INTERVAL_MS,
    );
    engine.unsubscribePlayer = this.deps.player.subscribe(() => this.onPlayerChange(engine));
  }

  private async connect(engine: Engine): Promise<void> {
    let close: () => void;
    try {
      close = await this.deps.openStream(engine.code, {
        onState: (party) => {
          if (this.engine !== engine) return;
          engine.reconnectAttempt = 0;
          this.applyFrame(engine, party);
        },
        onClosed: (error) => {
          if (this.engine !== engine) return;
          engine.closeStream = null;
          this.markStale(strings.party.loadFailed(error.message));
          this.scheduleReconnect(engine);
        },
        onRenew: () => {
          if (this.engine !== engine) return;
          engine.closeStream = null;
          void this.connect(engine);
        },
      });
    } catch (error) {
      if (this.engine !== engine) return;
      this.markStale(strings.party.loadFailed(partyErrorDetail(error)));
      this.scheduleReconnect(engine);
      return;
    }
    if (this.engine !== engine || engine.stopped) {
      close();
      return;
    }
    engine.closeStream = close;
  }

  private scheduleReconnect(engine: Engine): void {
    const delays = PARTY_RECONNECT_DELAYS_MS;
    const delay = delays[Math.min(engine.reconnectAttempt, delays.length - 1)];
    engine.reconnectAttempt += 1;
    engine.reconnectTimer = this.deps.setTimeout(() => {
      engine.reconnectTimer = null;
      if (this.engine === engine) void this.connect(engine);
    }, delay);
  }

  private markStale(error: string): void {
    if (this.state.party === null) return;
    this.publish({ ...this.state, phase: 'stale', error });
  }

  private terminateWithNotice(engine: Engine, notice: string): void {
    if (this.deps.activePartyItemId(engine.code) !== null) {
      this.deps.player.pause();
    }
    this.stopEngine();
    this.publish({ ...IDLE, endedNotice: notice });
    this.notifyPartyCode(null);
  }

  private applyFrame(engine: Engine, party: PartyState): void {
    if (party.code !== engine.code) {
      throw new Error(`Party frame for ${party.code} arrived on the ${engine.code} session`);
    }
    if (party.ended) {
      this.terminateWithNotice(engine, strings.party.endedNotice);
      return;
    }
    if (isViewerKickedFromParty(party)) {
      this.terminateWithNotice(engine, strings.party.kickedNotice);
      return;
    }

    const newlyStored: string[] = [];
    for (const entry of party.tracks) {
      if (isPartyTrackStored(entry) && !engine.knownStoredIds.has(entry.deezer_id)) {
        engine.knownStoredIds.add(entry.deezer_id);
        newlyStored.push(entry.deezer_id);
      }
    }
    if (newlyStored.length > 0) {
      this.deps.onTracksStored?.(newlyStored);
    }

    const remoteHostOverride =
      party.is_host
      && engine.lastAppliedPlaybackRevision >= 0
      && party.playback_revision > engine.lastAppliedPlaybackRevision
      && party.playback_changed_by !== ''
      && party.playback_changed_by !== party.viewer_key;
    if (remoteHostOverride) {
      engine.forceApplyRemotePlayback = true;
    }
    engine.lastAppliedPlaybackRevision = Math.max(
      engine.lastAppliedPlaybackRevision,
      party.playback_revision,
    );

    this.publish({
      ...this.state,
      party,
      phase: 'live',
      error: null,
      endedNotice: null,
      // Hosts always own audio playback locally (never stuck in control-only).
      controlOnly: party.is_host ? false : this.state.controlOnly,
    });
    this.scheduleSync(engine);
  }

  private target(party: PartyState, forceRemotePlayback: boolean): PartyQueueTarget {
    const keepLocal = party.is_host && !forceRemotePlayback;
    return {
      code: party.code,
      label: partyDisplayName(party),
      entries: partyQueueEntries(party),
      currentIndex: party.current_index,
      startPosition: keepLocal ? party.position_sec : expectedHostPosition(party, this.deps.now()),
      playing: party.is_playing,
      // Normally the host's player is the authority for play/pause, EXCEPT when
      // another participant explicitly mutated playback under guests_can_control.
      keepLocalPlayState: keepLocal,
    };
  }

  /** Serialised, latest-wins mirror of the party queue into the player. */
  private scheduleSync(engine: Engine): void {
    if (this.state.detached || this.state.controlOnly) return;
    if (engine.syncing) {
      engine.syncQueued = true;
      return;
    }
    engine.syncing = true;
    void (async () => {
      try {
        do {
          engine.syncQueued = false;
          const party = this.state.party;
          if (
            party === null
            || this.engine !== engine
            || this.state.detached
            || this.state.controlOnly
          ) {
            return;
          }
          const forceRemote = engine.forceApplyRemotePlayback;
          engine.forceApplyRemotePlayback = false;
          const result = await this.deps.syncQueue(this.target(party, forceRemote));
          if (this.engine !== engine) return;
          if (forceRemote && result === 'unchanged' && party.current_index >= 0) {
            const snap = this.deps.player.getSnapshot();
            const wants = intendsToPlay(snap);
            if (party.is_playing && !wants) this.deps.player.play();
            else if (!party.is_playing && wants) this.deps.player.pause();
            const expected = expectedHostPosition(party, this.deps.now());
            if (Math.abs(snap.progress.position - expected) > MAX_PARTY_DRIFT_SEC) {
              this.deps.player.seekTo(expected);
            }
          }
          engine.synced = true;
          engine.lastActiveItemId = this.deps.activePartyItemId(engine.code);
          engine.lastIntent = intendsToPlay(this.deps.player.getSnapshot());
          if (this.state.playbackError !== null) this.publish({ ...this.state, playbackError: null });
        } while (engine.syncQueued);
      } catch (error) {
        if (this.engine === engine) {
          this.publish({ ...this.state, playbackError: strings.party.syncFailed(partyErrorDetail(error)) });
        }
      } finally {
        engine.syncing = false;
      }
    })();
  }

  private onPlayerChange(engine: Engine): void {
    const party = this.state.party;
    if (this.engine !== engine || party === null || this.state.detached || this.state.controlOnly) {
      return;
    }
    if (engine.syncing || !engine.synced) return;
    const snapshot = this.deps.player.getSnapshot();
    const itemId = this.deps.activePartyItemId(engine.code);
    if (snapshot.queue.length > 0 && itemId === null) {
      // Other music was started on this device: stop steering its player.
      this.publish({ ...this.state, detached: true, playbackError: null });
      return;
    }
    if (!party.is_host) return;
    if (itemId !== null && itemId !== engine.lastActiveItemId) {
      engine.lastActiveItemId = itemId;
      if (itemId !== currentItemId(party)) {
        const index = party.tracks.findIndex((entry) => entry.id === itemId);
        if (index === -1) {
          this.publish({
            ...this.state,
            playbackError: strings.party.syncFailed(
              `The player is on party entry ${itemId}, which the party does not list`,
            ),
          });
          return;
        }
        this.report(this.deps.repository.partySetCurrent(engine.code, index), strings.party.broadcastFailed);
      }
    }
    const intent = intendsToPlay(snapshot);
    if (intent !== engine.lastIntent) {
      engine.lastIntent = intent;
      this.broadcast(engine, snapshot);
    }
  }

  private broadcastTick(engine: Engine): void {
    const party = this.state.party;
    if (
      this.engine !== engine
      || party === null
      || !party.is_host
      || this.state.detached
      || this.state.controlOnly
    ) {
      return;
    }
    if (engine.syncing || !engine.synced) return;
    const itemId = this.deps.activePartyItemId(engine.code);
    if (itemId === null || itemId !== currentItemId(party)) return;
    this.broadcast(engine, this.deps.player.getSnapshot());
  }

  private broadcast(engine: Engine, snapshot: Readonly<PlayerSnapshot>): void {
    const party = this.state.party;
    if (party === null || party.current_index < 0) return;
    this.report(
      this.deps.repository.partySetPlayback(engine.code, {
        is_playing: intendsToPlay(snapshot),
        position_sec: Math.max(0, snapshot.progress.position),
      }),
      strings.party.broadcastFailed,
    );
  }

  /** Followers: track the host's entry, play state and position. */
  private follow(engine: Engine): void {
    const party = this.state.party;
    if (
      this.engine !== engine
      || party === null
      || party.is_host
      || this.state.detached
      || this.state.controlOnly
    ) {
      return;
    }
    if (engine.syncing || !engine.synced) return;
    const current = currentItemId(party);
    if (current === null) return;
    if (this.deps.activePartyItemId(engine.code) !== current) {
      this.scheduleSync(engine);
      return;
    }
    const snapshot = this.deps.player.getSnapshot();
    const wants = intendsToPlay(snapshot);
    if (party.is_playing && !wants) this.deps.player.play();
    else if (!party.is_playing && wants) this.deps.player.pause();
    if (snapshot.playbackState !== PlaybackState.Ready) return;
    const expected = expectedHostPosition(party, this.deps.now());
    const duration = snapshot.progress.duration;
    if (duration > 0 && expected >= duration) return;
    if (Math.abs(snapshot.progress.position - expected) > MAX_PARTY_DRIFT_SEC) {
      this.deps.player.seekTo(expected);
    }
  }

  private report(request: Promise<void>, message: (detail: string) => string): void {
    const engine = this.engine;
    request.then(
      () => {
        if (this.engine === engine && this.state.playbackError !== null) {
          this.publish({ ...this.state, playbackError: null });
        }
      },
      (error: unknown) => {
        if (this.engine === engine) {
          this.publish({ ...this.state, playbackError: message(partyErrorDetail(error)) });
        }
      },
    );
  }
}

/** Subscribe a component to a session's snapshot. */
export function usePartySessionSnapshot(session: PartySession): PartySessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
