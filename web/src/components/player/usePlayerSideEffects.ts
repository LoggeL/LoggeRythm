"use client";

import { useEffect, useRef } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import { useAudioEffectsStore } from "@/store/audioEffects";
import { useConnectStore } from "@/store/connect";
import { useUiModalsStore } from "@/store/uiModals";
import { openAddToPlaylist } from "@/store/addToPlaylist";
import {
  PLAYER_SESSION_KEY,
  capturePlayerSession,
  parsePlayerSession,
  restoredPlayerState,
} from "@/store/playerSession";
import { api } from "@/lib/api";
import { readLivePlaybackClock } from "@/lib/playbackClock";
import { useMe } from "@/hooks/useAuth";
import { useLikedTrack, useToggleLike } from "@/hooks/useLibrary";
import { readLocalJsonSnapshot, writeLocalJsonValue } from "@/hooks/useLocalJson";
import { trackArtistLabel } from "@/lib/trackArtists";
import { toast } from "@/store/toast";

const APP_TITLE = "LoggeRythm";

// A session is brought back once per page load; a later remount of the player
// (sign-out and sign-in without a reload) must not overwrite the live queue.
let playerSessionRestored = false;
// The restored entry was already counted as a play before the reload.
let restoredTrackId: string | null = null;

function removePlayerSession(): void {
  try {
    window.localStorage.removeItem(PLAYER_SESSION_KEY);
  } catch (cause) {
    throw new Error(
      `Lokale Daten "${PLAYER_SESSION_KEY}" konnten nicht entfernt werden: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

function savePlayerSession(userId: string): void {
  const snapshot = capturePlayerSession(usePlayerStore.getState(), userId);
  if (snapshot) writeLocalJsonValue(PLAYER_SESSION_KEY, snapshot);
  else removePlayerSession();
}

function restorePlayerSession(userId: string): void {
  const stored = readLocalJsonSnapshot<unknown>(PLAYER_SESSION_KEY, null);
  if (stored === null) return;
  const snapshot = parsePlayerSession(stored);
  if (snapshot.userId !== userId) {
    removePlayerSession();
    return;
  }
  const live = usePlayerStore.getState();
  if (live.partyBridge || live.queue.length > 0) return;
  restoredTrackId = snapshot.index >= 0 ? snapshot.queue[snapshot.index].id : null;
  usePlayerStore.setState((state) => ({
    ...restoredPlayerState(snapshot),
    radioSession: state.radioSession + 1,
  }));
}

function usePlayerSession() {
  const { data: me } = useMe();
  const userId = me ? String(me.id) : null;
  useEffect(() => {
    if (userId === null) return;
    if (!playerSessionRestored) {
      playerSessionRestored = true;
      restorePlayerSession(userId);
    }
    const save = () => savePlayerSession(userId);
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [userId]);
}

/**
 * Keep a stable per-play-occurrence Idempotency-Key across retries so a
 * timed-out `POST /api/me/plays` never double-counts when retried.
 */
export function resolvePlayIdempotencyKey(
  existing: { occurrence: string; key: string } | null,
  occurrence: string,
  createKey: () => string,
): { occurrence: string; key: string } {
  if (existing && existing.occurrence === occurrence) return existing;
  return { occurrence, key: createKey() };
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `play-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Record a play once per (new) track for approved, logged-in users playing locally. */
function usePlayRecorder() {
  const track = usePlayerStore(currentTrack);
  const index = usePlayerStore((s) => s.index);
  const suppressLocalAudio = usePlayerStore((s) => s.suppressLocalAudio);
  const { data: me } = useMe();
  const recorded = useRef<string | null>(null);
  const pendingKey = useRef<{ occurrence: string; key: string } | null>(null);
  const trackId = track?.id ?? null;
  const occurrence = trackId !== null ? `${index}:${trackId}` : null;
  useEffect(() => {
    if (suppressLocalAudio || !track || !trackId || !occurrence || !me?.is_approved) return;
    if (recorded.current === occurrence) return;
    recorded.current = occurrence;
    const alreadyCounted = restoredTrackId === trackId;
    restoredTrackId = null;
    if (alreadyCounted) {
      pendingKey.current = null;
      return;
    }
    const keyEntry = resolvePlayIdempotencyKey(pendingKey.current, occurrence, generateIdempotencyKey);
    pendingKey.current = keyEntry;
    api.recordPlay(track, keyEntry.key)
      .then(() => {
        if (pendingKey.current?.occurrence === occurrence) {
          pendingKey.current = null;
        }
      })
      .catch((error: unknown) => {
        if (recorded.current === occurrence) recorded.current = null;
        toast.error(`Hörverlauf konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [suppressLocalAudio, trackId, occurrence, track, me?.is_approved]);
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
  const suppressLocalAudio = usePlayerStore((s) => s.suppressLocalAudio);
  const radioActive = usePlayerStore((s) => s.radioActive);
  const radioSession = usePlayerStore((s) => s.radioSession);
  const queueLen = usePlayerStore((s) => s.queue.length);
  const index = usePlayerStore((s) => s.index);
  const fetchingSession = useRef<number | null>(null);

  useEffect(() => {
    if (suppressLocalAudio || !radioActive || !track) return;
    if (queueLen - index > 2) return;
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
        usePlayerStore.getState().setRadioActive(false);
        toast.error(
          `Song-Radio konnte nicht erweitert werden: ${e instanceof Error ? e.message : String(e)}`,
        );
      })
      .finally(() => {
        if (fetchingSession.current === requestSession) fetchingSession.current = null;
      });
  }, [suppressLocalAudio, radioActive, radioSession, index, queueLen, track]);
}

const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  "play", "pause", "previoustrack", "nexttrack", "seekto", "seekforward", "seekbackward", "stop",
];

/**
 * Pure helper validating and clamping a MediaPositionState payload before
 * handing it to `navigator.mediaSession.setPositionState` (browsers throw
 * `TypeError` if `duration <= 0`, `position > duration`, or any field is NaN).
 */
export function buildMediaPositionState(
  duration: number,
  position: number,
  playbackRate: number,
): MediaPositionState | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(position)) return null;
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) return null;
  return {
    duration,
    playbackRate,
    position: Math.max(0, Math.min(position, duration)),
  };
}

/** MediaSession: OS media keys + lock-screen metadata + live progress bar. */
function useMediaSession() {
  const track = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const playbackRate = useAudioEffectsStore((s) => s.playbackRate);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (!track) {
      session.metadata = null;
      if (typeof session.setPositionState === "function") {
        session.setPositionState();
      }
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

  // Publish live playback position to OS media controls (macOS Now Playing,
  // Windows SMTC, Chrome Media Hub, Android lock screen).
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      typeof navigator.mediaSession.setPositionState !== "function" ||
      !track
    ) {
      return;
    }
    const publishPosition = () => {
      const state = usePlayerStore.getState();
      const liveClock = readLivePlaybackClock();
      const pos =
        !state.suppressLocalAudio &&
        liveClock &&
        liveClock.trackId === String(track.id)
          ? liveClock.currentTime
          : state.currentTime;
      const payload = buildMediaPositionState(
        state.duration || track.duration_sec || 0,
        pos,
        useAudioEffectsStore.getState().playbackRate,
      );
      if (!payload) return;
      navigator.mediaSession.setPositionState(payload);
    };
    publishPosition();
    if (!isPlaying) return;
    const interval = window.setInterval(publishPosition, 5_000);
    return () => window.clearInterval(interval);
  }, [track, duration, isPlaying, seekTo, playbackRate]);
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
    }, 500);
    return () => window.clearInterval(interval);
  }, [sleepAt]);
}

/** Handles the `L` keyboard shortcut to like/unlike the currently playing song. */
function useLikeCurrentTrackShortcut() {
  const { data: me } = useMe();
  const track = usePlayerStore(currentTrack);
  const matchedLike = useLikedTrack(
    track ?? { id: "", title: "", artist: "", album: "", cover: "", duration_sec: 0 },
    Boolean(me && track),
  );
  const toggleLike = useToggleLike(track?.id ?? "");
  const stateRef = useRef({ me, track, matchedLike, toggleLike });
  useEffect(() => {
    stateRef.current = { me, track, matchedLike, toggleLike };
  }, [me, track, matchedLike, toggleLike]);

  useEffect(() => {
    const onToggleLike = () => {
      const { me: user, track: current, matchedLike: matched, toggleLike: mutateLike } = stateRef.current;
      if (!user || !current || mutateLike.isPending) return;
      const liked = matched !== undefined;
      mutateLike.mutate(
        { track: current, liked, matchedLikeId: matched?.id },
        {
          onSuccess: () => {
            toast.info(liked ? "Aus Lieblingssongs entfernt." : "Zu Lieblingssongs hinzugefügt.");
          },
        },
      );
    };
    window.addEventListener("spotifrei:toggle-current-like", onToggleLike);
    return () => window.removeEventListener("spotifrei:toggle-current-like", onToggleLike);
  }, []);
}

const INTERACTIVE_TARGETS =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="tab"], [role="slider"], [role="combobox"], [role="menuitem"]';

/**
 * Global keyboard shortcuts (ignored while a control has focus):
 * - Always available: Q queue · / focus search · ? shortcuts help · D devices
 * - With a loaded track: Space play/pause · ←/→ seek 5 s · ↑/↓ volume ·
 *   0–9 seek 0–90 % · M mute · S shuffle · R repeat · L like · A add to playlist ·
 *   T lyrics · F fullscreen · V visualizer · C cinema · Shift+N / Shift+P next / prev.
 */
function usePlayerShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || el?.closest(INTERACTIVE_TARGETS)) {
        return;
      }
      const s = usePlayerStore.getState();
      const rawKey = e.key;
      const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;

      // Shortcuts available even when no track is loaded.
      if (rawKey === "?" || (e.shiftKey && rawKey === "/")) {
        e.preventDefault();
        useUiModalsStore.getState().toggleShortcuts();
        return;
      }
      if (rawKey === "/" && !e.shiftKey) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>("[data-global-search-input]");
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        } else {
          window.dispatchEvent(new Event("open-command-palette"));
        }
        return;
      }
      if (key === "q" && !e.shiftKey) {
        e.preventDefault();
        s.toggleQueue();
        return;
      }
      if (key === "d" && !e.shiftKey) {
        e.preventDefault();
        const connect = useConnectStore.getState();
        connect.setSelectorOpen(!connect.selectorOpen, null);
        return;
      }

      if (s.index < 0) return;

      // 0–9 jump to 0%–90% of the current track duration.
      if (!e.shiftKey && rawKey.length === 1 && rawKey >= "0" && rawKey <= "9") {
        if (s.duration > 0) {
          e.preventDefault();
          s.seek((Number(rawKey) / 10) * s.duration);
        }
        return;
      }

      const actions: Record<string, () => void> = {
        " ": s.toggle,
        ArrowRight: () => s.seek(Math.min(s.currentTime + 5, s.duration || s.currentTime + 5)),
        ArrowLeft: () => s.seek(Math.max(s.currentTime - 5, 0)),
        ArrowUp: () => s.setVolume(Math.min(s.volume + 0.05, 1)),
        ArrowDown: () => s.setVolume(Math.max(s.volume - 0.05, 0)),
        m: s.toggleMute,
        s: s.toggleShuffle,
        r: s.cycleRepeat,
        l: () => window.dispatchEvent(new Event("spotifrei:toggle-current-like")),
        a: () => {
          const cur = currentTrack(usePlayerStore.getState());
          if (cur) openAddToPlaylist(cur);
        },
        t: s.toggleLyrics,
        f: () => setNowPlayingOpen(!s.nowPlayingOpen),
        v: () => {
          useUiModalsStore.getState().cycleVisualizer();
          if (!s.nowPlayingOpen) setNowPlayingOpen(true);
        },
        c: () => {
          if (!s.nowPlayingOpen) setNowPlayingOpen(true);
          useUiModalsStore.getState().toggleCinemaMode();
        },
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
  if (!open) {
    useUiModalsStore.getState().setCinemaMode(false);
  }
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
  usePlayerSession();
  usePlayRecorder();
  useTabTitle();
  useRadioTopUp();
  useMediaSession();
  useSleepTimer();
  useLikeCurrentTrackShortcut();
  usePlayerShortcuts();
  useNowPlayingBridge();
}
