import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ConnectPlaybackState,
  PartyStart,
  Track,
  TrackTransition,
  TrackTransitionEnd,
  TrackTransitionKind,
} from "@/types";
import { readLocalJsonSnapshot, writeLocalJsonValue } from "@/hooks/useLocalJson";
import {
  clearUpcomingItems,
  demoteOvertakenManualItems,
  insertManualItem,
  moveQueueItem,
  removeQueueItem,
  toggleQueueShuffle,
  type QueueOrigin,
} from "./queuePolicy";

export type { QueueOrigin } from "./queuePolicy";
export type {
  TrackTransition,
  TrackTransitionEnd,
  TrackTransitionKind,
  TrackTransitionOutcome,
} from "@/types";

export interface StartTransitionInput {
  kind: TrackTransitionKind;
  outgoing: Track;
  incoming: Track;
  outgoingIndex: number;
  incomingIndex: number;
  startedAtMs: number;
  durationMs: number;
  progress?: number;
}

export type RepeatMode = "off" | "all" | "one";

export interface PartyBridge {
  addToQueue: (t: Track) => void;
  playNext?: (t: Track) => void;
  removeAt: (i: number) => void;
  reorder: (from: number, to: number) => void;
  setCurrent: (i: number) => void;
  /** Optional playback interceptors used for non-host Jam participants. */
  toggle?: () => void;
  play?: () => void;
  pause?: () => void;
  seek?: (t: number) => void;
}

export interface RemotePlaybackBridge {
  playTrack: (track: Track) => void;
  playQueue: (tracks: Track[], startIndex?: number, context?: string) => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (i: number) => void;
  clearQueue: () => void;
  reorderQueue: (from: number, to: number) => void;
  jumpTo: (i: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

const RECENT_KEY = "sf_recent_tracks";
const RECENT_MAX = 30;
const EMPTY_RECENT: Track[] = [];

/** Validates a track list read back from localStorage; `source` names the stored value in the error. */
export function assertStoredTracks(source: string, value: unknown, expected: string): asserts value is Track[] {
  if (!Array.isArray(value)) {
    throw new Error(`Lokale Daten "${source}": ${expected} wurde erwartet.`);
  }
  for (const [index, track] of value.entries()) {
    if (
      !track || typeof track !== "object" ||
      typeof track.id !== "string" || track.id.trim() === "" ||
      typeof track.title !== "string" ||
      typeof track.artist !== "string" ||
      typeof track.album !== "string" ||
      typeof track.cover !== "string" ||
      typeof track.duration_sec !== "number" || !Number.isFinite(track.duration_sec) || track.duration_sec < 0 ||
      (track.artists !== undefined && (!Array.isArray(track.artists) || track.artists.some((artist: unknown) =>
        !artist || typeof artist !== "object" || !("id" in artist) ||
        (typeof artist.id !== "string" && typeof artist.id !== "number") ||
        !("name" in artist) || typeof artist.name !== "string")))
    ) {
      throw new Error(`Lokale Daten "${source}": Titel an Position ${index + 1} hat ein ungültiges Format.`);
    }
  }
}

export function assertRecentTracks(value: unknown): asserts value is Track[] {
  assertStoredTracks(RECENT_KEY, value, "Eine Liste zuletzt gehörter Titel");
}

function pushRecent(track: Track) {
  if (typeof window === "undefined") return;
  assertRecentTracks([track]);
  const list = getRecentTracks();
  const next = [track, ...list.filter((t) => String(t.id) !== String(track.id))].slice(0, RECENT_MAX);
  writeLocalJsonValue(RECENT_KEY, next);
}

export function getRecentTracks(): Track[] {
  const list = readLocalJsonSnapshot(RECENT_KEY, EMPTY_RECENT);
  assertRecentTracks(list);
  return list;
}

// Two-level queue: every queue entry carries an origin. "manual" tracks were
// added manually ("Zur Warteschlange hinzufügen" / "Als Nächstes spielen") and
// form the primary queue; "context" tracks come from a playlist/album/radio and
// form the secondary queue. Invariant for upcoming tracks (index > current):
// all "manual" entries come before any "context" entry, so manual additions
// always play first.
function fillOrigins(n: number, origin: QueueOrigin): QueueOrigin[] {
  return new Array(Math.max(0, n)).fill(origin);
}

let nextTransitionId = 1;

function nowMonotonicMs(): number {
  if (typeof performance === "undefined" || typeof performance.now !== "function") {
    throw new Error("performance.now() ist in dieser Umgebung nicht verfügbar.");
  }
  const now = performance.now();
  if (!Number.isFinite(now)) {
    throw new Error(`Ungültiger monotoner Zeitstempel: ${String(now)}.`);
  }
  return now;
}

function assertValidTransitionKind(kind: unknown): asserts kind is TrackTransitionKind {
  if (kind !== "crossfade" && kind !== "smart-crossfade") {
    throw new RangeError(`Unsupported track transition kind: ${String(kind)}.`);
  }
}

function assertValidTransitionId(id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new RangeError(`Transition id must be a positive integer; received ${id}.`);
  }
}

function assertValidTransitionProgress(progress: number, label = "Transition progress"): void {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError(`${label} must be in [0, 1]; received ${progress}.`);
  }
}

function assertValidTransitionTiming(startedAtMs: number, durationMs: number): void {
  if (!Number.isFinite(startedAtMs)) {
    throw new RangeError(`Transition startedAtMs must be finite; received ${startedAtMs}.`);
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`Transition durationMs must be positive; received ${durationMs}.`);
  }
}

function cancelledTransitionPatch(
  transition: TrackTransition | null,
  endedAtMs?: number,
): { transition: null; lastTransitionEnd: TrackTransitionEnd | null } {
  if (!transition) {
    return { transition: null, lastTransitionEnd: null };
  }
  return {
    transition: null,
    lastTransitionEnd: {
      id: transition.id,
      kind: transition.kind,
      outcome: "cancelled",
      outgoing: transition.outgoing,
      incoming: transition.incoming,
      endedAtMs: endedAtMs ?? nowMonotonicMs(),
    },
  };
}

function transitionMatchesQueueState(
  transition: TrackTransition,
  queue: readonly Track[],
  index: number,
  isPlaying: boolean,
  repeat: RepeatMode,
  sleepAfterTrack: boolean,
): boolean {
  if (!isPlaying || repeat === "one" || sleepAfterTrack) return false;
  if (index !== transition.outgoingIndex) return false;
  if (transition.incomingIndex < 0 || transition.incomingIndex >= queue.length) return false;
  if (String(queue[index]?.id ?? "") !== String(transition.outgoing.id)) return false;
  if (String(queue[transition.incomingIndex]?.id ?? "") !== String(transition.incoming.id)) {
    return false;
  }
  return true;
}

function reconcileTransitionPatch(
  prev: Pick<
    PlayerState,
    "transition" | "queue" | "index" | "isPlaying" | "repeat" | "sleepAfterTrack"
  >,
  next: {
    queue?: readonly Track[];
    index?: number;
    isPlaying?: boolean;
    repeat?: RepeatMode;
    sleepAfterTrack?: boolean;
  },
): Partial<Pick<PlayerState, "transition" | "lastTransitionEnd">> {
  if (!prev.transition) return {};
  const valid = transitionMatchesQueueState(
    prev.transition,
    next.queue ?? prev.queue,
    next.index ?? prev.index,
    next.isPlaying ?? prev.isPlaying,
    next.repeat ?? prev.repeat,
    next.sleepAfterTrack ?? prev.sleepAfterTrack,
  );
  return valid ? {} : cancelledTransitionPatch(prev.transition);
}

function startTrack(queue: Track[], index: number, isPlaying = true) {
  return {
    index,
    isPlaying,
    currentTime: 0,
    duration: queue[index]?.duration_sec || 0,
    // The audio engine reuses a loaded deck when the song ID is unchanged.
    // Explicit starts must therefore seek even for a replay/duplicate entry.
    seekTo: index >= 0 && index < queue.length ? 0 : null,
    error: null,
    isBuffering: false,
  };
}

interface PlayerState {
  queue: Track[];
  origins: QueueOrigin[]; // parallel to queue: "manual" (primary) | "context" (secondary)
  originalQueue: Track[]; // pre-shuffle order, for restoring
  originalOrigins: QueueOrigin[]; // parallel to originalQueue
  queueContext: string | null; // label of the secondary queue's source (e.g. playlist name)
  index: number;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  lastVolume: number;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  isBuffering: boolean;
  error: string | null;
  queueOpen: boolean;
  lyricsOpen: boolean;
  /** Fullscreen "now playing" surface. */
  nowPlayingOpen: boolean;
  /** Next-track preload failure for the current queue pair, if any. */
  preloadError: string | null;
  /** Active audible track transition (non-null strictly while two decks overlap). */
  transition: TrackTransition | null;
  /** Most recent transition end event so UI distinguishes natural finish vs cancellation. */
  lastTransitionEnd: TrackTransitionEnd | null;
  radioActive: boolean; // endless "song radio" — auto-extends the queue
  // Changes on every explicit radio-mode transition, even when the boolean
  // value is unchanged, so async station work can identify its owning session.
  radioSession: number;

  // Sleep timer: pause playback at `sleepAt` (epoch ms), or after the current
  // track finishes when `sleepAfterTrack` is set. Both cleared once they fire.
  sleepAt: number | null;
  sleepAfterTrack: boolean;
  setSleepTimer: (minutes: number | null) => void;
  setSleepAfterTrack: (v: boolean) => void;

  // party mode bridge: when set, queue (and optionally playback) edits route to the party
  partyBridge: PartyBridge | null;
  partyQueueItemIds: number[]; // stable server entry IDs; duplicate songs have different entries

  // personal multi-device Connect bridge: when set (and no partyBridge), all
  // playback & queue actions send WebSocket commands to the active remote device.
  remoteBridge: RemotePlaybackBridge | null;
  /** True while local <audio> playback must stay silent (remote Connect controller or Jam control-only mode). */
  suppressLocalAudio: boolean;

  // actions
  setPartyBridge: (b: PartyBridge | null) => void;
  setRemoteBridge: (b: RemotePlaybackBridge | null) => void;
  setSuppressLocalAudio: (v: boolean) => void;
  /** Mirror an active remote device's Connect state into the player UI without touching local audio. */
  applyRemotePlaybackState: (playback: ConnectPlaybackState, positionSec?: number) => void;
  /** Take over playback on THIS browser when Connect transfers audio here. */
  activateConnectPlayback: (playback: ConnectPlaybackState) => void;
  setPartyQueue: (tracks: Track[], index: number, itemIds: number[]) => void;
  /** Snapshot of the queue and playhead a new party should continue from. */
  partyStartSnapshot: () => PartyStart;
  // Bind the server entry IDs of a party created from `partyStartSnapshot` to
  // the local queue, so the first party frame keeps the running track instead
  // of restarting it. Throws if the local queue changed in the meantime.
  adoptPartyQueue: (partyTrackSongIds: string[], itemIds: number[]) => void;
  // Guest-follow: apply the host's broadcast playback atomically. Pass a
  // numeric `seekTo` only when a drift correction is needed (null = leave the
  // playhead alone). No-op while nothing is loaded (index < 0).
  followHostPlayback: (isPlaying: boolean, seekTo: number | null) => void;
  setRadioActive: (v: boolean) => void;
  appendToQueue: (tracks: Track[]) => void;
  toggleQueue: () => void;
  setQueueOpen: (v: boolean) => void;
  toggleLyrics: () => void;
  setLyricsOpen: (v: boolean) => void;
  setNowPlayingOpen: (v: boolean) => void;
  _setPreloadError: (msg: string | null) => void;
  playTrack: (track: Track) => void;
  playQueue: (tracks: Track[], startIndex?: number, context?: string) => void;
  addToQueue: (track: Track) => void;
  /** Batch-append multiple tracks to the manual queue in a single update. */
  addManyToQueue: (tracks: Track[], context?: string) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (i: number) => void;
  clearQueue: () => void;
  reorderQueue: (from: number, to: number) => void;
  jumpTo: (i: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;

  // internal sync from <audio> element
  _setCurrentTime: (t: number) => void;
  _setDuration: (d: number) => void;
  _onEnded: () => void;
  // Atomically promote a crossfaded deck only if the queue still has the
  // expected outgoing/incoming pair. Returns false for stale handoffs.
  _crossfadeAdvance: (
    outgoingId: string,
    incomingId: string,
    currentTime: number,
    duration: number,
    targetIndex?: number,
  ) => boolean;
  /** Begin a live audible track transition; returns its unique sequence ID. */
  _startTransition: (input: StartTransitionInput) => number;
  /** Update the normalized 0..1 progress snapshot for an active transition. */
  _updateTransitionProgress: (id: number, progress: number) => void;
  /** Reschedule wall-clock timing after a mid-transition playbackRate change. */
  _rescheduleTransitionTiming: (
    id: number,
    startedAtMs: number,
    durationMs: number,
    progress: number,
  ) => void;
  /** Cancel an active transition (optionally scoped to a specific ID). */
  _cancelTransition: (id?: number) => void;
  _setBuffering: (b: boolean) => void;
  _setError: (msg: string | null) => void;

  // seek request consumed by the audio element
  seekTo: number | null;
  _clearSeek: () => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      origins: [],
      originalQueue: [],
      originalOrigins: [],
      queueContext: null,
      index: -1,
      isPlaying: false,
      volume: 0.8,
      muted: false,
      lastVolume: 0.8,
      currentTime: 0,
      duration: 0,
      shuffle: false,
      repeat: "off",
      isBuffering: false,
      error: null,
      queueOpen: false,
      lyricsOpen: false,
      nowPlayingOpen: false,
      preloadError: null,
      transition: null,
      lastTransitionEnd: null,
      seekTo: null,
      partyBridge: null,
      partyQueueItemIds: [],
      remoteBridge: null,
      suppressLocalAudio: false,

      radioActive: false,
      radioSession: 0,

      sleepAt: null,
      sleepAfterTrack: false,
      setSleepTimer: (minutes) =>
        set({
          sleepAt: minutes == null ? null : Date.now() + minutes * 60_000,
          sleepAfterTrack: false,
        }),
      setSleepAfterTrack: (v) =>
        set((s) => ({
          sleepAfterTrack: v,
          sleepAt: null,
          ...reconcileTransitionPatch(s, { sleepAfterTrack: v }),
        })),

      setPartyBridge: (b) =>
        set((s) => ({
          partyBridge: b,
          ...(b ? { radioActive: false, radioSession: s.radioSession + 1 } : {}),
        })),
      setRemoteBridge: (b) =>
        set((s) => ({
          remoteBridge: b,
          ...(b ? { radioActive: false, radioSession: s.radioSession + 1 } : {}),
        })),
      setSuppressLocalAudio: (v) =>
        set((s) => ({
          suppressLocalAudio: v,
          ...(v ? cancelledTransitionPatch(s.transition) : {}),
        })),
      applyRemotePlaybackState: (playback, positionSec) => {
        const queue = playback.queue.map((track) => ({ ...track }));
        const origins = [...playback.origins];
        const index =
          playback.current_index >= 0 && playback.current_index < queue.length
            ? playback.current_index
            : -1;
        const pos = Math.max(0, positionSec ?? playback.position_sec);
        const dur =
          playback.duration_sec > 0
            ? playback.duration_sec
            : index >= 0
              ? queue[index].duration_sec || 0
              : 0;
        set((s) => ({
          queue,
          origins,
          originalQueue: [...queue],
          originalOrigins: [...origins],
          queueContext: playback.queue_context,
          index,
          isPlaying: index >= 0 && playback.is_playing,
          currentTime: index >= 0 ? (dur > 0 ? Math.min(pos, dur) : pos) : 0,
          duration: dur,
          shuffle: playback.shuffle,
          repeat: playback.repeat,
          volume: playback.volume,
          muted: playback.muted,
          seekTo: null,
          isBuffering: false,
          error: null,
          partyQueueItemIds: [],
          ...cancelledTransitionPatch(s.transition),
        }));
      },
      activateConnectPlayback: (playback) => {
        const queue = playback.queue.map((track) => ({ ...track }));
        const origins = [...playback.origins];
        const index =
          playback.current_index >= 0 && playback.current_index < queue.length
            ? playback.current_index
            : -1;
        const pos = Math.max(0, playback.position_sec);
        const dur =
          playback.duration_sec > 0
            ? playback.duration_sec
            : index >= 0
              ? queue[index].duration_sec || 0
              : 0;
        set((s) => ({
          remoteBridge: null,
          suppressLocalAudio: false,
          queue,
          origins,
          originalQueue: [...queue],
          originalOrigins: [...origins],
          queueContext: playback.queue_context,
          index,
          isPlaying: index >= 0 && playback.is_playing,
          currentTime: index >= 0 ? pos : 0,
          duration: dur,
          seekTo: index >= 0 ? pos : null,
          shuffle: playback.shuffle,
          repeat: playback.repeat,
          volume: playback.volume,
          muted: playback.muted,
          isBuffering: false,
          error: null,
          radioActive: false,
          radioSession: s.radioSession + 1,
          partyQueueItemIds: [],
          ...cancelledTransitionPatch(s.transition),
        }));
      },
      setPartyQueue: (tracks, index, itemIds) => {
        if (
          itemIds.length !== tracks.length ||
          itemIds.some((id) => !Number.isInteger(id) || id <= 0) ||
          new Set(itemIds).size !== itemIds.length
        ) {
          throw new Error("Party queue entry IDs must be unique positive integers, one per track.");
        }
        if (!Number.isInteger(index) || index < -1 || index >= tracks.length) {
          throw new RangeError(`Party queue index ${index} is outside a ${tracks.length}-item queue.`);
        }
        const queue = tracks.map((track) => ({ ...track }));
        const origins = fillOrigins(queue.length, "context");
        set((s) => {
          // Removing/reordering earlier entries shifts the index without
          // changing the active entry. Song IDs alone cannot distinguish two
          // party entries of the same song.
          const sameTrack =
            index >= 0 &&
            index < queue.length &&
            s.index >= 0 &&
            s.partyQueueItemIds[s.index] === itemIds[index] &&
            String(s.queue[s.index]?.id ?? "") === String(queue[index]?.id ?? "");
          return {
            queue,
            origins,
            originalQueue: [...queue],
            originalOrigins: [...origins],
            partyQueueItemIds: [...itemIds],
            index,
            ...(sameTrack
              ? reconcileTransitionPatch(s, { queue, index })
              : {
                  ...startTrack(
                    queue,
                    index,
                    index >= 0 && index < queue.length && s.isPlaying,
                  ),
                  ...cancelledTransitionPatch(s.transition),
                }),
          };
        });
      },
      partyStartSnapshot: () => {
        const s = get();
        const active = s.index >= 0 && s.index < s.queue.length;
        return {
          tracks: s.queue.map((track) => ({ ...track })),
          current_index: active ? s.index : -1,
          is_playing: active && s.isPlaying,
          position_sec: active ? Math.max(0, s.currentTime) : 0,
        };
      },
      adoptPartyQueue: (partyTrackSongIds, itemIds) => {
        if (itemIds.length !== partyTrackSongIds.length) {
          throw new Error("Party entry IDs and songs must line up one per track.");
        }
        const local = get().queue.map((track) => String(track.id));
        if (
          local.length !== partyTrackSongIds.length ||
          local.some((id, i) => id !== String(partyTrackSongIds[i]))
        ) {
          throw new Error(
            "Die Warteschlange hat sich während des Party-Starts geändert; die Party übernimmt den Stand vom Server.",
          );
        }
        set({ partyQueueItemIds: [...itemIds] });
      },
      followHostPlayback: (isPlaying, seekTo) =>
        set((s) => {
          if (s.index < 0) return {};
          const patch: Partial<PlayerState> = { isPlaying };
          if (seekTo != null) {
            patch.seekTo = seekTo;
            patch.currentTime = seekTo;
          }
          if (!isPlaying || seekTo != null) {
            Object.assign(patch, cancelledTransitionPatch(s.transition));
          }
          return patch;
        }),
      setRadioActive: (v) =>
        set((s) => ({
          radioActive: v,
          radioSession: s.radioSession + 1,
        })),
      appendToQueue: (tracks) => {
        if (!tracks.length) return;
        set((s) => {
          const appended = tracks.map((track) => ({ ...track }));
          const ctx = fillOrigins(appended.length, "context");
          const nextQueue = [...s.queue, ...appended];
          return {
            queue: nextQueue,
            origins: [...s.origins, ...ctx],
            originalQueue: [...s.originalQueue, ...appended],
            originalOrigins: [...s.originalOrigins, ...ctx],
            ...reconcileTransitionPatch(s, { queue: nextQueue }),
          };
        });
      },

      toggleQueue: () => set({ queueOpen: !get().queueOpen }),
      setQueueOpen: (v) => set({ queueOpen: v }),
      toggleLyrics: () => set({ lyricsOpen: !get().lyricsOpen }),
      setLyricsOpen: (v) => set({ lyricsOpen: v }),
      setNowPlayingOpen: (v) => set({ nowPlayingOpen: v }),
      _setPreloadError: (msg) => {
        if (get().preloadError !== msg) set({ preloadError: msg });
      },

      playTrack: (track) => {
        const remote = !get().partyBridge ? get().remoteBridge : null;
        if (remote) {
          remote.playTrack(track);
          return;
        }
        const queueTrack = { ...track };
        pushRecent(queueTrack);
        set((s) => ({
          queue: [queueTrack],
          origins: ["context"],
          originalQueue: [queueTrack],
          originalOrigins: ["context"],
          queueContext: null,
          ...startTrack([queueTrack], 0),
          radioActive: false,
          radioSession: s.radioSession + 1,
          partyQueueItemIds: [],
          ...cancelledTransitionPatch(s.transition),
        }));
      },

      playQueue: (tracks, startIndex = 0, context) => {
        if (!tracks.length) return;
        const remote = !get().partyBridge ? get().remoteBridge : null;
        if (remote) {
          remote.playQueue(tracks, startIndex, context);
          return;
        }
        const idx = Math.max(0, Math.min(startIndex, tracks.length - 1));
        const queue = tracks.map((track) => ({ ...track }));
        const origins = fillOrigins(queue.length, "context");
        const baseQueue = {
          queue,
          origins,
          originalQueue: [...queue],
          originalOrigins: [...origins],
          index: idx,
          shuffle: false,
        };
        const productQueue = get().shuffle
          ? toggleQueueShuffle(baseQueue)
          : baseQueue;
        pushRecent(productQueue.queue[productQueue.index]);
        set((s) => ({
          ...productQueue,
          queueContext: context ?? null,
          ...startTrack(productQueue.queue, productQueue.index),
          radioActive: false,
          radioSession: s.radioSession + 1,
          partyQueueItemIds: [],
          ...cancelledTransitionPatch(s.transition),
        }));
      },

      addToQueue: (track) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.addToQueue(track);
          return;
        }
        const remote = get().remoteBridge;
        if (remote) {
          remote.addToQueue(track);
          return;
        }
        if (get().index < 0) {
          get().playTrack(track);
          return;
        }
        set((s) => {
          const next = insertManualItem(s, { ...track }, "tail");
          return {
            ...next,
            ...reconcileTransitionPatch(s, next),
          };
        });
      },

      addManyToQueue: (tracks, context) => {
        if (!tracks.length) return;
        const bridge = get().partyBridge;
        if (bridge) {
          for (const track of tracks) bridge.addToQueue(track);
          return;
        }
        const remote = get().remoteBridge;
        if (remote) {
          for (const track of tracks) remote.addToQueue(track);
          return;
        }
        if (get().index < 0) {
          get().playQueue(tracks, 0, context);
          return;
        }
        set((s) => {
          let nextState = {
            queue: s.queue,
            origins: s.origins,
            originalQueue: s.originalQueue,
            originalOrigins: s.originalOrigins,
            index: s.index,
            shuffle: s.shuffle,
          };
          for (const track of tracks) {
            nextState = insertManualItem(nextState, { ...track }, "tail");
          }
          return {
            ...nextState,
            ...reconcileTransitionPatch(s, nextState),
          };
        });
      },

      playNext: (track) => {
        const bridge = get().partyBridge;
        if (bridge) {
          if (bridge.playNext) bridge.playNext(track);
          else bridge.addToQueue(track);
          return;
        }
        const remote = get().remoteBridge;
        if (remote) {
          remote.playNext(track);
          return;
        }
        if (get().index < 0) {
          get().playTrack(track);
          return;
        }
        set((s) => {
          const next = insertManualItem(s, { ...track }, "next");
          return {
            ...next,
            ...reconcileTransitionPatch(s, next),
          };
        });
      },

      removeFromQueue: (i) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.removeAt(i);
          return;
        }
        const remote = get().remoteBridge;
        if (remote) {
          remote.removeFromQueue(i);
          return;
        }
        if (i < 0 || i >= get().queue.length) return;
        set((s) => {
          const next = removeQueueItem(s, i);
          return {
            ...next,
            ...reconcileTransitionPatch(s, next),
          };
        });
      },
      clearQueue: () => {
        // Party queues are shared/host-managed — don't clear from a member view.
        if (get().partyBridge) return;
        const remote = get().remoteBridge;
        if (remote) {
          remote.clearQueue();
          return;
        }
        const { queue, index } = get();
        if (index >= 0 && index < queue.length) {
          set((s) => {
            const next = clearUpcomingItems(s);
            return {
              ...next,
              ...reconcileTransitionPatch(s, next),
              radioActive: false,
              radioSession: s.radioSession + 1,
            };
          });
        } else {
          set((s) => ({
            queue: [],
            origins: [],
            originalQueue: [],
            originalOrigins: [],
            queueContext: null,
            ...startTrack([], -1, false),
            radioActive: false,
            radioSession: s.radioSession + 1,
            partyQueueItemIds: [],
            ...cancelledTransitionPatch(s.transition),
          }));
        }
      },

      reorderQueue: (from, to) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.reorder(from, to);
          return;
        }
        const remote = get().remoteBridge;
        if (remote) {
          remote.reorderQueue(from, to);
          return;
        }
        const { queue } = get();
        if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return;
        set((s) => {
          const next = moveQueueItem(s, from, to);
          return {
            ...next,
            ...reconcileTransitionPatch(s, next),
          };
        });
      },

      jumpTo: (i) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.setCurrent(i);
          return;
        }
        const remote = get().remoteBridge;
        if (remote) {
          remote.jumpTo(i);
          return;
        }
        const state = get();
        const { queue } = state;
        if (i < 0 || i >= queue.length) return;
        pushRecent(queue[i]);
        // A backward jump can leave passed-over manual items behind upcoming
        // context items; re-normalize origins so the queue invariant holds.
        const origins =
          i < state.index ? demoteOvertakenManualItems(state, i) : {};
        set({
          ...origins,
          ...startTrack(queue, i),
          // A pending radio start has disabled radioActive. Choosing another
          // existing entry must supersede it just like choosing a new queue.
          ...(!state.radioActive ? { radioSession: state.radioSession + 1 } : {}),
          ...cancelledTransitionPatch(state.transition),
        });
      },

      toggle: () => {
        const bridge = get().partyBridge;
        if (bridge?.toggle) {
          bridge.toggle();
          return;
        }
        const remote = !bridge ? get().remoteBridge : null;
        if (remote) {
          remote.toggle();
          return;
        }
        const { index, isPlaying } = get();
        if (index < 0) return;
        const nextPlaying = !isPlaying;
        set((s) => ({
          isPlaying: nextPlaying,
          ...(!nextPlaying ? cancelledTransitionPatch(s.transition) : {}),
        }));
      },

      play: () => {
        const bridge = get().partyBridge;
        if (bridge?.play) {
          bridge.play();
          return;
        }
        const remote = !bridge ? get().remoteBridge : null;
        if (remote) {
          remote.play();
          return;
        }
        if (get().index < 0) return;
        set({ isPlaying: true });
      },

      pause: () => {
        const bridge = get().partyBridge;
        if (bridge?.pause) {
          bridge.pause();
          return;
        }
        const remote = !bridge ? get().remoteBridge : null;
        if (remote) {
          remote.pause();
          return;
        }
        set((s) => ({
          isPlaying: false,
          ...cancelledTransitionPatch(s.transition),
        }));
      },

      next: () => {
        const bridge = get().partyBridge;
        if (bridge) {
          const { index, queue } = get();
          if (index + 1 < queue.length) bridge.setCurrent(index + 1);
          return;
        }
        const remote = get().remoteBridge;
        if (remote) {
          remote.next();
          return;
        }
        const { index, queue, repeat, radioActive, radioSession } = get();
        if (index < 0) return;
        if (index < queue.length - 1) {
          get().jumpTo(index + 1);
        } else if (repeat === "all" && queue.length) {
          get().jumpTo(0);
        } else {
          set((s) => ({
            isPlaying: false,
            currentTime: 0,
            seekTo: 0,
            isBuffering: false,
            ...(!radioActive ? { radioSession: radioSession + 1 } : {}),
            ...cancelledTransitionPatch(s.transition),
          }));
        }
      },

      prev: () => {
        const bridge = get().partyBridge;
        if (bridge) {
          if (get().index > 0) bridge.setCurrent(get().index - 1);
          return;
        }
        const remote = get().remoteBridge;
        if (remote) {
          remote.prev();
          return;
        }
        const { index, currentTime } = get();
        if (index < 0) return;
        // If more than 3s in, restart current track
        if (currentTime > 3) {
          set((s) => ({
            seekTo: 0,
            currentTime: 0,
            ...cancelledTransitionPatch(s.transition),
          }));
          return;
        }
        if (index > 0) {
          get().jumpTo(index - 1);
        } else {
          set((s) => ({
            seekTo: 0,
            currentTime: 0,
            ...cancelledTransitionPatch(s.transition),
          }));
        }
      },

      seek: (t) => {
        if (!Number.isFinite(t)) {
          throw new RangeError(`Seek position must be finite; received ${t}.`);
        }
        const bridge = get().partyBridge;
        if (bridge?.seek) {
          bridge.seek(t);
          return;
        }
        const remote = !bridge ? get().remoteBridge : null;
        if (remote) {
          remote.seek(t);
          return;
        }
        const { index, duration } = get();
        if (index < 0) return;
        const target = Math.max(0, duration > 0 ? Math.min(t, duration) : t);
        set((s) => ({
          seekTo: target,
          currentTime: target,
          ...cancelledTransitionPatch(s.transition),
        }));
      },

      setVolume: (v) => {
        const vol = Math.max(0, Math.min(1, v));
        const remote = !get().partyBridge ? get().remoteBridge : null;
        if (remote) {
          remote.setVolume(vol);
          return;
        }
        set({ volume: vol, muted: vol === 0, lastVolume: vol > 0 ? vol : get().lastVolume });
      },

      toggleMute: () => {
        const remote = !get().partyBridge ? get().remoteBridge : null;
        if (remote) {
          remote.toggleMute();
          return;
        }
        const { muted, volume, lastVolume } = get();
        if (muted || volume === 0) {
          const restore = lastVolume > 0 ? lastVolume : 0.8;
          set({ muted: false, volume: restore });
        } else {
          set({ muted: true, lastVolume: volume });
        }
      },

      toggleShuffle: () => {
        const remote = !get().partyBridge ? get().remoteBridge : null;
        if (remote) {
          remote.toggleShuffle();
          return;
        }
        set((s) => {
          const next = toggleQueueShuffle(s);
          return {
            ...next,
            ...reconcileTransitionPatch(s, next),
          };
        });
      },

      cycleRepeat: () => {
        const remote = !get().partyBridge ? get().remoteBridge : null;
        if (remote) {
          remote.cycleRepeat();
          return;
        }
        const order: RepeatMode[] = ["off", "all", "one"];
        set((s) => {
          const nextRepeat = order[(order.indexOf(s.repeat) + 1) % order.length];
          return {
            repeat: nextRepeat,
            ...reconcileTransitionPatch(s, { repeat: nextRepeat }),
          };
        });
      },

      _setCurrentTime: (t) => set({ currentTime: t }),
      _setDuration: (d) => set({ duration: d }),
      _startTransition: (input) => {
        assertValidTransitionKind(input.kind);
        assertValidTransitionTiming(input.startedAtMs, input.durationMs);
        const progress = input.progress ?? 0;
        assertValidTransitionProgress(progress);
        const state = get();
        if (
          !Number.isInteger(input.outgoingIndex) ||
          input.outgoingIndex < 0 ||
          input.outgoingIndex >= state.queue.length
        ) {
          throw new RangeError(
            `Transition outgoingIndex ${input.outgoingIndex} is outside a ${state.queue.length}-item queue.`,
          );
        }
        if (
          !Number.isInteger(input.incomingIndex) ||
          input.incomingIndex < 0 ||
          input.incomingIndex >= state.queue.length
        ) {
          throw new RangeError(
            `Transition incomingIndex ${input.incomingIndex} is outside a ${state.queue.length}-item queue.`,
          );
        }
        if (
          input.outgoingIndex !== state.index ||
          String(state.queue[input.outgoingIndex]?.id ?? "") !== String(input.outgoing.id)
        ) {
          throw new Error(
            `Transition outgoing track ${String(input.outgoing.id)} does not match active queue entry at index ${state.index}.`,
          );
        }
        if (String(state.queue[input.incomingIndex]?.id ?? "") !== String(input.incoming.id)) {
          throw new Error(
            `Transition incoming track ${String(input.incoming.id)} does not match queue entry at index ${input.incomingIndex}.`,
          );
        }
        const id = nextTransitionId++;
        set({
          transition: {
            id,
            kind: input.kind,
            outgoing: { ...input.outgoing },
            incoming: { ...input.incoming },
            outgoingIndex: input.outgoingIndex,
            incomingIndex: input.incomingIndex,
            startedAtMs: input.startedAtMs,
            durationMs: input.durationMs,
            progress,
          },
          lastTransitionEnd: null,
        });
        return id;
      },
      _updateTransitionProgress: (id, progress) => {
        assertValidTransitionId(id);
        assertValidTransitionProgress(progress);
        const active = get().transition;
        if (!active || active.id !== id || active.progress === progress) return;
        set({
          transition: {
            ...active,
            progress,
          },
        });
      },
      _rescheduleTransitionTiming: (id, startedAtMs, durationMs, progress) => {
        assertValidTransitionId(id);
        assertValidTransitionTiming(startedAtMs, durationMs);
        assertValidTransitionProgress(progress);
        const active = get().transition;
        if (!active || active.id !== id) return;
        set({
          transition: {
            ...active,
            startedAtMs,
            durationMs,
            progress,
          },
        });
      },
      _cancelTransition: (id) => {
        if (id !== undefined) assertValidTransitionId(id);
        const active = get().transition;
        if (!active) return;
        if (id !== undefined && active.id !== id) return;
        set(cancelledTransitionPatch(active));
      },
      _crossfadeAdvance: (outgoingId, incomingId, currentTime, duration, targetIndex) => {
        const state = get();
        const { index, queue, repeat } = state;
        if (index < 0 || index >= queue.length) return false;
        const resolvedTarget =
          targetIndex ??
          (index < queue.length - 1
            ? index + 1
            : repeat === "all" && queue.length > 1
              ? 0
              : -1);
        if (
          resolvedTarget < 0 ||
          resolvedTarget >= queue.length ||
          String(queue[index]?.id ?? "") !== outgoingId ||
          String(queue[resolvedTarget]?.id ?? "") !== incomingId
        ) {
          return false;
        }
        pushRecent(queue[resolvedTarget]);
        const origins =
          resolvedTarget < index ? demoteOvertakenManualItems(state, resolvedTarget) : {};
        const active = state.transition;
        const matchedTransition =
          active !== null &&
          active.outgoingIndex === index &&
          active.incomingIndex === resolvedTarget &&
          String(active.outgoing.id) === outgoingId &&
          String(active.incoming.id) === incomingId;
        const lastTransitionEnd: TrackTransitionEnd | null = matchedTransition
          ? {
              id: active.id,
              kind: active.kind,
              outcome: "completed",
              outgoing: active.outgoing,
              incoming: active.incoming,
              endedAtMs: nowMonotonicMs(),
            }
          : null;
        set({
          ...origins,
          index: resolvedTarget,
          isPlaying: true,
          currentTime: Number.isFinite(currentTime) ? currentTime : 0,
          duration: Number.isFinite(duration)
            ? duration
            : queue[resolvedTarget]?.duration_sec || 0,
          seekTo: null,
          error: null,
          isBuffering: false,
          transition: null,
          lastTransitionEnd,
        });
        return true;
      },
      _onEnded: () => {
        if (get().sleepAfterTrack) {
          set((s) => ({
            sleepAfterTrack: false,
            isPlaying: false,
            currentTime: 0,
            seekTo: null,
            isBuffering: false,
            ...cancelledTransitionPatch(s.transition),
          }));
          return;
        }
        if (get().repeat === "one") {
          set((s) => ({
            seekTo: 0,
            currentTime: 0,
            isPlaying: true,
            isBuffering: false,
            ...cancelledTransitionPatch(s.transition),
          }));
          return;
        }
        get().next();
      },
      _setBuffering: (b) => set({ isBuffering: b }),
      _setError: (msg) =>
        set((s) => ({
          error: msg,
          isBuffering: false,
          ...(msg !== null ? cancelledTransitionPatch(s.transition) : {}),
        })),
      _clearSeek: () => set({ seekTo: null }),
    }),
    {
      name: "sf_player",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        volume: s.volume,
        muted: s.muted,
        lastVolume: s.lastVolume,
        shuffle: s.shuffle,
        repeat: s.repeat,
        lyricsOpen: s.lyricsOpen,
        queueOpen: s.queueOpen,
      }),
    },
  ),
);

export function currentTrack(state: PlayerState): Track | null {
  if (state.index < 0 || state.index >= state.queue.length) return null;
  return state.queue[state.index];
}
