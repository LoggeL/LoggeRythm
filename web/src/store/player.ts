import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Track } from "@/types";

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

// Fisher–Yates over indices, keeping `keep` (current track) first.
function shuffledQueue(tracks: Track[], keepIndex: number): Track[] {
  const rest = tracks.filter((_, i) => i !== keepIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const current = tracks[keepIndex];
  return current ? [current, ...rest] : rest;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Two-level queue: every queue entry carries an origin. "user" tracks were
// added manually ("Zur Warteschlange hinzufügen" / "Als Nächstes spielen") and
// form the primary queue; "context" tracks come from a playlist/album/radio and
// form the secondary queue. Invariant for upcoming tracks (index > current):
// all "user" entries come before any "context" entry, so manual additions
// always play first.
export type QueueOrigin = "user" | "context";

function fillOrigins(n: number, origin: QueueOrigin): QueueOrigin[] {
  return new Array(Math.max(0, n)).fill(origin);
}

// Insert a user-queued track into a flat queue. When `front` is true (play next)
// it lands directly after the current track; otherwise it lands after any
// existing upcoming user tracks but before the first upcoming context track.
function insertUserTrack(
  queue: Track[],
  origins: QueueOrigin[],
  anchorIndex: number,
  track: Track,
  front: boolean,
): { queue: Track[]; origins: QueueOrigin[] } {
  let at = queue.length;
  if (front) {
    at = anchorIndex + 1;
  } else {
    for (let k = anchorIndex + 1; k < queue.length; k++) {
      if (origins[k] === "context") {
        at = k;
        break;
      }
    }
  }
  const q = [...queue];
  q.splice(at, 0, track);
  const o = [...origins];
  o.splice(at, 0, "user");
  return { queue: q, origins: o };
}

// Add a user (primary) track to the live queue and mirror it into the
// pre-shuffle original queue so shuffle toggling stays consistent.
function addUserTrack(
  state: {
    queue: Track[];
    origins: QueueOrigin[];
    originalQueue: Track[];
    originalOrigins: QueueOrigin[];
    index: number;
  },
  track: Track,
  front: boolean,
): Pick<PlayerState, "queue" | "origins" | "originalQueue" | "originalOrigins"> {
  const { queue, origins, originalQueue, originalOrigins, index } = state;
  const live = insertUserTrack(queue, origins, index, track, front);

  const cur = queue[index];
  const anchor = cur
    ? originalQueue.findIndex((t) => String(t.id) === String(cur.id))
    : -1;
  let originalQ = originalQueue;
  let originalO = originalOrigins;
  if (anchor >= 0) {
    const orig = insertUserTrack(originalQueue, originalOrigins, anchor, track, front);
    originalQ = orig.queue;
    originalO = orig.origins;
  } else {
    originalQ = [...originalQueue, track];
    originalO = [...originalOrigins, "user"];
  }

  return {
    queue: live.queue,
    origins: live.origins,
    originalQueue: originalQ,
    originalOrigins: originalO,
  };
}

interface PlayerState {
  queue: Track[];
  origins: QueueOrigin[]; // parallel to queue: "user" (primary) | "context" (secondary)
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

  // party mode bridge: when set, queue edits route to the party
  partyBridge: PartyBridge | null;

  // actions
  setPartyBridge: (b: PartyBridge | null) => void;
  setPartyQueue: (tracks: Track[], index: number) => void;
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

      setPartyBridge: (b) => set({ partyBridge: b }),
      setPartyQueue: (tracks, index) =>
        set({
          queue: tracks,
          origins: fillOrigins(tracks.length, "context"),
          index,
          duration: tracks[index]?.duration_sec || 0,
        }),
      setRadioActive: (v) => set({ radioActive: v }),
      appendToQueue: (tracks) => {
        if (!tracks.length) return;
        const { queue, origins, originalQueue, originalOrigins } = get();
        const ctx = fillOrigins(tracks.length, "context");
        set({
          queue: [...queue, ...tracks],
          origins: [...origins, ...ctx],
          originalQueue: [...originalQueue, ...tracks],
          originalOrigins: [...originalOrigins, ...ctx],
        });
      },

      toggleQueue: () => set({ queueOpen: !get().queueOpen }),
      setQueueOpen: (v) => set({ queueOpen: v }),
      toggleLyrics: () => set({ lyricsOpen: !get().lyricsOpen }),
      setLyricsOpen: (v) => set({ lyricsOpen: v }),

      playTrack: (track) => {
        pushRecent(track);
        set({
          queue: [track],
          origins: ["context"],
          originalQueue: [track],
          originalOrigins: ["context"],
          queueContext: null,
          index: 0,
          isPlaying: true,
          currentTime: 0,
          duration: track.duration_sec || 0,
          error: null,
          radioActive: false,
        });
      },

      playQueue: (tracks, startIndex = 0, context) => {
        if (!tracks.length) return;
        const idx = Math.max(0, Math.min(startIndex, tracks.length - 1));
        const original = tracks;
        let queue = tracks;
        let index = idx;
        if (get().shuffle) {
          queue = shuffledQueue(tracks, idx);
          index = 0;
        }
        pushRecent(queue[index]);
        set({
          queue,
          origins: fillOrigins(queue.length, "context"),
          originalQueue: original,
          originalOrigins: fillOrigins(original.length, "context"),
          queueContext: context ?? null,
          index,
          isPlaying: true,
          currentTime: 0,
          duration: queue[index]?.duration_sec || 0,
          error: null,
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
        set(addUserTrack(get(), track, false));
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
        set(addUserTrack(get(), track, true));
      },

      removeFromQueue: (i) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.removeAt(i);
          return;
        }
        const { queue, origins, originalQueue, originalOrigins, index } = get();
        if (i < 0 || i >= queue.length) return;
        const removed = queue[i];
        const q = queue.filter((_, idx) => idx !== i);
        const o = origins.filter((_, idx) => idx !== i);
        // Drop the matching track from the pre-shuffle original arrays too.
        const oi = removed
          ? originalQueue.findIndex((t) => String(t.id) === String(removed.id))
          : -1;
        const oq = oi >= 0 ? originalQueue.filter((_, idx) => idx !== oi) : originalQueue;
        const oo = oi >= 0 ? originalOrigins.filter((_, idx) => idx !== oi) : originalOrigins;
        let newIndex = index;
        if (i < index) newIndex = index - 1;
        else if (i === index) newIndex = Math.min(index, q.length - 1);
        set({
          queue: q,
          origins: o,
          originalQueue: oq,
          originalOrigins: oo,
          index: q.length ? newIndex : -1,
          isPlaying: q.length ? get().isPlaying : false,
        });
      },

      clearQueue: () => {
        // Party queues are shared/host-managed — don't clear from a member view.
        if (get().partyBridge) return;
        const { queue, origins, index } = get();
        if (index >= 0 && index < queue.length) {
          // Keep the current track so playback continues; drop the rest.
          const cur = queue[index];
          const curOrigin = origins[index] ?? "context";
          set({
            queue: [cur],
            origins: [curOrigin],
            index: 0,
            originalQueue: [cur],
            originalOrigins: [curOrigin],
          });
        } else {
          set({
            queue: [],
            origins: [],
            index: -1,
            originalQueue: [],
            originalOrigins: [],
            isPlaying: false,
          });
        }
      },

      reorderQueue: (from, to) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.reorder(from, to);
          return;
        }
        const { queue, origins, index } = get();
        if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return;
        const q = [...queue];
        const [moved] = q.splice(from, 1);
        q.splice(to, 0, moved);
        const o = [...origins];
        const [movedOrigin] = o.splice(from, 1);
        o.splice(to, 0, movedOrigin);
        let newIndex = index;
        if (from === index) newIndex = to;
        else if (from < index && to >= index) newIndex = index - 1;
        else if (from > index && to <= index) newIndex = index + 1;
        set({ queue: q, origins: o, index: newIndex });
      },

      jumpTo: (i) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.setCurrent(i);
          return;
        }
        const { queue } = get();
        if (i < 0 || i >= queue.length) return;
        pushRecent(queue[i]);
        set({
          index: i,
          currentTime: 0,
          isPlaying: true,
          duration: queue[i]?.duration_sec || 0,
          error: null,
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
          bridge.setCurrent(get().index + 1);
          return;
        }
        const { index, queue, repeat } = get();
        if (index < 0) return;
        if (index < queue.length - 1) {
          get().jumpTo(index + 1);
        } else if (repeat === "all" && queue.length) {
          get().jumpTo(0);
        } else {
          set({ isPlaying: false, currentTime: 0 });
        }
      },

      prev: () => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.setCurrent(get().index - 1);
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

      seek: (t) => set({ seekTo: t, currentTime: t }),

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
        const { shuffle, queue, origins, originalQueue, originalOrigins, index } = get();
        if (!queue.length) {
          set({ shuffle: !shuffle });
          return;
        }
        if (!shuffle) {
          // turn on: keep current + manual (user) queue order, shuffle only the
          // secondary (context) tracks. Manual additions still play first.
          const cur = queue[index];
          const curOrigin = origins[index] ?? "context";
          const userUp: Track[] = [];
          const ctxUp: Track[] = [];
          for (let k = index + 1; k < queue.length; k++) {
            if (origins[k] === "user") userUp.push(queue[k]);
            else ctxUp.push(queue[k]);
          }
          const shuffledCtx = shuffleArray(ctxUp);
          const newQueue = (cur ? [cur, ...userUp, ...shuffledCtx] : [...userUp, ...shuffledCtx]);
          const newOrigins: QueueOrigin[] = [
            ...(cur ? [curOrigin] : []),
            ...fillOrigins(userUp.length, "user"),
            ...fillOrigins(shuffledCtx.length, "context"),
          ];
          const hasOriginal = originalQueue.length > 0;
          set({
            shuffle: true,
            queue: newQueue,
            origins: newOrigins,
            originalQueue: hasOriginal
              ? originalQueue
              : cur
                ? [cur, ...userUp, ...ctxUp]
                : [...userUp, ...ctxUp],
            originalOrigins: hasOriginal
              ? originalOrigins
              : [
                  ...(cur ? [curOrigin] : []),
                  ...fillOrigins(userUp.length, "user"),
                  ...fillOrigins(ctxUp.length, "context"),
                ],
            index: 0,
          });
        } else {
          // turn off: restore original order, find current track
          const current = queue[index];
          const restored = originalQueue.length ? originalQueue : queue;
          const restoredOrigins = originalOrigins.length ? originalOrigins : origins;
          const newIndex = current
            ? restored.findIndex((t) => String(t.id) === String(current.id))
            : 0;
          set({
            shuffle: false,
            queue: restored,
            origins: restoredOrigins,
            index: newIndex >= 0 ? newIndex : 0,
          });
        }
      },

      cycleRepeat: () => {
        const order: RepeatMode[] = ["off", "all", "one"];
        const cur = get().repeat;
        set({ repeat: order[(order.indexOf(cur) + 1) % order.length] });
      },

      _setCurrentTime: (t) => set({ currentTime: t }),
      _setDuration: (d) => set({ duration: d }),
      _onEnded: () => {
        if (get().repeat === "one") {
          set({ seekTo: 0, currentTime: 0, isPlaying: true });
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
