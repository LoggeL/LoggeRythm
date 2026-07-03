"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePlayerStore, currentTrack } from "@/store/player";
import { api, streamUrl } from "@/lib/api";
import { ensureAnalyser, applyVolume } from "@/lib/audioAnalyser";
import { useMe } from "@/hooks/useAuth";
import { formatTime } from "@/lib/format";
import LikeButton from "@/components/LikeButton";
import NowPlaying from "@/components/now-playing/NowPlaying";
import TrackContext from "@/components/TrackContext";
import CacheMarker from "@/components/CacheMarker";
import ArtistLinks from "@/components/ArtistLinks";
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
  ChevronDownIcon,
  ExpandIcon,
} from "@/components/icons";
import { toast } from "@/store/toast";

// Shared styling for the player's secondary icon buttons.
const ICON_BTN =
  "w-9 h-9 rounded-full grid place-items-center transition-colors";
const ICON_IDLE = "text-muted hover:text-foreground hover:bg-white/10";
// Rounded-square buttons (lyrics / queue) with a subtle elevated surface.
const SQUARE_BTN =
  "w-10 h-10 rounded-lg grid place-items-center transition-colors";
const SQUARE_IDLE = "text-muted bg-white/5 hover:text-foreground hover:bg-white/10";
const SQUARE_ACTIVE = "text-accent bg-accent/20 hover:bg-accent/25";

/** A violet-filled track for range inputs (filled up to `pct` percent). */
function rangeFill(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  return `linear-gradient(to right, var(--accent) 0%, var(--accent) ${p}%, #4d4d57 ${p}%, #4d4d57 100%)`;
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

export default function PlayerBar() {
  // Two interchangeable decks: one is "active" (drives the store + UI), the
  // other prefetches the next track for a gapless crossfade. On handoff we just
  // swap which deck is active — the faded-in deck keeps playing, so there is no
  // reload, no seek and no restart.
  const deckA = useRef<HTMLAudioElement>(null);
  const deckB = useRef<HTMLAudioElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const activeIdxRef = useRef(0);
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);

  const crossfadeTimer = useRef<number | null>(null);
  // The next-track id we've already begun crossfading into (prevents the
  // crossfade effect from re-triggering every frame near the end).
  const crossfadeToId = useRef<string | null>(null);
  // Auto-skip a failed track after a short grace period so a single dead
  // source doesn't stall the whole queue.
  const errorSkipTimer = useRef<number | null>(null);
  const clearErrorSkip = () => {
    if (errorSkipTimer.current) {
      clearTimeout(errorSkipTimer.current);
      errorSkipTimer.current = null;
    }
  };
  const [expanded, setExpanded] = useState(false);

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

  const { data: me } = useMe();
  const recordedRef = useRef<string | null>(null);

  const radioActive = usePlayerStore((s) => s.radioActive);
  const appendToQueue = usePlayerStore((s) => s.appendToQueue);
  const queueLen = usePlayerStore((s) => s.queue.length);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const radioFetching = useRef(false);
  const { data: settings } = useQuery({
    queryKey: ["playback-settings"],
    queryFn: api.settings,
    enabled: !!me?.is_approved,
    staleTime: 5 * 60_000,
  });

  // Record a play once per (new) track for approved, logged-in users.
  useEffect(() => {
    if (!track || !trackId) return;
    if (!me?.is_approved) return;
    if (recordedRef.current === trackId) return;
    recordedRef.current = trackId;
    api.recordPlay(track).catch(() => {
      // ignore record failures
    });
  }, [trackId, track, me?.is_approved]);

  // Reflect the current song in the browser tab title.
  useEffect(() => {
    const base = "LoggeRythm";
    document.title = track ? `${track.title} • ${track.artist}` : base;
    return () => {
      document.title = base;
    };
  }, [trackId, track]);

  // Endless radio: when near the end, pull the next ~5 similar songs
  // seeded by the current track (so the station keeps evolving).
  useEffect(() => {
    if (!radioActive || !track || radioFetching.current) return;
    if (queueLen - index > 2) return; // still have a buffer
    radioFetching.current = true;
    api
      .radio(String(track.id))
      .then((more) => {
        const have = new Set(
          usePlayerStore.getState().queue.map((t) => String(t.id)),
        );
        const fresh = more.filter((t) => !have.has(String(t.id))).slice(0, 5);
        if (fresh.length) appendToQueue(fresh);
      })
      .catch(() => {})
      .finally(() => {
        radioFetching.current = false;
      });
  }, [radioActive, index, queueLen, track, appendToQueue]);

  // Load the current track into the active deck — unless that deck is already
  // playing it, which is the case right after a crossfade handoff.
  useEffect(() => {
    const el = (activeIdx === 0 ? deckA : deckB).current;
    if (!el) return;
    const id = trackId ? String(trackId) : "";
    if (el.dataset.trackId !== id) {
      if (id) {
        ensureAnalyser(el);
        el.src = streamUrl(id);
        el.dataset.trackId = id;
        el.currentTime = 0;
        const s = usePlayerStore.getState();
        applyVolume(el, s.muted ? 0 : s.volume);
      } else {
        el.pause();
        el.removeAttribute("src");
        el.dataset.trackId = "";
        el.load();
      }
    }
    // Idle the other deck (it may hold a half-faded previous/next track).
    const idle = (activeIdx === 0 ? deckB : deckA).current;
    if (idle && !crossfadeTimer.current) {
      idle.pause();
      idle.dataset.trackId = "";
    }
    // A normal (non-crossfade) track change cancels any pending crossfade.
    crossfadeToId.current = null;
  }, [activeIdx, trackId]);

  // Reflect play/pause on the active deck.
  useEffect(() => {
    const el = (activeIdx === 0 ? deckA : deckB).current;
    if (!el) return;
    if (isPlaying) {
      // Lazily wire the analyser on play (a user gesture, so the AudioContext
      // may start) — powers the visualizers.
      ensureAnalyser(el);
      el.play().catch(() => {});
    } else {
      el.pause();
      // Pausing aborts any in-flight crossfade so both decks stop together.
      if (crossfadeTimer.current) {
        window.clearInterval(crossfadeTimer.current);
        crossfadeTimer.current = null;
        const idle = (activeIdx === 0 ? deckB : deckA).current;
        if (idle) idle.pause();
        crossfadeToId.current = null;
        const s = usePlayerStore.getState();
        applyVolume(el, s.muted ? 0 : s.volume);
      }
    }
  }, [isPlaying, trackId, activeIdx]);

  // Sync volume + mute onto the active deck (the crossfade owns volumes while
  // it runs).
  useEffect(() => {
    const el = (activeIdx === 0 ? deckA : deckB).current;
    if (el && !crossfadeTimer.current) applyVolume(el, muted ? 0 : volume);
  }, [volume, muted, activeIdx]);

  // Crossfade: near the end of the active deck, fade the next track in on the
  // idle deck, then swap which deck is active — no reload, no seek, no restart.
  useEffect(() => {
    const seconds = settings?.crossfade_enabled
      ? settings.crossfade_duration_sec
      : 0;
    if (!seconds || seconds <= 0) return;
    if (!track || !isPlaying || repeat === "one") return;
    // "Sleep at end of track": let the track finish instead of fading onward.
    if (usePlayerStore.getState().sleepAfterTrack) return;
    if (!duration || duration <= seconds + 1) return;
    if (currentTime < duration - seconds) return;
    if (index < 0 || index >= queue.length - 1) return;
    if (crossfadeTimer.current) return;

    const outgoing = (activeIdx === 0 ? deckA : deckB).current;
    const incoming = (activeIdx === 0 ? deckB : deckA).current;
    const nextTrack = queue[index + 1];
    if (!outgoing || !incoming || !nextTrack) return;
    if (crossfadeToId.current === String(nextTrack.id)) return;

    const incomingIdx = activeIdx ^ 1;
    crossfadeToId.current = String(nextTrack.id);
    ensureAnalyser(incoming);
    incoming.src = streamUrl(String(nextTrack.id));
    incoming.dataset.trackId = String(nextTrack.id);
    incoming.currentTime = 0;
    applyVolume(incoming, 0);

    const startedAt = performance.now();
    incoming
      .play()
      .then(() => {
        crossfadeTimer.current = window.setInterval(() => {
          const elapsed = (performance.now() - startedAt) / 1000;
          const pct = Math.min(1, elapsed / seconds);
          const targetVolume = muted ? 0 : volume;
          applyVolume(outgoing, targetVolume * (1 - pct));
          applyVolume(incoming, targetVolume * pct);

          if (pct >= 1) {
            if (crossfadeTimer.current) {
              window.clearInterval(crossfadeTimer.current);
              crossfadeTimer.current = null;
            }
            applyVolume(incoming, targetVolume);
            // The incoming deck simply keeps playing — promote it to active and
            // advance the queue index without touching currentTime.
            outgoing.pause();
            activeIdxRef.current = incomingIdx;
            setActiveIdx(incomingIdx);
            _crossfadeAdvance();
            // Refresh the store's position + duration from the deck that just
            // took over. Otherwise they keep the *outgoing* track's end values,
            // and if the incoming track is shorter the crossfade check fires
            // again immediately — skipping the song we just faded into.
            _setCurrentTime(incoming.currentTime);
            if (Number.isFinite(incoming.duration)) {
              _setDuration(incoming.duration);
            }
          }
        }, 50);
      })
      .catch(() => {
        crossfadeToId.current = null;
        incoming.removeAttribute("src");
        incoming.dataset.trackId = "";
      });
  }, [
    currentTime,
    duration,
    index,
    isPlaying,
    muted,
    queue,
    repeat,
    settings?.crossfade_duration_sec,
    settings?.crossfade_enabled,
    track,
    volume,
    activeIdx,
    _crossfadeAdvance,
    _setCurrentTime,
    _setDuration,
  ]);

  // Consume seek requests from the store on the active deck. Defer until
  // metadata is ready when the deck is still loading.
  useEffect(() => {
    if (seekTo == null) return;
    const el = (activeIdx === 0 ? deckA : deckB).current;
    if (el) {
      const target = seekTo;
      const apply = () => {
        try {
          el.currentTime = target;
        } catch {
          // ignore invalid seek
        }
      };
      if (el.readyState >= 1) {
        apply();
      } else {
        const onReady = () => {
          el.removeEventListener("loadedmetadata", onReady);
          apply();
        };
        el.addEventListener("loadedmetadata", onReady);
      }
    }
    _clearSeek();
  }, [seekTo, _clearSeek, activeIdx]);

  // MediaSession: OS media keys + metadata + artwork.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.cover
        ? [
            { src: track.cover, sizes: "250x250", type: "image/jpeg" },
            { src: track.cover, sizes: "500x500", type: "image/jpeg" },
          ]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", () => toggle());
    navigator.mediaSession.setActionHandler("pause", () => toggle());
    navigator.mediaSession.setActionHandler("previoustrack", () => prev());
    navigator.mediaSession.setActionHandler("nexttrack", () => next());
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (d.seekTime != null) seek(d.seekTime);
    });
    navigator.mediaSession.setActionHandler("seekforward", (d) => {
      const s = usePlayerStore.getState();
      s.seek(Math.min(s.currentTime + (d.seekOffset ?? 10), s.duration || 0));
    });
    navigator.mediaSession.setActionHandler("seekbackward", (d) => {
      const s = usePlayerStore.getState();
      s.seek(Math.max(s.currentTime - (d.seekOffset ?? 10), 0));
    });
    try {
      navigator.mediaSession.setActionHandler("stop", () => {
        usePlayerStore.getState().pause();
      });
    } catch {
      // "stop" is not supported everywhere
    }
  }, [track, toggle, prev, next, seek]);

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
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
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
    return clearErrorSkip;
  }, [trackId]);

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

  // Media-element event props for a deck — only the ACTIVE deck drives the
  // store (the other is mid-crossfade prefetch and must stay silent to the UI).
  const deckProps = (idx: 0 | 1) => ({
    onTimeUpdate: (e: SyntheticEvent<HTMLAudioElement>) => {
      if (activeIdxRef.current === idx) _setCurrentTime(e.currentTarget.currentTime);
    },
    onLoadedMetadata: (e: SyntheticEvent<HTMLAudioElement>) => {
      if (activeIdxRef.current !== idx) return;
      const d = e.currentTarget.duration;
      if (Number.isFinite(d)) _setDuration(d);
    },
    onEnded: (e: SyntheticEvent<HTMLAudioElement>) => {
      if (activeIdxRef.current !== idx) return;
      // A crossfade already owns the transition into the next track.
      if (crossfadeTimer.current) return;
      if (repeat === "one") {
        e.currentTarget.currentTime = 0;
        _setCurrentTime(0);
        e.currentTarget.play().catch(() => _onEnded());
        return;
      }
      _onEnded();
    },
    onWaiting: () => {
      if (activeIdxRef.current === idx) _setBuffering(true);
    },
    onStalled: () => {
      if (activeIdxRef.current === idx) _setBuffering(true);
    },
    onPlaying: () => {
      if (activeIdxRef.current !== idx) return;
      clearErrorSkip(); // recovered — cancel any pending auto-skip
      _setBuffering(false);
      _setError(null);
    },
    onCanPlay: () => {
      if (activeIdxRef.current === idx) _setBuffering(false);
    },
    onError: (e: SyntheticEvent<HTMLAudioElement>) => {
      if (activeIdxRef.current !== idx) return;
      const el = e.currentTarget;
      const mediaErr = el.error;
      const id = el.dataset.trackId || "";
      _setError("Titel konnte nicht geladen werden.");
      // Auto-skip after 5s so one dead source doesn't block the queue. Only
      // fire if we're still stuck on this same failed track.
      clearErrorSkip();
      errorSkipTimer.current = window.setTimeout(() => {
        errorSkipTimer.current = null;
        const cur = currentTrack(usePlayerStore.getState());
        if (activeIdxRef.current === idx && cur?.id === id) {
          toast.info("Titel übersprungen.");
          next();
        }
      }, 5000);
      // Probe the backend for the real reason so the UI shows *why* it failed
      // (HTTP status + detail / decode error) instead of a bare message.
      describeStreamFailure(id ? streamUrl(id) : el.currentSrc, mediaErr).then(
        (detail) => {
          if (activeIdxRef.current === idx) {
            const msg = `Titel konnte nicht geladen werden — ${detail}`;
            _setError(msg);
            // Also toast: the inline player-bar text is easy to miss in
            // fullscreen or on mobile.
            toast.error(msg);
          }
        },
      );
    },
    preload: "auto" as const,
  });

  return (
    <>
      {expanded && track && <NowPlaying onClose={closeFullscreen} />}
      <footer
        className={`relative flex-shrink-0 backdrop-blur-xl px-3 sm:px-4 py-2 sm:py-0 pb-2 sm:pb-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${
          hasTrack
            ? "mx-3 mb-2 rounded-2xl border border-white/10 bg-background-elevated/95 shadow-2xl shadow-black/25 min-h-24 sm:mx-0 sm:mb-0 sm:rounded-none sm:border-x-0 sm:border-b-0 sm:min-h-0 sm:h-20"
            : "bg-background-elevated/95 border-t border-white/10 min-h-16 sm:h-20"
        }`}
      >
        {/* Two interchangeable decks — see the playback engine above. */}
        <audio ref={deckA} aria-hidden="true" {...deckProps(0)} />
        <audio ref={deckB} aria-hidden="true" {...deckProps(1)} />

        {/* Track info */}
        <div
          className={`flex items-center gap-3 w-full sm:w-1/4 min-w-0 sm:pr-0 ${
            hasTrack ? "pr-20" : "pr-0 justify-center sm:justify-start"
          }`}
        >
          {track ? (
            <TrackContext track={track} className="contents">
              <button
                type="button"
                onClick={openFullscreen}
                aria-label="Vollbild öffnen"
                className="flex-shrink-0"
              >
                {track.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={track.cover}
                    alt=""
                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-cover shadow-md ring-1 ring-white/10 hover:opacity-80 transition"
                  />
                ) : (
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl gradient-violet opacity-80" />
                )}
              </button>
              <div className="min-w-0">
                {track.album_id ? (
                  <Link
                    href={`/album/${track.album_id}`}
                    className="block truncate font-semibold text-[15px] uppercase tracking-wide hover:underline"
                  >
                    {track.title}
                  </Link>
                ) : (
                  <div className="truncate font-semibold text-[15px] uppercase tracking-wide">
                    {track.title}
                  </div>
                )}
                {error ? (
                  <div
                    className="line-clamp-2 text-xs text-red-400"
                    title={error}
                  >
                    {error}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <CacheMarker trackId={track.id} />
                    <ArtistLinks
                      track={track}
                      className="truncate text-xs text-muted"
                      linkClassName="hover:underline hover:text-foreground"
                    />
                  </div>
                )}
              </div>
              <div className="hidden sm:block">
                <LikeButton track={track} />
              </div>
            </TrackContext>
          ) : (
            <div className="text-sm text-muted">Nichts wird abgespielt</div>
          )}
        </div>

        {/* Controls + seek */}
        <div
          className={`w-full sm:flex-1 flex flex-col items-center gap-1 sm:max-w-2xl sm:mx-auto ${
            hasTrack ? "" : "hidden sm:flex"
          }`}
        >
          <div className="flex items-center justify-center gap-6">
            <button
              type="button"
              onClick={toggleShuffle}
              disabled={!hasTrack}
              aria-label="Zufallswiedergabe"
              aria-pressed={shuffle}
              title="Zufallswiedergabe"
              className={`inline-flex disabled:opacity-40 transition ${
                shuffle ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              <ShuffleIcon width={18} height={18} />
            </button>
            <button
              type="button"
              onClick={prev}
              disabled={!hasTrack}
              aria-label="Vorheriger Titel"
              className="text-muted hover:text-foreground disabled:opacity-40"
            >
              <PrevIcon width={22} height={22} />
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={!hasTrack}
              aria-label={isPlaying ? "Pause" : "Abspielen"}
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-accent text-white flex items-center justify-center shadow-[0_0_22px_rgba(124,92,255,0.6)] hover:scale-105 transition disabled:opacity-40"
            >
              {isBuffering ? (
                <SpinnerIcon width={22} height={22} className="animate-spin" />
              ) : isPlaying ? (
                <PauseIcon width={24} height={24} />
              ) : (
                <PlayIcon width={24} height={24} />
              )}
            </button>
            <button
              type="button"
              onClick={next}
              disabled={!hasTrack}
              aria-label="Nächster Titel"
              className="text-muted hover:text-foreground disabled:opacity-40"
            >
              <NextIcon width={22} height={22} />
            </button>
            <button
              type="button"
              onClick={cycleRepeat}
              disabled={!hasTrack}
              aria-label="Wiederholen"
              aria-pressed={repeat !== "off"}
              title={
                repeat === "one"
                  ? "Titel wiederholen"
                  : repeat === "all"
                    ? "Alle wiederholen"
                    : "Wiederholen aus"
              }
              className={`inline-flex disabled:opacity-40 transition ${
                repeat !== "off" ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              <RepeatGlyph width={18} height={18} />
            </button>
          </div>

          <div className="flex items-center gap-2 w-full">
            <span className="hidden min-[380px]:block text-xs text-muted w-10 text-right tabular-nums">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => seek(Number(e.target.value))}
              disabled={!hasTrack || !duration}
              className="flex-1"
              style={{
                background: rangeFill(
                  duration ? (currentTime / duration) * 100 : 0,
                ),
              }}
              aria-label="Fortschritt"
            />
            <span className="hidden min-[380px]:block text-xs text-muted w-10 tabular-nums">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Secondary controls — unified round icon buttons */}
        <div className="hidden sm:flex items-center gap-1 w-1/4 justify-end">
          <button
            type="button"
            onClick={toggleLyrics}
            aria-label="Songtext"
            aria-pressed={lyricsOpen}
            title="Songtext"
            className={`${SQUARE_BTN} ${lyricsOpen ? SQUARE_ACTIVE : SQUARE_IDLE}`}
          >
            <LyricsIcon width={18} height={18} />
          </button>
          <button
            type="button"
            onClick={toggleQueue}
            aria-label="Warteschlange"
            aria-pressed={queueOpen}
            title="Warteschlange"
            className={`${SQUARE_BTN} ${queueOpen ? SQUARE_ACTIVE : SQUARE_IDLE}`}
          >
            <QueueIcon width={18} height={18} />
          </button>
          <div className="flex items-center gap-1.5 ml-2">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "Ton an" : "Stummschalten"}
              className={`${ICON_BTN} ${ICON_IDLE}`}
            >
              {muted || volume === 0 ? (
                <VolumeMutedIcon width={18} height={18} />
              ) : (
                <VolumeIcon width={18} height={18} />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-24"
              style={{ background: rangeFill((muted ? 0 : volume) * 100) }}
              aria-label="Lautstärke"
            />
          </div>
          <button
            type="button"
            onClick={openFullscreen}
            disabled={!hasTrack}
            aria-label="Vollbild öffnen"
            title="Vollbild"
            className={`${ICON_BTN} ${ICON_IDLE} disabled:opacity-40`}
          >
            <ExpandIcon width={18} height={18} />
          </button>
        </div>

        {/* Mobile expand chevron */}
        {track && (
          <div className="absolute right-3 top-3 flex items-center gap-1 sm:hidden">
            <button
              type="button"
              onClick={toggleQueue}
              aria-label="Warteschlange"
              aria-pressed={queueOpen}
              className={`p-2 rounded-full hover:bg-panel-hover transition ${
                queueOpen ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              <QueueIcon />
            </button>
            <button
              type="button"
              onClick={openFullscreen}
              aria-label="Vollbild öffnen"
              className="text-muted hover:text-foreground p-2 rounded-full hover:bg-panel-hover"
            >
              <ChevronDownIcon className="rotate-180" />
            </button>
          </div>
        )}
      </footer>
    </>
  );
}
