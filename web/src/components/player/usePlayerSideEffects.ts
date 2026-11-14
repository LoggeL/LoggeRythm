"use client";

import { useEffect, useRef } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/useAuth";
import { trackArtistLabel } from "@/lib/trackArtists";
import { toast } from "@/store/toast";

const APP_TITLE = "LoggeRythm";

/** Record a play once per (new) track for approved, logged-in users. */
function usePlayRecorder() {
  const track = usePlayerStore(currentTrack);
  const { data: me } = useMe();
  const recorded = useRef<string | null>(null);
  const trackId = track?.id ?? null;
  useEffect(() => {
    if (!track || !trackId || !me?.is_approved) return;
    if (recorded.current === trackId) return;
    recorded.current = trackId;
    api.recordPlay(track).catch((error: unknown) => {
      if (recorded.current === trackId) recorded.current = null;
      toast.error(`Hörverlauf konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [trackId, track, me?.is_approved]);
}

/** Reflect the current song in the browser tab title. */
function useTabTitle() {
  const track = usePlayerStore(currentTrack);
  useEffect(() => {
    document.title = track ? `${track.title} • ${trackArtistLabel(track)}` : APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [track]);
}

/**
 * Endless radio: when the queue runs low, pull ~5 more similar songs seeded
 * by the current track so the station keeps evolving.
 */
function useRadioTopUp() {
  const track = usePlayerStore(currentTrack);
  const radioActive = usePlayerStore((s) => s.radioActive);
  const radioSession = usePlayerStore((s) => s.radioSession);
  const queueLen = usePlayerStore((s) => s.queue.length);
  const index = usePlayerStore((s) => s.index);
  // A replacement station may start while the previous top-up is still in
  // flight. Track the owning session instead of globally blocking all fetches.
  const fetchingSession = useRef<number | null>(null);

  useEffect(() => {
    if (!radioActive || !track) return;
    if (queueLen - index > 2) return; // still have a buffer
    if (fetchingSession.current === radioSession) return;
    fetchingSession.current = radioSession;
    const requestSession = radioSession;
    const stillOwned = () => {
      const state = usePlayerStore.getState();
      return state.radioSession === requestSession && state.radioActive;
    };
    api
      .radio(String(track.id))
      .then((more) => {
        if (!stillOwned()) return;
        const state = usePlayerStore.getState();
        const have = new Set(state.queue.map((t) => String(t.id)));
        const fresh = more.filter((t) => !have.has(String(t.id))).slice(0, 5);
        if (fresh.length) state.appendToQueue(fresh);
      })
      .catch((e) => {
        if (!stillOwned()) return;
        // Stop the radio visibly instead of silently starving the queue.
        usePlayerStore.getState().setRadioActive(false);
        toast.error(
          `Song-Radio konnte nicht erweitert werden: ${e instanceof Error ? e.message : String(e)}`,
        );
      })
      .finally(() => {
        if (fetchingSession.current === requestSession) fetchingSession.current = null;
      });
  }, [radioActive, radioSession, index, queueLen, track]);
}

const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  "play", "pause", "previoustrack", "nexttrack", "seekto", "seekforward", "seekbackward", "stop",
];

/** MediaSession: OS media keys + lock-screen metadata + artwork. */
function useMediaSession() {
  const track = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (!track) {
      session.metadata = null;
      return;
    }
    const store = () => usePlayerStore.getState();
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: trackArtistLabel(track),
      album: track.album,
      artwork: track.cover
        ? [
            { src: track.cover, sizes: "250x250", type: "image/jpeg" },
            { src: track.cover, sizes: "500x500", type: "image/jpeg" },
          ]
        : [],
    });
    session.setActionHandler("play", () => store().play());
    session.setActionHandler("pause", () => store().pause());
    session.setActionHandler("previoustrack", () => store().prev());
    session.setActionHandler("nexttrack", () => store().next());
    session.setActionHandler("seekto", (detail) => {
      if (detail.seekTime != null) store().seek(detail.seekTime);
    });
    session.setActionHandler("seekforward", (detail) => {
      const state = store();
      state.seek(Math.min(state.currentTime + (detail.seekOffset ?? 10), state.duration || 0));
    });
    session.setActionHandler("seekbackward", (detail) => {
      const state = store();
      state.seek(Math.max(state.currentTime - (detail.seekOffset ?? 10), 0));
    });
    try {
      session.setActionHandler("stop", () => store().pause());
    } catch {
      // "stop" is an optional action; browsers without it throw on registration.
    }

    return () => {
      session.metadata = null;
      for (const action of MEDIA_SESSION_ACTIONS) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Some browsers reject unsupported actions instead of ignoring them.
        }
      }
    };
  }, [track]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);
}

/** Sleep timer: pause when the deadline passes. */
function useSleepTimer() {
  const sleepAt = usePlayerStore((s) => s.sleepAt);
  useEffect(() => {
    if (sleepAt == null) return;
    const interval = window.setInterval(() => {
      const s = usePlayerStore.getState();
      if (s.sleepAt != null && Date.now() >= s.sleepAt) {
        s.setSleepTimer(null);
        s.pause();
        toast.info("Sleep-Timer: Wiedergabe pausiert.");
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [sleepAt]);
}

const INTERACTIVE_TARGETS =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="tab"], [role="slider"], [role="combobox"], [role="menuitem"]';

/**
 * Global keyboard shortcuts (ignored while a control has focus):
 * Space play/pause · ←/→ seek 5 s · ↑/↓ volume · M mute ·
 * Q queue · T lyrics · F fullscreen · Shift+N / Shift+P next / previous.
 */
function usePlayerShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || el?.closest(INTERACTIVE_TARGETS)) {
        return;
      }
      const s = usePlayerStore.getState();
      if (s.index < 0) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const actions: Record<string, () => void> = {
        " ": s.toggle,
        ArrowRight: () => s.seek(Math.min(s.currentTime + 5, s.duration || s.currentTime + 5)),
        ArrowLeft: () => s.seek(Math.max(s.currentTime - 5, 0)),
        ArrowUp: () => s.setVolume(Math.min(s.volume + 0.05, 1)),
        ArrowDown: () => s.setVolume(Math.max(s.volume - 0.05, 0)),
        m: s.toggleMute,
        q: s.toggleQueue,
        t: s.toggleLyrics,
        f: () => setNowPlayingOpen(!s.nowPlayingOpen),
        ...(e.shiftKey ? { n: s.next, p: s.prev } : {}),
      };
      const action = actions[key];
      if (!action) return;
      e.preventDefault();
      action();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Open or close the fullscreen "now playing" surface. Browser fullscreen is
 * best-effort on top of the in-app overlay: the browser may deny it (no user
 * activation, iOS), and the overlay works identically without it.
 */
export function setNowPlayingOpen(open: boolean): void {
  usePlayerStore.getState().setNowPlayingOpen(open);
  if (open && !document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  } else if (!open && document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => undefined);
  }
}

/** Mirrors the overlay state for CSS hooks and the legacy window events. */
function useNowPlayingBridge() {
  const open = usePlayerStore((s) => s.nowPlayingOpen);
  useEffect(() => {
    document.body.dataset.nowPlayingExpanded = open ? "true" : "false";
    return () => {
      document.body.dataset.nowPlayingExpanded = "false";
    };
  }, [open]);
  useEffect(() => {
    const openView = () => setNowPlayingOpen(true);
    const closeView = () => setNowPlayingOpen(false);
    window.addEventListener("spotifrei:open-now-playing", openView);
    window.addEventListener("spotifrei:close-now-playing", closeView);
    return () => {
      window.removeEventListener("spotifrei:open-now-playing", openView);
      window.removeEventListener("spotifrei:close-now-playing", closeView);
    };
  }, []);
}

/** Everything the player does besides driving the audio decks. */
export function usePlayerSideEffects(): void {
  usePlayRecorder();
  useTabTitle();
  useRadioTopUp();
  useMediaSession();
  useSleepTimer();
  usePlayerShortcuts();
  useNowPlayingBridge();
}
