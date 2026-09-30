import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Track } from "@/types";
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

export type RepeatMode = "off" | "all" | "one";

export interface PartyBridge {
  addToQueue: (t: Track) => void;
  removeAt: (i: number) => void;
  reorder: (from: number, to: number) => void;
  setCurrent: (i: number) => void;
}

const RECENT_KEY = "sf_recent_tracks";
const RECENT_MAX = 30;

function pushRecent(track: Track) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list: Track[] = raw ? JSON.parse(raw) : [];
    const next = [track, ...list.filter((t) => String(t.id) !== String(track.id))].slice(
      0,
      RECENT_MAX,
    );
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

export function getRecentTracks(): Track[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as Track[]) : [];
  } catch {
    return [];
  }
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

function startTrack(queue: Track[], index: number, isPlaying = true) {
  return {
    index,
    isPlaying,
    currentTime: 0,
    duration: queue[index]?.duration_sec || 0,
    seekTo: null,
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

  // party mode bridge: when set, queue edits route to the party
  partyBridge: PartyBridge | null;

  // actions
  setPartyBridge: (b: PartyBridge | null) => void;
  setPartyQueue: (tracks: Track[], index: number) => void;
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
  ) => boolean;
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
      seekTo: null,
      partyBridge: null,

      radioActive: false,
      radioSession: 0,

      sleepAt: null,
      sleepAfterTrack: false,
      setSleepTimer: (minutes) =>
        set({
          sleepAt: minutes == null ? null : Date.now() + minutes * 60_000,
          sleepAfterTrack: false,
        }),
      setSleepAfterTrack: (v) => set({ sleepAfterTrack: v, sleepAt: null }),

      setPartyBridge: (b) => set({ partyBridge: b }),
      setPartyQueue: (tracks, index) => {
        const queue = tracks.map((track) => ({ ...track }));
        const origins = fillOrigins(queue.length, "context");
        set((s) => {
          // Party frames arrive on every member/queue event. Preserve the
          // active deck's clock only while the playing track is unchanged.
          const sameTrack =
            index >= 0 &&
            index < queue.length &&
            s.index === index &&
            String(s.queue[s.index]?.id ?? "") === String(queue[index]?.id ?? "");
          return {
            queue,
            origins,
            originalQueue: [...queue],
            originalOrigins: [...origins],
            ...(sameTrack
              ? {}
              : startTrack(
                  queue,
                  index,
                  index >= 0 && index < queue.length && s.isPlaying,
                )),
          };
        });
      },
      followHostPlayback: (isPlaying, seekTo) =>
        set((s) => {
          if (s.index < 0) return {};
          const patch: Partial<PlayerState> = { isPlaying };
          if (seekTo != null) {
            patch.seekTo = seekTo;
            patch.currentTime = seekTo;
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
        const { queue, origins, originalQueue, originalOrigins } = get();
        const appended = tracks.map((track) => ({ ...track }));
        const ctx = fillOrigins(appended.length, "context");
        set({
          queue: [...queue, ...appended],
          origins: [...origins, ...ctx],
          originalQueue: [...originalQueue, ...appended],
          originalOrigins: [...originalOrigins, ...ctx],
        });
      },

      toggleQueue: () => set({ queueOpen: !get().queueOpen }),
      setQueueOpen: (v) => set({ queueOpen: v }),
      toggleLyrics: () => set({ lyricsOpen: !get().lyricsOpen }),
      setLyricsOpen: (v) => set({ lyricsOpen: v }),

      playTrack: (track) => {
        const queueTrack = { ...track };
        pushRecent(queueTrack);
        set({
          queue: [queueTrack],
          origins: ["context"],
          originalQueue: [queueTrack],
          originalOrigins: ["context"],
          queueContext: null,
          ...startTrack([queueTrack], 0),
          radioActive: false,
        });
      },

      playQueue: (tracks, startIndex = 0, context) => {
        if (!tracks.length) return;
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
        set({
          ...productQueue,
          queueContext: context ?? null,
          ...startTrack(productQueue.queue, productQueue.index),
          radioActive: false,
        });
      },

      addToQueue: (track) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.addToQueue(track);
          return;
        }
        if (get().index < 0) {
          get().playTrack(track);
          return;
        }
        set(insertManualItem(get(), { ...track }, "tail"));
      },

      playNext: (track) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.addToQueue(track);
          return;
        }
        if (get().index < 0) {
          get().playTrack(track);
          return;
        }
        set(insertManualItem(get(), { ...track }, "next"));
      },

      removeFromQueue: (i) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.removeAt(i);
          return;
        }
        if (i < 0 || i >= get().queue.length) return;
        set(removeQueueItem(get(), i));
      },
      clearQueue: () => {
        // Party queues are shared/host-managed — don't clear from a member view.
        if (get().partyBridge) return;
        const { queue, index } = get();
        if (index >= 0 && index < queue.length) {
          set(clearUpcomingItems(get()));
        } else {
          set({
            queue: [],
            origins: [],
            originalQueue: [],
            originalOrigins: [],
            queueContext: null,
            ...startTrack([], -1, false),
          });
        }
      },

      reorderQueue: (from, to) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.reorder(from, to);
          return;
        }
        const { queue } = get();
        if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return;
        set(moveQueueItem(get(), from, to));
      },

      jumpTo: (i) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.setCurrent(i);
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
        });
      },

      toggle: () => {
        const { index, isPlaying } = get();
        if (index < 0) return;
        set({ isPlaying: !isPlaying });
      },

      play: () => {
        if (get().index < 0) return;
        set({ isPlaying: true });
      },

      pause: () => set({ isPlaying: false }),

      next: () => {
        const bridge = get().partyBridge;
        if (bridge) {
          const { index, queue } = get();
          if (index + 1 < queue.length) bridge.setCurrent(index + 1);
          return;
        }
        const { index, queue, repeat } = get();
        if (index < 0) return;
        if (index < queue.length - 1) {
          get().jumpTo(index + 1);
        } else if (repeat === "all" && queue.length) {
          get().jumpTo(0);
        } else {
          set({ isPlaying: false, currentTime: 0, seekTo: 0, isBuffering: false });
        }
      },

      prev: () => {
        const bridge = get().partyBridge;
        if (bridge) {
          if (get().index > 0) bridge.setCurrent(get().index - 1);
          return;
        }
        const { index, currentTime } = get();
        if (index < 0) return;
        // If more than 3s in, restart current track
        if (currentTime > 3) {
          set({ seekTo: 0, currentTime: 0 });
          return;
        }
        if (index > 0) {
          get().jumpTo(index - 1);
        } else {
          set({ seekTo: 0, currentTime: 0 });
        }
      },

      seek: (t) => {
        if (!Number.isFinite(t)) {
          throw new RangeError(`Seek position must be finite; received ${t}.`);
        }
        const { index, duration } = get();
        if (index < 0) return;
        const target = Math.max(0, duration > 0 ? Math.min(t, duration) : t);
        set({ seekTo: target, currentTime: target });
      },

      setVolume: (v) => {
        const vol = Math.max(0, Math.min(1, v));
        set({ volume: vol, muted: vol === 0, lastVolume: vol > 0 ? vol : get().lastVolume });
      },

      toggleMute: () => {
        const { muted, volume, lastVolume } = get();
        if (muted || volume === 0) {
          const restore = lastVolume > 0 ? lastVolume : 0.8;
          set({ muted: false, volume: restore });
        } else {
          set({ muted: true, lastVolume: volume });
        }
      },

      toggleShuffle: () => {
        set(toggleQueueShuffle(get()));
      },

      cycleRepeat: () => {
        const order: RepeatMode[] = ["off", "all", "one"];
        const cur = get().repeat;
        set({ repeat: order[(order.indexOf(cur) + 1) % order.length] });
      },

      _setCurrentTime: (t) => set({ currentTime: t }),
      _setDuration: (d) => set({ duration: d }),
      _crossfadeAdvance: (outgoingId, incomingId, currentTime, duration) => {
        const { index, queue } = get();
        if (
          index < 0 ||
          index >= queue.length - 1 ||
          String(queue[index]?.id ?? "") !== outgoingId ||
          String(queue[index + 1]?.id ?? "") !== incomingId
        ) {
          return false;
        }
        pushRecent(queue[index + 1]);
        set({
          index: index + 1,
          isPlaying: true,
          currentTime: Number.isFinite(currentTime) ? currentTime : 0,
          duration: Number.isFinite(duration)
            ? duration
            : queue[index + 1]?.duration_sec || 0,
          seekTo: null,
          error: null,
          isBuffering: false,
        });
        return true;
      },
      _onEnded: () => {
        if (get().sleepAfterTrack) {
          set({
            sleepAfterTrack: false,
            isPlaying: false,
            currentTime: 0,
            seekTo: null,
            isBuffering: false,
          });
          return;
        }
        if (get().repeat === "one") {
          set({
            seekTo: 0,
            currentTime: 0,
            isPlaying: true,
            isBuffering: false,
          });
          return;
        }
        get().next();
      },
      _setBuffering: (b) => set({ isBuffering: b }),
      _setError: (msg) => set({ error: msg, isBuffering: false }),
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
      }),
    },
  ),
);

export function currentTrack(state: PlayerState): Track | null {
  if (state.index < 0 || state.index >= state.queue.length) return null;
  return state.queue[state.index];
}
