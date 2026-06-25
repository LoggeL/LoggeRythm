"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePlayerStore, currentTrack } from "@/store/player";
import { streamUrl } from "@/lib/api";
import { formatTime } from "@/lib/format";
import LikeButton from "@/components/LikeButton";
import NowPlaying from "@/components/NowPlaying";
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
} from "@/components/icons";

export default function PlayerBar() {
  const audioRef = useRef<HTMLAudioElement>(null);
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
  const _clearSeek = usePlayerStore((s) => s._clearSeek);
  const _setBuffering = usePlayerStore((s) => s._setBuffering);
  const _setError = usePlayerStore((s) => s._setError);

  const trackId = track?.id ?? null;

  // Reflect play/pause state.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.play().catch(() => {
        // autoplay may be blocked; ignore
      });
    } else {
      el.pause();
    }
  }, [isPlaying, trackId]);

  // Sync volume + mute.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  // Consume seek requests from the store.
  useEffect(() => {
    if (seekTo == null) return;
    const el = audioRef.current;
    if (el) {
      try {
        el.currentTime = seekTo;
      } catch {
        // ignore invalid seek
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

  return (
    <>
      {expanded && track && <NowPlaying onClose={() => setExpanded(false)} />}
      <footer className="relative h-20 flex-shrink-0 bg-panel border-t border-white/10 px-4 flex items-center gap-4">
        <audio
          ref={audioRef}
          src={trackId ? streamUrl(trackId) : undefined}
          onTimeUpdate={(e) => _setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) _setDuration(d);
          }}
          onEnded={_onEnded}
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

        {/* Track info */}
        <div className="flex items-center gap-3 w-1/4 min-w-0">
          {track ? (
            <>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                aria-label="Vollbild öffnen"
                className="flex-shrink-0"
              >
                {track.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={track.cover}
                    alt=""
                    className="w-14 h-14 rounded object-cover hover:opacity-80 transition"
                  />
                ) : (
                  <div className="w-14 h-14 rounded bg-panel-hover" />
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
            </>
          ) : (
            <div className="text-sm text-muted">Nichts wird abgespielt</div>
          )}
        </div>

        {/* Controls + seek */}
        <div className="flex-1 flex flex-col items-center gap-1 max-w-2xl mx-auto">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={toggleShuffle}
              disabled={!hasTrack}
              aria-label="Zufallswiedergabe"
              aria-pressed={shuffle}
              title="Zufallswiedergabe"
              className={`disabled:opacity-40 transition ${
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
              className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:scale-105 transition disabled:opacity-40"
            >
              {isBuffering ? (
                <SpinnerIcon width={20} height={20} className="animate-spin" />
              ) : isPlaying ? (
                <PauseIcon width={20} height={20} />
              ) : (
                <PlayIcon width={20} height={20} />
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
              className={`disabled:opacity-40 transition ${
                repeat !== "off" ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              <RepeatGlyph width={18} height={18} />
            </button>
          </div>

          <div className="flex items-center gap-2 w-full">
            <span className="text-xs text-muted w-10 text-right tabular-nums">
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
            <span className="text-xs text-muted w-10 tabular-nums">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Lyrics + Queue + Volume */}
        <div className="hidden sm:flex items-center gap-2 w-1/4 justify-end">
          <button
            type="button"
            onClick={toggleLyrics}
            aria-label="Songtext"
            aria-pressed={lyricsOpen}
            title="Songtext"
            className={`p-1 rounded-full hover:bg-panel-hover transition ${
              lyricsOpen ? "text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            <LyricsIcon />
          </button>
          <button
            type="button"
            onClick={toggleQueue}
            aria-label="Warteschlange"
            aria-pressed={queueOpen}
            title="Warteschlange"
            className={`p-1 rounded-full hover:bg-panel-hover transition ${
              queueOpen ? "text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            <QueueIcon />
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Ton an" : "Stummschalten"}
            className="text-muted hover:text-foreground p-1"
          >
            {muted || volume === 0 ? <VolumeMutedIcon /> : <VolumeIcon />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-28"
            aria-label="Lautstärke"
          />
        </div>

        {/* Mobile expand chevron */}
        {track && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Vollbild öffnen"
            className="sm:hidden text-muted hover:text-foreground p-1"
          >
            <ChevronDownIcon className="rotate-180" />
          </button>
        )}
      </footer>
    </>
  );
}
