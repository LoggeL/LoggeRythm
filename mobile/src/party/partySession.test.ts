import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { PartyState, PartyTrack } from '../api/types';
import { strings } from '../localization';
import { PlaybackState, type PlayerSnapshot } from '../player/playerPort';
import type { PartyQueueSyncResult, PartyQueueTarget } from '../player/controller';
import type { PartyStreamHandlers } from './partyStream';
import {
  PARTY_BROADCAST_INTERVAL_MS,
  PARTY_FOLLOW_INTERVAL_MS,
  PARTY_RECONNECT_DELAYS_MS,
  PartySession,
  type PartySessionDependencies,
} from './partySession';

vi.mock('../api/client', () => {
  class FakeApiError extends Error {
    constructor(public status: number, public body: string, message: string) {
      super(message);
    }
  }
  return { ApiError: FakeApiError };
});

function entry(id: number, overrides: Partial<PartyTrack> = {}): PartyTrack {
  return {
    id,
    deezer_id: String(id * 100),
    title: `Song ${id}`,
    artist: 'Artist',
    artist_id: '1',
    artists: [{ id: '1', name: 'Artist' }],
    album: 'Album',
    album_id: '2',
    cover: '',
    duration_sec: 200,
    added_by: 'Host',
    added_by_member: 'u:1',
    added_by_avatar_url: null,
    is_stored: true,
    load_state: 'ready',
    load_error: null,
    ...overrides,
  };
}

function party(overrides: Partial<PartyState> = {}): PartyState {
  return {
    code: 'ABC123',
    name: 'Friday',
    host_name: 'Host',
    is_host: false,
    current_index: 0,
    is_playing: true,
    position_sec: 10,
    playback_updated_at: '2026-11-20T12:00:00Z',
    server_time: '2026-11-20T12:00:05Z',
    guests_can_control: false,
    playback_changed_by: 'u:1',
    playback_revision: 1,
    ended: false,
    members: [
      { key: 'u:1', name: 'Host', avatar_url: null, is_guest: false, is_host: true },
      { key: 'u:2', name: 'Me', avatar_url: null, is_guest: false, is_host: false },
    ],
    tracks: [entry(1), entry(2), entry(3)],
    viewer_key: 'u:2',
    viewer_name: 'Me',
    viewer_is_guest: false,
    ...overrides,
  };
}

const NOW = Date.parse('2026-11-20T12:00:05Z');

function snapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    revision: 1,
    isSetup: true,
    queue: [{ mediaId: 'x', url: 'u' }] as PlayerSnapshot['queue'],
    activeIndex: 0,
    playbackState: PlaybackState.Ready,
    isPlaying: true,
    progress: { position: 15, duration: 200, buffered: 0, cached: 0 },
    repeatMode: 'off' as PlayerSnapshot['repeatMode'],
    shuffleEnabled: false,
    autoRadioEnabled: false,
    playbackSpeed: 1,
    volume: 1,
    sleepTimer: null as unknown as PlayerSnapshot['sleepTimer'],
    queuePersistence: { contextShuffleEnabled: false, contextShuffleRestoreOrder: [] },
    ...overrides,
  };
}

function harness(initialActive: number | null = 1) {
  const timers: { callback: () => void; ms: number; interval: boolean; cleared: boolean }[] = [];
  const playerListeners = new Set<() => void>();
  const streams: PartyStreamHandlers[] = [];
  const state = {
    snapshot: snapshot(),
    activeItemId: initialActive,
  };
  const onTracksStored = vi.fn();
  const onPartyCodeChange = vi.fn();
  const deps = {
    repository: {
      getActiveParty: vi.fn(async (): Promise<PartyState | null> => null),
      joinParty: vi.fn(async () => party()),
      getParty: vi.fn(async () => party()),
      leaveParty: vi.fn(async () => undefined),
      endParty: vi.fn(async () => undefined),
      partyUpdateSettings: vi.fn(async (_code: string, patch: { name?: string; guests_can_control?: boolean }) =>
        party({ is_host: true, viewer_key: 'u:1', ...patch }),
      ),
      partyKickMember: vi.fn(async () => undefined),
      partyAddTrack: vi.fn(async () => undefined),
      partySetCurrent: vi.fn(async () => undefined),
      partySetPlayback: vi.fn(async () => undefined),
    },
    openStream: vi.fn(async (_code: string, handlers: PartyStreamHandlers) => {
      streams.push(handlers);
      return vi.fn();
    }),
    player: {
      subscribe: vi.fn((listener: () => void) => {
        playerListeners.add(listener);
        return () => playerListeners.delete(listener);
      }),
      getSnapshot: vi.fn(() => state.snapshot),
      play: vi.fn(),
      pause: vi.fn(),
      seekTo: vi.fn(),
    },
    syncQueue: vi.fn(async (_target: PartyQueueTarget): Promise<PartyQueueSyncResult> => 'replaced'),
    activePartyItemId: vi.fn(() => state.activeItemId),
    now: vi.fn(() => NOW),
    setTimeout: vi.fn((callback: () => void, ms: number) => {
      const timer = { callback, ms, interval: false, cleared: false };
      timers.push(timer);
      return timer;
    }),
    clearTimeout: vi.fn((handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    }),
    setInterval: vi.fn((callback: () => void, ms: number) => {
      const timer = { callback, ms, interval: true, cleared: false };
      timers.push(timer);
      return timer;
    }),
    clearInterval: vi.fn((handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    }),
    onTracksStored,
    onPartyCodeChange,
  } satisfies PartySessionDependencies;
  const session = new PartySession(deps);
  const tick = (ms: number) => {
    for (const timer of timers.filter((candidate) => candidate.ms === ms && !candidate.cleared)) {
      timer.callback();
      if (!timer.interval) timer.cleared = true;
    }
  };
  const playerChanged = () => {
    for (const listener of [...playerListeners]) listener();
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { session, deps, state, streams, timers, tick, playerChanged, settle };
}

describe('PartySession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('joins, opens the live stream and mirrors the party into the player', async () => {
    const h = harness();
    h.session.enter('ABC123');
    expect(h.session.getSnapshot()).toMatchObject({ code: 'ABC123', phase: 'joining' });
    await h.settle();

    expect(h.deps.repository.joinParty).toHaveBeenCalledWith('ABC123');
    expect(h.deps.openStream).toHaveBeenCalledWith('ABC123', expect.any(Object));
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'live', error: null, detached: false });
    expect(h.deps.syncQueue).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ABC123',
      label: 'Friday',
      currentIndex: 0,
      playing: true,
      // A follower starts where the host is now: 10 s + 5 s since the broadcast.
      startPosition: 15,
      keepLocalPlayState: false,
    }));
    expect(h.session.isFollowingParty()).toBe(true);
  });

  it('shows why joining failed and joins again on retry', async () => {
    const h = harness();
    h.deps.repository.joinParty.mockRejectedValueOnce(
      new ApiError(404, JSON.stringify({ detail: 'Party not found' }), 'not found'),
    );
    h.session.enter('ABC123');
    await h.settle();
    expect(h.session.getSnapshot()).toMatchObject({
      phase: 'join-failed',
      error: strings.party.joinFailed('Party not found'),
    });
    expect(h.deps.openStream).not.toHaveBeenCalled();

    h.session.retryJoin();
    await h.settle();
    expect(h.session.getSnapshot().phase).toBe('live');
  });

  it('marks the party stale when the stream closes and reconnects with back-off', async () => {
    const h = harness();
    h.session.enter('ABC123');
    await h.settle();
    h.streams[0].onClosed(new Error('Netz weg'));
    expect(h.session.getSnapshot()).toMatchObject({
      phase: 'stale',
      error: strings.party.loadFailed('Netz weg'),
    });
    h.tick(PARTY_RECONNECT_DELAYS_MS[0]);
    await h.settle();
    expect(h.deps.openStream).toHaveBeenCalledTimes(2);

    h.streams[1].onState(party({ current_index: 1 }));
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'live', error: null });
    expect(h.session.getSnapshot().party?.current_index).toBe(1);
  });

  it('reports a failed player sync instead of hiding it', async () => {
    const h = harness();
    h.deps.syncQueue.mockRejectedValueOnce(new Error('native queue refused'));
    h.session.enter('ABC123');
    await h.settle();
    await h.settle();
    expect(h.session.getSnapshot().playbackError).toBe(strings.party.syncFailed('native queue refused'));
  });

  it('as host broadcasts skips and play/pause, and ticks the position', async () => {
    const h = harness(1);
    const created = party({ is_host: true, viewer_key: 'u:1' });
    h.session.enter('ABC123', created);
    await h.settle();
    expect(h.deps.repository.joinParty).not.toHaveBeenCalled();
    expect(h.deps.syncQueue).toHaveBeenCalledWith(expect.objectContaining({ keepLocalPlayState: true }));

    // The track ended and the player moved on to entry 2.
    h.state.activeItemId = 2;
    h.playerChanged();
    expect(h.deps.repository.partySetCurrent).toHaveBeenCalledWith('ABC123', 1);

    // Paused locally.
    h.state.snapshot = snapshot({ isPlaying: false, progress: { position: 33, duration: 200, buffered: 0, cached: 0 } });
    h.playerChanged();
    expect(h.deps.repository.partySetPlayback).toHaveBeenLastCalledWith('ABC123', {
      is_playing: false,
      position_sec: 33,
    });

    // Buffering is not a pause.
    h.state.snapshot = snapshot({ isPlaying: false, playbackState: PlaybackState.Buffering });
    h.playerChanged();
    expect(h.deps.repository.partySetPlayback).toHaveBeenLastCalledWith('ABC123', {
      is_playing: true,
      position_sec: 15,
    });

    h.deps.repository.partySetPlayback.mockClear();
    h.state.activeItemId = 1;
    h.tick(PARTY_BROADCAST_INTERVAL_MS);
    expect(h.deps.repository.partySetPlayback).toHaveBeenCalledOnce();
  });

  it('surfaces a failed host broadcast', async () => {
    const h = harness(1);
    h.deps.repository.partySetPlayback.mockRejectedValue(new ApiError(0, '', 'offline'));
    h.session.enter('ABC123', party({ is_host: true }));
    await h.settle();
    h.tick(PARTY_BROADCAST_INTERVAL_MS);
    await h.settle();
    expect(h.session.getSnapshot().playbackError).toBe(
      strings.party.broadcastFailed(strings.party.serverUnreachable),
    );
  });

  it('pulls a follower back to the host’s play state and position', async () => {
    const h = harness(1);
    h.session.enter('ABC123');
    await h.settle();

    h.state.snapshot = snapshot({ isPlaying: false, progress: { position: 3, duration: 200, buffered: 0, cached: 0 } });
    h.tick(PARTY_FOLLOW_INTERVAL_MS);
    expect(h.deps.player.play).toHaveBeenCalledOnce();
    expect(h.deps.player.seekTo).toHaveBeenCalledWith(15);

    h.deps.player.seekTo.mockClear();
    h.state.snapshot = snapshot({ progress: { position: 15.5, duration: 200, buffered: 0, cached: 0 } });
    h.tick(PARTY_FOLLOW_INTERVAL_MS);
    expect(h.deps.player.seekTo).not.toHaveBeenCalled();

    // The follower skipped on its own: the next tick puts it back on the host's entry.
    h.deps.syncQueue.mockClear();
    h.state.activeItemId = 3;
    h.tick(PARTY_FOLLOW_INTERVAL_MS);
    expect(h.deps.syncQueue).toHaveBeenCalledOnce();
  });

  it('detaches when other music starts and follows again on request', async () => {
    const h = harness(1);
    h.session.enter('ABC123');
    await h.settle();

    h.state.activeItemId = null;
    h.playerChanged();
    expect(h.session.getSnapshot().detached).toBe(true);
    expect(h.session.isFollowingParty()).toBe(false);

    h.deps.syncQueue.mockClear();
    h.tick(PARTY_FOLLOW_INTERVAL_MS);
    expect(h.deps.syncQueue).not.toHaveBeenCalled();

    h.session.rejoinPlayback();
    await h.settle();
    expect(h.session.getSnapshot().detached).toBe(false);
    expect(h.deps.syncQueue).toHaveBeenCalledOnce();
  });

  it('leaves only after the server confirmed it and stops every timer', async () => {
    const h = harness();
    h.session.enter('ABC123');
    await h.settle();
    h.deps.repository.leaveParty.mockRejectedValueOnce(new Error('503'));
    await expect(h.session.leave()).rejects.toThrow('503');
    expect(h.session.getSnapshot().code).toBe('ABC123');

    await h.session.leave();
    expect(h.session.getSnapshot()).toMatchObject({ code: null, party: null, phase: 'idle' });
    expect(h.timers.every((timer) => timer.cleared || !timer.interval)).toBe(true);
  });

  it('adds songs for everyone and refuses a frame of another party', async () => {
    const h = harness();
    h.session.enter('ABC123');
    await h.settle();
    const song = { ...entry(9) } as never;
    await h.session.addTrack(song);
    expect(h.deps.repository.partyAddTrack).toHaveBeenCalledWith('ABC123', song);

    expect(() => h.streams[0].onState(party({ code: 'ZZZ999' }))).toThrow(
      'Party frame for ZZZ999 arrived on the ABC123 session',
    );
  });

  it('auto-restores an active Jam and wires end, settings, kick, and play-next mutations', async () => {
    const h = harness();
    const active = party({ is_host: true, viewer_key: 'u:1', name: 'Friday' });
    h.deps.repository.getActiveParty.mockResolvedValueOnce(active);

    await expect(h.session.restoreActive()).resolves.toEqual(active);
    await h.settle();
    expect(h.session.getSnapshot()).toMatchObject({ code: 'ABC123', phase: 'live' });
    expect(h.deps.onPartyCodeChange).toHaveBeenCalledWith('ABC123');

    const song = { ...entry(9) } as never;
    await h.session.addTrack(song, 'next');
    expect(h.deps.repository.partyAddTrack).toHaveBeenCalledWith('ABC123', song, 'next');

    await h.session.updateSettings({ name: 'Renamed Jam', guests_can_control: true });
    expect(h.deps.repository.partyUpdateSettings).toHaveBeenCalledWith('ABC123', {
      name: 'Renamed Jam',
      guests_can_control: true,
    });
    expect(h.session.getSnapshot().party?.guests_can_control).toBe(true);

    await h.session.kickMember('u:2');
    expect(h.deps.repository.partyKickMember).toHaveBeenCalledWith('ABC123', 'u:2');

    await h.session.end();
    expect(h.deps.repository.endParty).toHaveBeenCalledWith('ABC123');
    expect(h.session.getSnapshot()).toMatchObject({ code: null, party: null, phase: 'idle' });
    expect(h.deps.onPartyCodeChange).toHaveBeenLastCalledWith(null);
  });

  it('allows shared playback controls when guests_can_control is enabled and applies remote overrides on the host', async () => {
    const follower = harness(1);
    follower.deps.repository.joinParty.mockResolvedValueOnce(party({ guests_can_control: false }));
    follower.session.enter('ABC123');
    await follower.settle();
    await expect(follower.session.controlTogglePlay()).rejects.toThrow(
      strings.party.controlledByHost('Host'),
    );

    follower.streams[0].onState(party({ guests_can_control: true, is_playing: true }));
    await follower.settle();
    await follower.session.controlTogglePlay();
    expect(follower.deps.repository.partySetPlayback).toHaveBeenCalledWith('ABC123', {
      is_playing: false,
      position_sec: 15,
    });
    await follower.session.controlNext();
    expect(follower.deps.repository.partySetCurrent).toHaveBeenCalledWith('ABC123', 1);
    await follower.session.controlSeek(42);
    expect(follower.deps.repository.partySetPlayback).toHaveBeenLastCalledWith('ABC123', {
      is_playing: true,
      position_sec: 42,
    });

    // Host applies a newer playback_revision authored by another participant instead of keeping local state.
    const host = harness(1);
    host.deps.syncQueue.mockResolvedValue('unchanged');
    host.session.enter(
      'ABC123',
      party({ is_host: true, viewer_key: 'u:1', guests_can_control: true, playback_revision: 1 }),
    );
    await host.settle();
    host.deps.syncQueue.mockClear();
    host.deps.player.pause.mockClear();
    host.deps.player.seekTo.mockClear();

    host.streams[0].onState(
      party({
        is_host: true,
        viewer_key: 'u:1',
        guests_can_control: true,
        is_playing: false,
        position_sec: 60,
        playback_changed_by: 'u:2',
        playback_revision: 2,
      }),
    );
    await host.settle();
    expect(host.deps.syncQueue).toHaveBeenCalledWith(expect.objectContaining({ keepLocalPlayState: false }));
    expect(host.deps.player.pause).toHaveBeenCalledOnce();
    expect(host.deps.player.seekTo).toHaveBeenCalledWith(60);
  });

  it('handles terminal ended frames, kicked removal, control-only mode, and stored-track invalidation', async () => {
    const h = harness(1);
    h.deps.repository.joinParty.mockResolvedValueOnce(
      party({ tracks: [entry(1, { is_stored: false, load_state: 'idle' })] }),
    );
    h.session.enter('ABC123');
    await h.settle();
    expect(h.deps.onTracksStored).not.toHaveBeenCalled();

    // Track transitions to stored -> notifies cache invalidator once.
    h.streams[0].onState(party({ tracks: [entry(1, { is_stored: true, load_state: 'ready' })] }));
    expect(h.deps.onTracksStored).toHaveBeenCalledWith(['100']);

    // Control-only pauses local audio and suppresses follow sync.
    h.session.setControlOnly(true);
    expect(h.deps.player.pause).toHaveBeenCalledOnce();
    expect(h.session.getSnapshot().controlOnly).toBe(true);
    h.deps.syncQueue.mockClear();
    h.state.activeItemId = 999;
    h.tick(PARTY_FOLLOW_INTERVAL_MS);
    expect(h.deps.syncQueue).not.toHaveBeenCalled();

    // Host ends Jam -> clears session and surfaces loud notice.
    h.streams[0].onState(party({ ended: true }));
    expect(h.session.getSnapshot()).toMatchObject({
      code: null,
      party: null,
      phase: 'idle',
      endedNotice: strings.party.endedNotice,
    });
    h.session.dismissEndedNotice();
    expect(h.session.getSnapshot().endedNotice).toBeNull();

    // Kicked participant -> clears session and surfaces kicked notice.
    const kicked = harness(1);
    kicked.session.enter('ABC123');
    await kicked.settle();
    kicked.streams[0].onState(
      party({
        members: [{ key: 'u:1', name: 'Host', avatar_url: null, is_guest: false, is_host: true }],
      }),
    );
    expect(kicked.session.getSnapshot()).toMatchObject({
      code: null,
      party: null,
      phase: 'idle',
      endedNotice: strings.party.kickedNotice,
    });
  });

  it('ignores self-triggered SSE frames while leaving or ending so no stale endedNotice remains', async () => {
    // 1. Member leaves and SSE delivers the removal frame before leaveParty resolves.
    const leaving = harness(1);
    leaving.session.enter('ABC123');
    await leaving.settle();
    leaving.deps.repository.leaveParty.mockImplementationOnce(async () => {
      leaving.streams[0].onState(
        party({
          members: [{ key: 'u:1', name: 'Host', avatar_url: null, is_guest: false, is_host: true }],
        }),
      );
    });
    await leaving.session.leave();
    expect(leaving.session.getSnapshot()).toMatchObject({
      code: null,
      party: null,
      phase: 'idle',
      endedNotice: null,
    });

    // 2. Host ends Jam and SSE delivers ended=true before endParty resolves.
    const ending = harness(1);
    ending.session.enter('ABC123', party({ is_host: true, viewer_key: 'u:1' }));
    await ending.settle();
    ending.deps.repository.endParty.mockImplementationOnce(async () => {
      ending.streams[0].onState(party({ is_host: true, viewer_key: 'u:1', ended: true }));
    });
    await ending.session.end();
    expect(ending.session.getSnapshot()).toMatchObject({
      code: null,
      party: null,
      phase: 'idle',
      endedNotice: null,
    });

    // 3. Failed leave restores SSE frame processing and rejects loudly.
    const failing = harness(1);
    failing.session.enter('ABC123');
    await failing.settle();
    failing.deps.repository.leaveParty.mockRejectedValueOnce(new Error('503'));
    await expect(failing.session.leave()).rejects.toThrow('503');
    failing.streams[0].onState(party({ ended: true }));
    expect(failing.session.getSnapshot().endedNotice).toBe(strings.party.endedNotice);
  });
});
