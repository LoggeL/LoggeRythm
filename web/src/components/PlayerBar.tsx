"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePlayerStore, currentTrack } from "@/store/player";
import { api, streamUrl } from "@/lib/api";
import {
  ensureAnalyser,
  releaseAnalyser,
  applyVolume,
  perceptualVolume,
} from "@/lib/audioAnalyser";
import { calculateLoudnessGain, loudnessMetadataFromTrack } from "@/lib/loudness";
import { playWithMediaRecovery } from "@/lib/mediaPlayback";
import { useMe } from "@/hooks/useAuth";
import { formatTime } from "@/lib/format";
import { trackArtistLabel } from "@/lib/trackArtists";
import LikeButton from "@/components/LikeButton";
import NowPlaying from "@/components/now-playing/NowPlaying";
import TrackContext from "@/components/TrackContext";
import CacheMarker from "@/components/CacheMarker";
import ArtistLinks from "@/components/ArtistLinks";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import {
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  VolumeIcon,
  VolumeMutedIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOneIcon,
  QueueIcon,
  LyricsIcon,
  SpinnerIcon,
  ExpandIcon,
} from "@/components/icons";
import { toast } from "@/store/toast";

// The player uses the same quiet controls as the rest of the app.
const ICON_BTN = "action-icon h-9 w-9 shrink-0";
const ICON_IDLE = "text-muted hover:text-foreground hover:bg-white/10";
const SQUARE_IDLE = "text-muted hover:text-foreground hover:bg-white/5";
const SQUARE_ACTIVE = "text-accent bg-accent/10 hover:bg-accent/15";

/** A violet-filled track for range inputs (filled up to `pct` percent). */
function rangeFill(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  return `linear-gradient(to right, var(--accent) 0%, var(--accent) ${p}%, var(--border) ${p}%, var(--border) 100%)`;
}

const MEDIA_ERROR_LABELS: Record<number, string> = {
  1: "Wiedergabe abgebrochen",
  2: "Netzwerkfehler",
  3: "Dekodierung fehlgeschlagen",
  4: "Quelle nicht unterstützt",
};

/**
 * Build a human-readable reason for a failed stream: the ``<audio>`` MediaError
 * plus the backend's actual response (HTTP status + ``detail``), so the UI can
 * show *why* a title failed instead of a bare generic message.
 */
async function describeStreamFailure(
  url: string,
  mediaErr: MediaError | null,
): Promise<string> {
  const parts: string[] = [];
  if (mediaErr) {
    parts.push(MEDIA_ERROR_LABELS[mediaErr.code] || `MediaError ${mediaErr.code}`);
    if (mediaErr.message) parts.push(mediaErr.message);
  }
  if (url) {
    try {
      const res = await fetch(url, { headers: { Range: "bytes=0-1" } });
      if (!res.ok) {
        let body = "";
        try {
          const j = await res.clone().json();
          body = j?.detail ?? JSON.stringify(j);
        } catch {
          try {
            body = await res.text();
          } catch {
            /* ignore */
          }
        }
        parts.push(`Server ${res.status}${body ? `: ${String(body).slice(0, 200)}` : ""}`);
      }
    } catch (err) {
      parts.push(`Netzwerk: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return parts.join(" · ") || "Unbekannter Fehler";
}

type DeckIndex = 0 | 1;

interface CrossfadeRun {
  outgoing: HTMLAudioElement;
  incoming: HTMLAudioElement;
  outgoingIdx: DeckIndex;
  incomingIdx: DeckIndex;
  outgoingId: string;
  incomingId: string;
  timer: number | null;
  cancelled: boolean;
}

function releaseMedia(el: HTMLAudioElement): void {
  el.pause();
  el.removeAttribute("src");
  el.dataset.trackId = "";
  el.load();
}

export default function PlayerBar() {
  // Two interchangeable decks: one is "active" (drives the store + UI), the
  // other prefetches the next track for a gapless crossfade. On handoff we just
  // swap which deck is active — the faded-in deck keeps playing, so there is no
  // reload, no seek and no restart.
  const deckA = useRef<HTMLAudioElement>(null);
  const deckB = useRef<HTMLAudioElement>(null);
  const [activeIdx, setActiveIdx] = useState<DeckIndex>(0);
  const activeIdxRef = useRef<DeckIndex>(0);
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);
  const pendingSeekCancel = useRef<(() => void) | null>(null);

  const crossfadeRun = useRef<CrossfadeRun | null>(null);
  const cancelCrossfade = useCallback(() => {
    const run = crossfadeRun.current;
    if (!run) return;
    run.cancelled = true;
    if (run.timer !== null) window.clearInterval(run.timer);
    releaseMedia(run.incoming);
    const state = usePlayerStore.getState();
    const activeTrack = currentTrack(state);
    const gain = calculateLoudnessGain(
      activeTrack ? loudnessMetadataFromTrack(activeTrack) : null,
    ).gainLinear;
    applyVolume(
      run.outgoing,
      state.muted ? 0 : perceptualVolume(state.volume) * gain,
    );
    crossfadeRun.current = null;
  }, []);
  // Auto-skip a failed track after a short grace period so a single dead
  // source doesn't stall the whole queue.
  const errorSkipTimer = useRef<number | null>(null);
  const clearErrorSkip = useCallback(() => {
    if (errorSkipTimer.current !== null) {
      clearTimeout(errorSkipTimer.current);
      errorSkipTimer.current = null;
    }
  }, []);
  // Transient stream failures (e.g. the backend answers 500 while it is still
  // fetching the title) get silent-to-the-user retries before we alarm anyone.
  // Tracks how many reload attempts the current track has used up.
  const errorRetries = useRef<{ id: string; count: number }>({ id: "", count: 0 });
  const errorRetryTimer = useRef<number | null>(null);
  const clearErrorRetry = useCallback(() => {
    if (errorRetryTimer.current !== null) {
      clearTimeout(errorRetryTimer.current);
      errorRetryTimer.current = null;
    }
  }, []);
  const pendingRetrySeekCancel = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      cancelCrossfade();
      clearErrorSkip();
      clearErrorRetry();
      pendingSeekCancel.current?.();
      pendingRetrySeekCancel.current?.();
      for (const deck of [deckA.current, deckB.current]) {
        if (!deck) continue;
        releaseMedia(deck);
        releaseAnalyser(deck);
      }
    },
    [cancelCrossfade, clearErrorRetry, clearErrorSkip],
  );
  const [expanded, setExpanded] = useState(false);
  // A preload begins only after the current deck is ready. That
  // avoids competing with the current track's first materialization while
  // still giving the next download almost the full song length to finish.
  const [readyTrackId, setReadyTrackId] = useState<string | null>(null);
  const [preloadFailure, setPreloadFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);

  const queueOpen = usePlayerStore((s) => s.queueOpen);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const lyricsOpen = usePlayerStore((s) => s.lyricsOpen);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);

  const track = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const error = usePlayerStore((s) => s.error);

  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const _setCurrentTime = usePlayerStore((s) => s._setCurrentTime);
  const _setDuration = usePlayerStore((s) => s._setDuration);
  const _onEnded = usePlayerStore((s) => s._onEnded);
  const _crossfadeAdvance = usePlayerStore((s) => s._crossfadeAdvance);
  const _clearSeek = usePlayerStore((s) => s._clearSeek);
  const _setBuffering = usePlayerStore((s) => s._setBuffering);
  const _setError = usePlayerStore((s) => s._setError);

  const trackId = track?.id ?? null;
  const trackLoudnessGain = calculateLoudnessGain(
    track ? loudnessMetadataFromTrack(track) : null,
  ).gainLinear;

  const reportPlayFailure = useCallback(
    (
      el: HTMLAudioElement,
      idx: DeckIndex,
      expectedId: string,
      reason: unknown,
    ) => {
      const state = usePlayerStore.getState();
      if (
        activeIdxRef.current !== idx ||
        el.dataset.trackId !== expectedId ||
        String(currentTrack(state)?.id ?? "") !== expectedId ||
        !el.paused ||
        !state.isPlaying
      ) {
        return;
      }
      const detail = reason instanceof Error ? reason.message : String(reason);
      const message = `Wiedergabe konnte nicht gestartet werden: ${detail}`;
      console.error(`[player] play() rejected for track ${expectedId}`, reason);
      state.pause();
      state._setError(message);
      toast.error(message);
    },
    [],
  );

  const deckOwnsCurrentTrack = useCallback(
    (idx: DeckIndex, el: HTMLAudioElement) => {
      const state = usePlayerStore.getState();
      return (
        activeIdxRef.current === idx &&
        el.dataset.trackId === String(currentTrack(state)?.id ?? "")
      );
    },
    [],
  );

  const prepareFailedDeckReload = useCallback(
    (expectedId: string) => {
      cancelCrossfade();
      clearErrorRetry();
      clearErrorSkip();
      pendingSeekCancel.current?.();
      pendingSeekCancel.current = null;
      pendingRetrySeekCancel.current?.();
      pendingRetrySeekCancel.current = null;
      errorRetries.current = { id: expectedId, count: 0 };
      setReadyTrackId(null);
      const state = usePlayerStore.getState();
      // Preserve the failure until an actual playing event confirms recovery.
      // Replay already requested zero; a resumed title keeps its last position.
      state._setBuffering(true);
      state.seek(state.seekTo ?? state.currentTime);
    },
    [cancelCrossfade, clearErrorRetry, clearErrorSkip],
  );

  const { data: me } = useMe();
  const recordedRef = useRef<string | null>(null);

  const radioActive = usePlayerStore((s) => s.radioActive);
  const radioSession = usePlayerStore((s) => s.radioSession);
  const queueLen = usePlayerStore((s) => s.queue.length);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const sleepAfterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  // A replacement station may start while the previous top-up is still in
  // flight. Track the owning session instead of globally blocking all fetches.
  const radioFetchingSession = useRef<number | null>(null);
  const { data: settings } = useQuery({
    queryKey: ["playback-settings"],
    queryFn: api.settings,
    enabled: !!me?.is_approved,
    staleTime: 5 * 60_000,
  });

  const nextTrack =
    !sleepAfterTrack && repeat !== "one" && index >= 0
      ? index < queue.length - 1
        ? queue[index + 1]
        : repeat === "all"
          ? queue[0]
          : null
      : null;
  const currentTrackId = trackId == null ? null : String(trackId);
  const nextTrackId = nextTrack == null ? null : String(nextTrack.id);
  const nextTrackTitle = nextTrack == null ? null : nextTrack.title;
  // Repeating a one-item queue is already backed by the current materialized
  // file, so there is nothing new to preload.
  const preloadKey =
    currentTrackId && nextTrackId && currentTrackId !== nextTrackId
      ? `${currentTrackId}:${nextTrackId}`
      : null;
  const visiblePreloadError =
    preloadKey && preloadFailure?.key === preloadKey
      ? preloadFailure.message
      : null;

  // Materialize the next queue entry on the server while the current title is
  // playing. Obsolete requests are allowed to finish because aborting the
  // browser request cannot stop the backend worker; the cached file stays useful.
  useEffect(() => {
    if (
      !preloadKey ||
      readyTrackId !== currentTrackId ||
      !nextTrackId ||
      nextTrackTitle == null
    ) {
      return;
    }

    let relevant = true;
    api
      .preloadTrack(nextTrackId)
      .then(() => {
        if (!relevant) return;
        setPreloadFailure((failure) =>
          failure?.key === preloadKey ? null : failure,
        );
      })
      .catch((reason: unknown) => {
        const detail = reason instanceof Error ? reason.message : String(reason);
        const message = `„${nextTrackTitle}“ konnte nicht vorgeladen werden: ${detail}`;
        console.error(`[player] next-track preload failed (${preloadKey})`, reason);
        if (!relevant) return;
        setPreloadFailure({ key: preloadKey, message });
        toast.error(message);
      });

    return () => {
      relevant = false;
    };
  }, [currentTrackId, nextTrackId, nextTrackTitle, preloadKey, readyTrackId]);

  // Record a play once per (new) track for approved, logged-in users.
  useEffect(() => {
    if (!track || !trackId) return;
    if (!me?.is_approved) return;
    if (recordedRef.current === trackId) return;
    recordedRef.current = trackId;
    api.recordPlay(track).catch((error: unknown) => {
      if (recordedRef.current === trackId) recordedRef.current = null;
      toast.error(`Hörverlauf konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [trackId, track, me?.is_approved]);

  // Reflect the current song in the browser tab title.
  useEffect(() => {
    const base = "LoggeRythm";
    document.title = track
      ? `${track.title} • ${trackArtistLabel(track)}`
      : base;
    return () => {
      document.title = base;
    };
  }, [trackId, track]);

  // Endless radio: when near the end, pull the next ~5 similar songs
  // seeded by the current track (so the station keeps evolving).
  useEffect(() => {
    if (!radioActive || !track) return;
    if (queueLen - index > 2) return; // still have a buffer
    if (radioFetchingSession.current === radioSession) return;
    radioFetchingSession.current = radioSession;
    const requestSession = radioSession;
    api
      .radio(String(track.id))
      .then((more) => {
        const state = usePlayerStore.getState();
        if (
          state.radioSession !== requestSession ||
          !state.radioActive
        ) {
          return;
        }
        const have = new Set(state.queue.map((t) => String(t.id)));
        const fresh = more.filter((t) => !have.has(String(t.id))).slice(0, 5);
        if (fresh.length) state.appendToQueue(fresh);
      })
      .catch((e) => {
        const state = usePlayerStore.getState();
        if (
          state.radioSession !== requestSession ||
          !state.radioActive
        ) {
          return;
        }
        // Stop the radio visibly instead of silently starving the queue.
        state.setRadioActive(false);
        toast.error(
          `Song-Radio konnte nicht erweitert werden: ${e instanceof Error ? e.message : String(e)}`,
        );
      })
      .finally(() => {
        if (radioFetchingSession.current === requestSession) {
          radioFetchingSession.current = null;
        }
      });
  }, [radioActive, radioSession, index, queueLen, track]);

  // Load the current track into the active deck — unless that deck is already
  // playing it, which is the case right after a crossfade handoff.
  useEffect(() => {
    const el = (activeIdx === 0 ? deckA : deckB).current;
    if (!el) return;
    const id = trackId ? String(trackId) : "";
    if (el.dataset.trackId !== id) {
      // Changing the active track invalidates every pending operation tied to
      // the previous deck, including a crossfade whose play() has not resolved.
      cancelCrossfade();
      pendingSeekCancel.current?.();
      pendingSeekCancel.current = null;
      pendingRetrySeekCancel.current?.();
      pendingRetrySeekCancel.current = null;
      if (id) {
        ensureAnalyser(el);
        el.src = streamUrl(id);
        el.dataset.trackId = id;
        el.currentTime = 0;
        const state = usePlayerStore.getState();
        applyVolume(
          el,
          state.muted ? 0 : perceptualVolume(state.volume) * trackLoudnessGain,
        );
      } else {
        releaseMedia(el);
      }
    }
    // No inactive deck should retain a previous download outside a handoff.
    const idle = (activeIdx === 0 ? deckB : deckA).current;
    if (
      idle &&
      !crossfadeRun.current &&
      (idle.dataset.trackId || idle.hasAttribute("src"))
    ) {
      releaseMedia(idle);
    }
  }, [activeIdx, trackId, trackLoudnessGain, cancelCrossfade]);

  // Reflect play/pause on the active deck.
  useEffect(() => {
    const el = (activeIdx === 0 ? deckA : deckB).current;
    if (!el) return;
    if (isPlaying) {
      // Lazily wire the analyser on play (a user gesture, so the AudioContext
      // may start) — powers the visualizers.
      ensureAnalyser(el);
      const expectedId = String(trackId ?? "");
      playWithMediaRecovery(el, () => prepareFailedDeckReload(expectedId)).catch((reason) => {
        reportPlayFailure(el, activeIdx, expectedId, reason);
      });
    } else {
      // Pausing invalidates pending and active handoffs so both decks stop.
      cancelCrossfade();
      el.pause();
    }
  }, [
    isPlaying,
    trackId,
    activeIdx,
    cancelCrossfade,
    prepareFailedDeckReload,
    reportPlayFailure,
  ]);

  // Sync volume + mute onto the active deck (the crossfade owns both deck
  // gains while it runs).
  useEffect(() => {
    const el = (activeIdx === 0 ? deckA : deckB).current;
    if (el && !crossfadeRun.current) {
      applyVolume(el, muted ? 0 : perceptualVolume(volume) * trackLoudnessGain);
    }
  }, [volume, muted, activeIdx, trackLoudnessGain]);

  // Crossfade: near the end of the active deck, fade the next track in on the
  // idle deck, then swap which deck is active — no reload, no seek, no restart.
  useEffect(() => {
    const seconds = settings?.crossfade_enabled
      ? settings.crossfade_duration_sec
      : 0;
    const eligible =
      seconds > 0 &&
      !!track &&
      isPlaying &&
      repeat !== "one" &&
      !usePlayerStore.getState().sleepAfterTrack &&
      duration > seconds + 1 &&
      currentTime >= duration - seconds &&
      index >= 0 &&
      index < queue.length - 1;
    if (!eligible) {
      cancelCrossfade();
      return;
    }

    const outgoing = (activeIdx === 0 ? deckA : deckB).current;
    const incoming = (activeIdx === 0 ? deckB : deckA).current;
    const nextTrack = queue[index + 1];
    if (!outgoing || !incoming || !nextTrack) return;

    const outgoingId = String(track.id);
    const incomingId = String(nextTrack.id);
    const existingRun = crossfadeRun.current;
    if (existingRun) {
      if (
        existingRun.outgoingIdx === activeIdx &&
        existingRun.outgoingId === outgoingId &&
        existingRun.incomingId === incomingId
      ) {
        return;
      }
      cancelCrossfade();
    }
    if (outgoing.dataset.trackId !== outgoingId) return;
    const incomingIdx = (activeIdx ^ 1) as DeckIndex;
    const incomingLoudnessGain = calculateLoudnessGain(
      loudnessMetadataFromTrack(nextTrack),
    ).gainLinear;
    const run: CrossfadeRun = {
      outgoing,
      incoming,
      outgoingIdx: activeIdx,
      incomingIdx,
      outgoingId,
      incomingId,
      timer: null,
      cancelled: false,
    };
    crossfadeRun.current = run;
    ensureAnalyser(incoming);
    incoming.src = streamUrl(incomingId);
    incoming.dataset.trackId = incomingId;
    incoming.currentTime = 0;
    applyVolume(incoming, 0, 0);

    incoming
      .play()
      .then(() => {
        if (run.cancelled || crossfadeRun.current !== run) return;
        const state = usePlayerStore.getState();
        if (
          activeIdxRef.current !== run.outgoingIdx ||
          String(currentTrack(state)?.id ?? "") !== outgoingId ||
          !state.isPlaying
        ) {
          cancelCrossfade();
          return;
        }

        const startedAt = performance.now();
        run.timer = window.setInterval(() => {
          if (run.cancelled || crossfadeRun.current !== run) return;
          const live = usePlayerStore.getState();
          if (
            activeIdxRef.current !== run.outgoingIdx ||
            String(currentTrack(live)?.id ?? "") !== outgoingId ||
            String(live.queue[live.index + 1]?.id ?? "") !== incomingId ||
            !live.isPlaying
          ) {
            cancelCrossfade();
            return;
          }

          const elapsed = (performance.now() - startedAt) / 1000;
          const pct = Math.min(1, elapsed / seconds);
          const targetVolume = live.muted ? 0 : perceptualVolume(live.volume);
          applyVolume(
            outgoing,
            targetVolume * trackLoudnessGain * (1 - pct),
            1 - pct,
          );
          applyVolume(
            incoming,
            targetVolume * incomingLoudnessGain * pct,
            pct,
          );

          if (pct < 1) return;
          if (run.timer !== null) {
            window.clearInterval(run.timer);
            run.timer = null;
          }
          // Switch event ownership before the atomic store transition so late
          // events from the outgoing deck cannot overwrite the incoming clock.
          activeIdxRef.current = incomingIdx;
          const advanced = _crossfadeAdvance(
            outgoingId,
            incomingId,
            incoming.currentTime,
            incoming.duration,
          );
          if (!advanced) {
            activeIdxRef.current = run.outgoingIdx;
            cancelCrossfade();
            return;
          }

          crossfadeRun.current = null;
          applyVolume(incoming, targetVolume * incomingLoudnessGain, 1);
          releaseMedia(outgoing);
          setActiveIdx(incomingIdx);
          setReadyTrackId(incomingId);
        }, 50);
      })
      .catch((reason: unknown) => {
        if (run.cancelled || crossfadeRun.current !== run) return;
        console.error(
          `[player] crossfade could not start for track ${incomingId}`,
          reason,
        );
        toast.error(
          `Übergang zu „${nextTrack.title}“ konnte nicht gestartet werden: ${
            reason instanceof Error ? reason.message : String(reason)
          }`,
        );
        cancelCrossfade();
        // If the outgoing track ended while play() was pending, its ended
        // event was intentionally deferred to this handoff.
        if (outgoing.ended) _onEnded();
      });
  }, [
    currentTime,
    duration,
    index,
    isPlaying,
    queue,
    repeat,
    settings?.crossfade_duration_sec,
    settings?.crossfade_enabled,
    track,
    trackLoudnessGain,
    activeIdx,
    _crossfadeAdvance,
    _onEnded,
    cancelCrossfade,
  ]);

  // Consume seek requests from the store on the active deck. Defer until
  // metadata is ready when the deck is still loading.
  useEffect(() => {
    if (seekTo == null) return;
    // Seeking during a handoff keeps one authoritative playhead.
    cancelCrossfade();
    pendingSeekCancel.current?.();
    pendingSeekCancel.current = null;
    const el = (activeIdx === 0 ? deckA : deckB).current;
    if (el) {
      const target = seekTo;
      const expectedId = el.dataset.trackId ?? "";
      // A same-ID replay can leave isPlaying unchanged, so it must also recover
      // here instead of waiting for metadata from an already failed source.
      if (el.error && usePlayerStore.getState().isPlaying) {
        playWithMediaRecovery(el, () => prepareFailedDeckReload(expectedId)).catch((reason) => {
          reportPlayFailure(el, activeIdx, expectedId, reason);
        });
      }
      const apply = () => {
        if (
          activeIdxRef.current !== activeIdx ||
          el.dataset.trackId !== expectedId
        ) {
          return;
        }
        try {
          el.currentTime = target;
          // Consecutive queue entries may use the same audio source. An ended
          // deck stays paused even though the next entry is marked playing.
          if (usePlayerStore.getState().isPlaying && el.paused) {
            el.play().catch((reason) => {
              reportPlayFailure(el, activeIdx, expectedId, reason);
            });
          }
        } catch (reason) {
          const detail =
            reason instanceof Error ? reason.message : String(reason);
          const message = `Wiedergabeposition konnte nicht gesetzt werden: ${detail}`;
          console.error(`[player] seek failed for track ${expectedId}`, reason);
          usePlayerStore.getState()._setError(message);
          toast.error(message);
        }
      };
      if (el.readyState >= 1) {
        apply();
      } else {
        const onReady = () => {
          el.removeEventListener("loadedmetadata", onReady);
          pendingSeekCancel.current = null;
          apply();
        };
        el.addEventListener("loadedmetadata", onReady);
        pendingSeekCancel.current = () => {
          el.removeEventListener("loadedmetadata", onReady);
          pendingSeekCancel.current = null;
        };
      }
    }
    _clearSeek();
  }, [seekTo, _clearSeek, activeIdx, cancelCrossfade, prepareFailedDeckReload, reportPlayFailure]);

  // MediaSession: OS media keys + metadata + artwork.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (!track) {
      session.metadata = null;
      return;
    }
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
    session.setActionHandler("play", () => usePlayerStore.getState().play());
    session.setActionHandler("pause", () => usePlayerStore.getState().pause());
    session.setActionHandler("previoustrack", () =>
      usePlayerStore.getState().prev(),
    );
    session.setActionHandler("nexttrack", () =>
      usePlayerStore.getState().next(),
    );
    session.setActionHandler("seekto", (detail) => {
      if (detail.seekTime != null) usePlayerStore.getState().seek(detail.seekTime);
    });
    session.setActionHandler("seekforward", (detail) => {
      const state = usePlayerStore.getState();
      state.seek(
        Math.min(
          state.currentTime + (detail.seekOffset ?? 10),
          state.duration || 0,
        ),
      );
    });
    session.setActionHandler("seekbackward", (detail) => {
      const state = usePlayerStore.getState();
      state.seek(Math.max(state.currentTime - (detail.seekOffset ?? 10), 0));
    });
    try {
      session.setActionHandler("stop", () => usePlayerStore.getState().pause());
    } catch {
      // "stop" is not supported everywhere
    }

    return () => {
      session.metadata = null;
      const actions: MediaSessionAction[] = [
        "play",
        "pause",
        "previoustrack",
        "nexttrack",
        "seekto",
        "seekforward",
        "seekbackward",
        "stop",
      ];
      for (const action of actions) {
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
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      // unsupported
    }
  }, [isPlaying]);

  // Sleep timer: pause when the deadline passes.
  const sleepAt = usePlayerStore((s) => s.sleepAt);
  useEffect(() => {
    if (sleepAt == null) return;
    const tick = () => {
      const s = usePlayerStore.getState();
      if (s.sleepAt != null && Date.now() >= s.sleepAt) {
        s.setSleepTimer(null);
        s.pause();
        toast.info("Sleep-Timer: Wiedergabe pausiert.");
      }
    };
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [sleepAt]);

  // Keyboard shortcuts (ignore while typing in inputs).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (
        e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey ||
        el?.closest('input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="tab"], [role="slider"], [role="combobox"], [role="menuitem"]')
      ) {
        return;
      }
      const s = usePlayerStore.getState();
      if (s.index < 0) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          s.toggle();
          break;
        case "ArrowRight":
          e.preventDefault();
          s.seek(Math.min(s.currentTime + 5, s.duration || s.currentTime + 5));
          break;
        case "ArrowLeft":
          e.preventDefault();
          s.seek(Math.max(s.currentTime - 5, 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          s.setVolume(Math.min(s.volume + 0.05, 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          s.setVolume(Math.max(s.volume - 0.05, 0));
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasTrack = !!track;
  const RepeatGlyph = repeat === "one" ? RepeatOneIcon : RepeatIcon;
  const openFullscreen = () => {
    setExpanded(true);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {
        // Browser fullscreen can be denied by the browser; keep app fullscreen.
      });
    }
  };
  const closeFullscreen = () => {
    setExpanded(false);
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {
        // ignore browser fullscreen exit failures
      });
    }
  };

  // A new track (manual skip, queue advance) invalidates any pending
  // auto-skip from the previous track's failure.
  useEffect(() => {
    clearErrorSkip();
    clearErrorRetry();
    pendingRetrySeekCancel.current?.();
    pendingRetrySeekCancel.current = null;
    errorRetries.current = { id: "", count: 0 };
    return () => {
      clearErrorSkip();
      clearErrorRetry();
      pendingRetrySeekCancel.current?.();
      pendingRetrySeekCancel.current = null;
    };
  }, [trackId, clearErrorRetry, clearErrorSkip]);

  useEffect(() => {
    document.body.dataset.nowPlayingExpanded = expanded ? "true" : "false";

    window.addEventListener("spotifrei:close-now-playing", closeFullscreen);
    window.addEventListener("spotifrei:open-now-playing", openFullscreen);
    return () => {
      window.removeEventListener("spotifrei:close-now-playing", closeFullscreen);
      window.removeEventListener("spotifrei:open-now-playing", openFullscreen);
      document.body.dataset.nowPlayingExpanded = "false";
    };
  }, [expanded]);

  // Only the active deck drives the store. These functions are called from
  // explicit JSX media-event handlers, never while React is rendering.
  const handleTimeUpdate = (
    idx: DeckIndex,
    e: SyntheticEvent<HTMLAudioElement>,
  ) => {
    if (deckOwnsCurrentTrack(idx, e.currentTarget)) {
      _setCurrentTime(e.currentTarget.currentTime);
    }
  };
  const handleLoadedMetadata = (
    idx: DeckIndex,
    e: SyntheticEvent<HTMLAudioElement>,
  ) => {
    if (!deckOwnsCurrentTrack(idx, e.currentTarget)) return;
    const d = e.currentTarget.duration;
    if (Number.isFinite(d)) _setDuration(d);
  };
  const handleEnded = (idx: DeckIndex, e: SyntheticEvent<HTMLAudioElement>) => {
    if (
      !deckOwnsCurrentTrack(idx, e.currentTarget) ||
      crossfadeRun.current
    ) {
      return;
    }
    const element = e.currentTarget;
    const expectedId = element.dataset.trackId ?? "";
    const state = usePlayerStore.getState();
    const shouldRestart =
      state.repeat === "one" && !state.sleepAfterTrack && state.index >= 0;
    _onEnded();
    if (shouldRestart) {
      element.currentTime = 0;
      element.play().catch((reason) => {
        reportPlayFailure(element, idx, expectedId, reason);
      });
    }
  };
  const handleWaiting = (
    idx: DeckIndex,
    e: SyntheticEvent<HTMLAudioElement>,
  ) => {
    if (deckOwnsCurrentTrack(idx, e.currentTarget)) _setBuffering(true);
  };
  const handlePlaying = (
    idx: DeckIndex,
    e: SyntheticEvent<HTMLAudioElement>,
  ) => {
    if (!deckOwnsCurrentTrack(idx, e.currentTarget)) return;
    clearErrorSkip(); // recovered — cancel any pending auto-skip
    clearErrorRetry();
    pendingRetrySeekCancel.current?.();
    pendingRetrySeekCancel.current = null;
    errorRetries.current = { id: "", count: 0 };
    _setBuffering(false);
    _setError(null);
  };
  const handleCanPlay = (
    idx: DeckIndex,
    e: SyntheticEvent<HTMLAudioElement>,
  ) => {
    if (!deckOwnsCurrentTrack(idx, e.currentTarget)) return;
    const id = e.currentTarget.dataset.trackId;
    if (id) setReadyTrackId(id);
    _setBuffering(false);
  };
  const handleError = (idx: DeckIndex, e: SyntheticEvent<HTMLAudioElement>) => {
    const el = e.currentTarget;
    const run = crossfadeRun.current;
    if (activeIdxRef.current !== idx) {
      if (
        run &&
        !run.cancelled &&
        run.incomingIdx === idx &&
        run.incoming === el
      ) {
        const detail =
          el.error?.message ||
          MEDIA_ERROR_LABELS[el.error?.code ?? 0] ||
          "Unbekannter Fehler";
        console.error(
          `[player] crossfade media error for track ${run.incomingId}: ${detail}`,
        );
        toast.error(`Übergang zum nächsten Titel fehlgeschlagen: ${detail}`);
        const outgoingEnded = run.outgoing.ended;
        cancelCrossfade();
        if (outgoingEnded) _onEnded();
      }
      return;
    }
    const mediaErr = el.error;
    const id = el.dataset.trackId || "";
    if (!deckOwnsCurrentTrack(idx, el)) return;

    // First failures are often transient (the backend answers 500 while it
    // is still fetching/transcoding the title). Reload a couple of times
    // with backoff before alarming the user or skipping.
    if (errorRetries.current.id !== id) errorRetries.current = { id, count: 0 };
    if (errorRetries.current.count < 2) {
      errorRetries.current.count += 1;
      const attempt = errorRetries.current.count;
      console.warn(
        `[player] stream error for track ${id} (${mediaErr?.code ?? "?"}: ${mediaErr?.message ?? "no detail"}) — retry ${attempt}/2`,
      );
      _setBuffering(true);
      clearErrorRetry();
      errorRetryTimer.current = window.setTimeout(() => {
        errorRetryTimer.current = null;
        const state = usePlayerStore.getState();
        const cur = currentTrack(state);
        if (activeIdxRef.current !== idx || String(cur?.id ?? "") !== id) return;
        // Mid-song failures resume where they broke off instead of at 0:00.
        const resumeAt = el.currentTime;
        pendingRetrySeekCancel.current?.();
        pendingRetrySeekCancel.current = null;
        if (resumeAt > 0) {
          const onMeta = () => {
            el.removeEventListener("loadedmetadata", onMeta);
            pendingRetrySeekCancel.current = null;
            if (
              activeIdxRef.current !== idx ||
              el.dataset.trackId !== id
            ) {
              return;
            }
            try {
              el.currentTime = resumeAt;
            } catch (reason) {
              const detail =
                reason instanceof Error ? reason.message : String(reason);
              const message = `Wiedergabeposition konnte nach dem erneuten Laden nicht wiederhergestellt werden: ${detail}`;
              console.error(`[player] retry seek failed for track ${id}`, reason);
              usePlayerStore.getState()._setError(message);
              toast.error(message);
            }
          };
          el.addEventListener("loadedmetadata", onMeta);
          pendingRetrySeekCancel.current = () => {
            el.removeEventListener("loadedmetadata", onMeta);
            pendingRetrySeekCancel.current = null;
          };
        }
        el.load(); // re-request the source from scratch
        if (state.isPlaying) {
          el.play().catch((reason) => {
            const mediaRetryRejection =
              reason instanceof DOMException &&
              (reason.name === "AbortError" ||
                reason.name === "NotSupportedError");
            if (mediaRetryRejection) {
              // The matching media error event owns the retry counter and
              // terminal state. Do not pause the store between attempts.
              console.warn(
                `[player] retry play() rejected for track ${id}; awaiting media error`,
                reason,
              );
              return;
            }
            reportPlayFailure(el, idx, id, reason);
          });
        }
      }, 1500 * attempt);
      return;
    }

    // Retries exhausted — now fail loudly.
    _setError("Titel konnte nicht geladen werden.");
    // Auto-skip after 5s so one dead source doesn't block the queue. Only
    // fire if we're still stuck on this same failed track.
    clearErrorSkip();
    errorSkipTimer.current = window.setTimeout(() => {
      errorSkipTimer.current = null;
      const cur = currentTrack(usePlayerStore.getState());
      if (activeIdxRef.current === idx && String(cur?.id ?? "") === id && el.error) {
        toast.info("Titel übersprungen.");
        next();
      }
    }, 5000);
    // Probe the backend for the real reason so the UI shows *why* it failed
    // (HTTP status + detail / decode error) instead of a bare message.
    describeStreamFailure(id ? streamUrl(id) : el.currentSrc, mediaErr).then(
      (detail) => {
        // Only surface the probe result if this deck is still the active one,
        // still on the same track AND still broken — playback may have
        // recovered while the probe was in flight, and a scary toast over a
        // playing song is worse than no detail at all.
        if (
          deckOwnsCurrentTrack(idx, el) &&
          el.dataset.trackId === id &&
          el.error
        ) {
          const msg = `Titel konnte nicht geladen werden — ${detail}`;
          _setError(msg);
          // Also toast: the inline player-bar text is easy to miss in
          // fullscreen or on mobile.
          toast.error(msg);
        }
      },
    );
  };

  return (
    <>
      {expanded && track && <NowPlaying onClose={closeFullscreen} />}
      <footer
        aria-label="Musikplayer"
        className="like-celebration-surface relative z-20 flex-shrink-0 border-t border-white/8 bg-panel px-3 pt-2 lg:px-5 lg:py-2"
      >
        {/* Two interchangeable decks — see the playback engine above. */}
        <audio
          ref={deckA}
          aria-hidden="true"
          preload="auto"
          onTimeUpdate={(e) => handleTimeUpdate(0, e)}
          onLoadedMetadata={(e) => handleLoadedMetadata(0, e)}
          onEnded={(e) => handleEnded(0, e)}
          onWaiting={(e) => handleWaiting(0, e)}
          onStalled={(e) => handleWaiting(0, e)}
          onPlaying={(e) => handlePlaying(0, e)}
          onCanPlay={(e) => handleCanPlay(0, e)}
          onError={(e) => handleError(0, e)}
        />
        <audio
          ref={deckB}
          aria-hidden="true"
          preload="auto"
          onTimeUpdate={(e) => handleTimeUpdate(1, e)}
          onLoadedMetadata={(e) => handleLoadedMetadata(1, e)}
          onEnded={(e) => handleEnded(1, e)}
          onWaiting={(e) => handleWaiting(1, e)}
          onStalled={(e) => handleWaiting(1, e)}
          onPlaying={(e) => handlePlaying(1, e)}
          onCanPlay={(e) => handleCanPlay(1, e)}
          onError={(e) => handleError(1, e)}
        />

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,1.2fr)_minmax(0,1fr)] lg:gap-x-6 lg:gap-y-1">
          <div className="flex min-w-0 items-center gap-3 lg:row-span-2">
            {track ? (
              <TrackContext track={track} className="contents">
                <button
                  type="button"
                  onClick={openFullscreen}
                  aria-label="Jetzt läuft öffnen"
                  title="Jetzt läuft öffnen"
                  className="flex-shrink-0 rounded-lg transition hover:opacity-80"
                >
                  {track.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={track.cover} alt="" className="h-11 w-11 rounded-lg object-cover lg:h-12 lg:w-12" />
                  ) : (
                    <CoverPlaceholder className="h-11 w-11 rounded-lg lg:h-12 lg:w-12" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={openFullscreen}
                    className="block w-full truncate text-left text-sm font-semibold lg:hidden"
                    aria-label={`${track.title}: Jetzt läuft öffnen`}
                  >
                    {track.title}
                  </button>
                  {track.album_id ? (
                    <Link href={`/album/${track.album_id}`} className="hidden truncate text-sm font-semibold hover:underline lg:block">
                      {track.title}
                    </Link>
                  ) : (
                    <p className="hidden truncate text-sm font-semibold lg:block">{track.title}</p>
                  )}
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <CacheMarker trackId={track.id} />
                    <ArtistLinks track={track} className="truncate text-xs text-muted" linkClassName="hover:underline hover:text-foreground" />
                  </div>
                </div>
                <div className="hidden lg:block">
                  <LikeButton key={track.id} track={track} />
                </div>
              </TrackContext>
            ) : (
              <p className="py-3 text-sm text-muted">Wähle einen Titel zum Abspielen.</p>
            )}
          </div>

          <div className={`flex items-center justify-end gap-1 lg:justify-center lg:gap-2 ${hasTrack ? "" : "hidden lg:flex"}`}>
            <button
              type="button"
              onClick={toggleShuffle}
              disabled={!hasTrack}
              aria-label="Zufallswiedergabe"
              aria-pressed={shuffle}
              title="Zufallswiedergabe"
              className={`action-icon hidden h-9 w-9 disabled:opacity-40 lg:grid ${shuffle ? "bg-accent/10 text-accent" : ICON_IDLE}`}
            >
              <ShuffleIcon width={17} height={17} />
            </button>
            <button
              type="button"
              onClick={prev}
              disabled={!hasTrack}
              aria-label="Vorheriger Titel"
              className={`action-icon hidden h-9 w-9 disabled:opacity-40 lg:grid ${ICON_IDLE}`}
            >
              <PrevIcon width={21} height={21} />
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={!hasTrack}
              aria-label={isPlaying ? "Pause" : "Abspielen"}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foreground text-background transition hover:opacity-85 disabled:opacity-40"
            >
              {isBuffering ? (
                <SpinnerIcon width={21} height={21} className="animate-spin" />
              ) : isPlaying ? (
                <PauseIcon width={22} height={22} />
              ) : (
                <PlayIcon width={22} height={22} />
              )}
            </button>
            <button
              type="button"
              onClick={next}
              disabled={!hasTrack}
              aria-label="Nächster Titel"
              className={`action-icon h-10 w-10 disabled:opacity-40 lg:h-9 lg:w-9 ${ICON_IDLE}`}
            >
              <NextIcon width={21} height={21} />
            </button>
            <button
              type="button"
              onClick={cycleRepeat}
              disabled={!hasTrack}
              aria-label="Wiederholen"
              aria-pressed={repeat !== "off"}
              title={repeat === "one" ? "Titel wiederholen" : repeat === "all" ? "Alle wiederholen" : "Wiederholen aus"}
              className={`action-icon hidden h-9 w-9 disabled:opacity-40 lg:grid ${repeat !== "off" ? "bg-accent/10 text-accent" : ICON_IDLE}`}
            >
              <RepeatGlyph width={17} height={17} />
            </button>
          </div>

          <div className="hidden items-center justify-end gap-1 lg:row-span-2 lg:flex">
            <button
              type="button"
              onClick={toggleLyrics}
              aria-label="Songtext"
              aria-pressed={lyricsOpen}
              title="Songtext"
              className={`${ICON_BTN} ${lyricsOpen ? SQUARE_ACTIVE : SQUARE_IDLE}`}
            >
              <LyricsIcon width={18} height={18} />
            </button>
            <button
              type="button"
              onClick={toggleQueue}
              aria-label="Warteschlange"
              aria-pressed={queueOpen}
              title="Warteschlange"
              className={`${ICON_BTN} ${queueOpen ? SQUARE_ACTIVE : SQUARE_IDLE}`}
            >
              <QueueIcon width={18} height={18} />
            </button>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "Ton an" : "Stummschalten"}
              className={`${ICON_BTN} ${ICON_IDLE}`}
            >
              {muted || volume === 0 ? <VolumeMutedIcon width={18} height={18} /> : <VolumeIcon width={18} height={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-16 xl:w-20"
              style={{ background: rangeFill((muted ? 0 : volume) * 100) }}
              aria-label="Lautstärke"
              aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} Prozent`}
            />
            <button
              type="button"
              onClick={openFullscreen}
              disabled={!hasTrack}
              aria-label="Jetzt läuft öffnen"
              title="Jetzt läuft"
              className={`${ICON_BTN} ${ICON_IDLE} disabled:opacity-40`}
            >
              <ExpandIcon width={18} height={18} />
            </button>
          </div>

          <div className={`col-span-2 mt-2 flex w-full items-center gap-2 pb-1 lg:col-span-1 lg:col-start-2 lg:mt-0 lg:pb-0 ${hasTrack ? "" : "hidden lg:flex"}`}>
            <span className="hidden w-9 text-right text-[10px] tabular-nums text-muted lg:block">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => seek(Number(e.target.value))}
              disabled={!hasTrack || !duration}
              className="min-w-0 flex-1"
              style={{ background: rangeFill(duration ? (currentTime / duration) * 100 : 0) }}
              aria-label="Fortschritt"
              aria-valuetext={`${formatTime(currentTime)} von ${formatTime(duration)}`}
            />
            <span className="hidden w-9 text-[10px] tabular-nums text-muted lg:block">{formatTime(duration)}</span>
          </div>
        </div>
        {(error || visiblePreloadError) && (
          <div role="alert" className="error-panel my-2 text-xs" title={error || visiblePreloadError || undefined}>
            {error || visiblePreloadError}
          </div>
        )}
      </footer>
    </>
  );
}
