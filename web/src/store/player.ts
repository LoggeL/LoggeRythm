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

interface PlayerState {
  queue: Track[];
  originalQueue: Track[]; // pre-shuffle order, for restoring
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
  playQueue: (tracks: Track[], startIndex?: number) => void;
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
      originalQueue: [],
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
          index,
          duration: tracks[index]?.duration_sec || 0,
        }),
      setRadioActive: (v) => set({ radioActive: v }),
      appendToQueue: (tracks) => {
        if (!tracks.length) return;
        const { queue, originalQueue } = get();
        set({
          queue: [...queue, ...tracks],
          originalQueue: [...originalQueue, ...tracks],
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
          originalQueue: [track],
          index: 0,
          isPlaying: true,
          currentTime: 0,
          duration: track.duration_sec || 0,
          error: null,
          radioActive: false,
        });
      },

      playQueue: (tracks, startIndex = 0) => {
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
          originalQueue: original,
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
        const { queue, originalQueue, index } = get();
        if (index < 0) {
          get().playTrack(track);
          return;
        }
        set({ queue: [...queue, track], originalQueue: [...originalQueue, track] });
      },

      playNext: (track) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.addToQueue(track);
          return;
        }
        const { queue, originalQueue, index } = get();
        if (index < 0) {
          get().playTrack(track);
          return;
        }
        const q = [...queue];
        q.splice(index + 1, 0, track);
        set({ queue: q, originalQueue: [...originalQueue, track] });
      },

      removeFromQueue: (i) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.removeAt(i);
          return;
        }
        const { queue, index } = get();
        if (i < 0 || i >= queue.length) return;
        const q = queue.filter((_, idx) => idx !== i);
        let newIndex = index;
        if (i < index) newIndex = index - 1;
        else if (i === index) newIndex = Math.min(index, q.length - 1);
        set({
          queue: q,
          index: q.length ? newIndex : -1,
          isPlaying: q.length ? get().isPlaying : false,
        });
      },

      clearQueue: () => {
        // Party queues are shared/host-managed — don't clear from a member view.
        if (get().partyBridge) return;
        const { queue, index } = get();
        if (index >= 0 && index < queue.length) {
          // Keep the current track so playback continues; drop the rest.
          const cur = queue[index];
          set({ queue: [cur], index: 0, originalQueue: [cur] });
        } else {
          set({ queue: [], index: -1, originalQueue: [], isPlaying: false });
        }
      },

      reorderQueue: (from, to) => {
        const bridge = get().partyBridge;
        if (bridge) {
          bridge.reorder(from, to);
          return;
        }
        const { queue, index } = get();
        if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return;
        const q = [...queue];
        const [moved] = q.splice(from, 1);
        q.splice(to, 0, moved);
        let newIndex = index;
        if (from === index) newIndex = to;
        else if (from < index && to >= index) newIndex = index - 1;
        else if (from > index && to <= index) newIndex = index + 1;
        set({ queue: q, index: newIndex });
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
        const { shuffle, queue, originalQueue, index } = get();
        if (!queue.length) {
          set({ shuffle: !shuffle });
          return;
        }
        if (!shuffle) {
          // turn on: shuffle remaining, keep current first
          const shuffled = shuffledQueue(queue, index);
          set({
            shuffle: true,
            originalQueue: originalQueue.length ? originalQueue : queue,
            queue: shuffled,
            index: 0,
          });
        } else {
          // turn off: restore original order, find current track
          const current = queue[index];
          const restored = originalQueue.length ? originalQueue : queue;
          const newIndex = current
            ? restored.findIndex((t) => String(t.id) === String(current.id))
            : 0;
          set({
            shuffle: false,
            queue: restored,
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
