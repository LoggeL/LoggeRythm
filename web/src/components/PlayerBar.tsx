"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePlayerStore, currentTrack } from "@/store/player";
import { api, streamUrl } from "@/lib/api";
import { ensureAnalyser } from "@/lib/audioAnalyser";
import { useMe } from "@/hooks/useAuth";
import { formatTime } from "@/lib/format";
import LikeButton from "@/components/LikeButton";
import NowPlaying from "@/components/NowPlaying";
import TrackContext from "@/components/TrackContext";
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

// Shared styling for the player's secondary round icon buttons.
const ICON_BTN =
  "w-9 h-9 rounded-full grid place-items-center transition-colors";
const ICON_IDLE = "text-muted hover:text-foreground hover:bg-white/10";
const ICON_ACTIVE = "text-accent bg-accent/15 hover:bg-accent/20";

export default function PlayerBar() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const crossfadeRef = useRef<HTMLAudioElement>(null);
  const crossfadeTimer = useRef<number | null>(null);
  const crossfadeTrackId = useRef<string | null>(null);
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
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const _setCurrentTime = usePlayerStore((s) => s._setCurrentTime);
  const _setDuration = usePlayerStore((s) => s._setDuration);
  const _onEnded = usePlayerStore((s) => s._onEnded);
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
    const base = "SpotiFrei";
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

  // Reflect play/pause state.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      // Lazily wire the Web Audio analyser on play (a user gesture, so the
      // AudioContext is allowed to start) — powers the fullscreen visualizer.
      ensureAnalyser(el);
      el.play().catch(() => {
        // autoplay may be blocked; ignore
      });
    } else {
      el.pause();
    }
  }, [isPlaying, trackId]);

  useEffect(() => {
    if (!isPlaying && crossfadeRef.current) {
      crossfadeRef.current.pause();
    }
  }, [isPlaying]);

  // Sync volume + mute.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
    if (crossfadeRef.current && !crossfadeTimer.current) {
      crossfadeRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  useEffect(() => {
    crossfadeTrackId.current = null;
    if (crossfadeTimer.current) {
      window.clearInterval(crossfadeTimer.current);
      crossfadeTimer.current = null;
    }
    if (crossfadeRef.current) {
      crossfadeRef.current.pause();
      crossfadeRef.current.removeAttribute("src");
      crossfadeRef.current.load();
    }
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [trackId, muted, volume]);

  useEffect(() => {
    const seconds = settings?.crossfade_enabled
      ? settings.crossfade_duration_sec
      : 0;
    if (!seconds || seconds <= 0) return;
    if (!track || !isPlaying || repeat === "one") return;
    if (!duration || duration <= seconds + 1) return;
    if (currentTime < duration - seconds) return;
    if (index < 0 || index >= queue.length - 1) return;

    const outgoing = audioRef.current;
    const incoming = crossfadeRef.current;
    const nextTrack = queue[index + 1];
    if (!outgoing || !incoming || !nextTrack) return;
    if (crossfadeTrackId.current === String(nextTrack.id)) return;

    crossfadeTrackId.current = String(nextTrack.id);
    incoming.src = streamUrl(String(nextTrack.id));
    incoming.currentTime = 0;
    incoming.volume = 0;

    const startedAt = performance.now();
    incoming
      .play()
      .then(() => {
        crossfadeTimer.current = window.setInterval(() => {
          const elapsed = (performance.now() - startedAt) / 1000;
          const pct = Math.min(1, elapsed / seconds);
          const targetVolume = muted ? 0 : volume;
          outgoing.volume = targetVolume * (1 - pct);
          incoming.volume = targetVolume * pct;

          if (pct >= 1) {
            if (crossfadeTimer.current) {
              window.clearInterval(crossfadeTimer.current);
              crossfadeTimer.current = null;
            }
            incoming.pause();
            jumpTo(index + 1);
            setTimeout(() => {
              seek(Math.min(seconds, nextTrack.duration_sec || seconds));
              if (audioRef.current) audioRef.current.volume = targetVolume;
            }, 0);
          }
        }, 50);
      })
      .catch(() => {
        crossfadeTrackId.current = null;
        incoming.removeAttribute("src");
      });
  }, [
    currentTime,
    duration,
    index,
    isPlaying,
    jumpTo,
    muted,
    queue,
    repeat,
    seek,
    settings?.crossfade_duration_sec,
    settings?.crossfade_enabled,
    track,
    volume,
  ]);

  // Consume seek requests from the store. If the media isn't ready yet (e.g. a
  // crossfade just switched to a freshly-loaded track), defer the seek until
  // metadata is available — otherwise the new track audibly restarts from 0.
  useEffect(() => {
    if (seekTo == null) return;
    const el = audioRef.current;
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
  }, [seekTo, _clearSeek]);

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
  }, [track, toggle, prev, next, seek]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      // unsupported
    }
  }, [isPlaying]);

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
          s.seek(Math.min(s.currentTime + 5, s.duration || s.currentTime + 5));
          break;
        case "ArrowLeft":
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
        <audio
          ref={audioRef}
          src={trackId ? streamUrl(trackId) : undefined}
          onTimeUpdate={(e) => _setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) _setDuration(d);
          }}
          onEnded={(e) => {
            if (repeat === "one") {
              e.currentTarget.currentTime = 0;
              _setCurrentTime(0);
              e.currentTarget.play().catch(() => _onEnded());
              return;
            }
            _onEnded();
          }}
          onWaiting={() => _setBuffering(true)}
          onStalled={() => _setBuffering(true)}
          onPlaying={() => {
            _setBuffering(false);
            _setError(null);
          }}
          onCanPlay={() => _setBuffering(false)}
          onError={() => _setError("Titel konnte nicht geladen werden.")}
          preload="metadata"
        />
        <audio ref={crossfadeRef} preload="auto" aria-hidden="true" />

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
                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-cover shadow-md hover:opacity-80 transition"
                  />
                ) : (
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl gradient-violet opacity-80" />
                )}
              </button>
              <div className="min-w-0">
                {track.album_id ? (
                  <Link
                    href={`/album/${track.album_id}`}
                    className="block truncate font-medium text-sm hover:underline"
                  >
                    {track.title}
                  </Link>
                ) : (
                  <div className="truncate font-medium text-sm">{track.title}</div>
                )}
                {error ? (
                  <div className="truncate text-xs text-muted">
                    <span className="text-red-400">{error}</span>
                  </div>
                ) : track.artist_id ? (
                  <Link
                    href={`/artist/${track.artist_id}`}
                    className="block truncate text-xs text-muted hover:underline hover:text-foreground"
                  >
                    {track.artist}
                  </Link>
                ) : (
                  <div className="truncate text-xs text-muted">{track.artist}</div>
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
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={toggleShuffle}
              disabled={!hasTrack}
              aria-label="Zufallswiedergabe"
              aria-pressed={shuffle}
              title="Zufallswiedergabe"
              className={`hidden sm:inline-flex disabled:opacity-40 transition ${
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
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-105 transition disabled:opacity-40"
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
              className={`hidden sm:inline-flex disabled:opacity-40 transition ${
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
            className={`${ICON_BTN} ${lyricsOpen ? ICON_ACTIVE : ICON_IDLE}`}
          >
            <LyricsIcon width={18} height={18} />
          </button>
          <button
            type="button"
            onClick={toggleQueue}
            aria-label="Warteschlange"
            aria-pressed={queueOpen}
            title="Warteschlange"
            className={`${ICON_BTN} ${queueOpen ? ICON_ACTIVE : ICON_IDLE}`}
          >
            <QueueIcon width={18} height={18} />
          </button>
          <div className="flex items-center gap-1.5 ml-1">
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
              className="w-20"
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
