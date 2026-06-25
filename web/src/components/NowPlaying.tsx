"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePlayerStore, currentTrack } from "@/store/player";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import LikeButton from "@/components/LikeButton";
import {
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOneIcon,
  VolumeIcon,
  VolumeMutedIcon,
  ChevronDownIcon,
} from "@/components/icons";

export default function NowPlaying({ onClose }: { onClose: () => void }) {
  const track = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);

  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);

  if (!track) return null;
  const RepeatGlyph = repeat === "one" ? RepeatOneIcon : RepeatIcon;

  return (
    <div className="animate-in fixed inset-0 z-[80] flex flex-col bg-background p-6">
      <div className="flex justify-between items-center mb-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="text-muted hover:text-foreground p-2"
        >
          <ChevronDownIcon width={24} height={24} />
        </button>
        <span className="text-sm font-semibold text-muted">Wird gespielt</span>
        <span className="w-10" />
      </div>

      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-2 lg:gap-10 flex flex-col">
        {/* Left: cover, title, transport */}
        <div className="flex flex-col min-h-0 lg:overflow-y-auto">
          <div className="flex-1 flex flex-col items-center justify-center gap-8 min-h-0">
            {track.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={track.cover}
                alt={track.album}
                className="w-full max-w-sm aspect-square rounded-lg object-cover shadow-2xl"
              />
            ) : (
              <div className="w-full max-w-sm aspect-square rounded-lg bg-panel-hover" />
            )}

            <div className="w-full max-w-md text-center">
              <div className="flex items-center justify-center gap-3">
                <h2 className="text-3xl font-extrabold truncate">{track.title}</h2>
                <LikeButton track={track} />
              </div>
              <p className="text-muted mt-1">
                {track.artist_id ? (
                  <Link
                    href={`/artist/${track.artist_id}`}
                    onClick={onClose}
                    className="hover:underline hover:text-foreground"
                  >
                    {track.artist}
                  </Link>
                ) : (
                  track.artist
                )}
              </p>
            </div>
          </div>

          <div className="w-full max-w-md mx-auto mt-8">
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
            disabled={!duration}
            className="flex-1"
            aria-label="Fortschritt"
          />
          <span className="text-xs text-muted w-10 tabular-nums">
            {formatTime(duration)}
          </span>
        </div>

        <div className="flex items-center justify-center gap-6 mt-4">
          <button
            type="button"
            onClick={toggleShuffle}
            aria-label="Zufallswiedergabe"
            className={shuffle ? "text-accent" : "text-muted hover:text-foreground"}
          >
            <ShuffleIcon width={22} height={22} />
          </button>
          <button
            type="button"
            onClick={prev}
            aria-label="Vorheriger Titel"
            className="text-muted hover:text-foreground"
          >
            <PrevIcon width={30} height={30} />
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={isPlaying ? "Pause" : "Abspielen"}
            className="w-16 h-16 rounded-full bg-foreground text-background flex items-center justify-center hover:scale-105 transition"
          >
            {isPlaying ? (
              <PauseIcon width={30} height={30} />
            ) : (
              <PlayIcon width={30} height={30} />
            )}
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Nächster Titel"
            className="text-muted hover:text-foreground"
          >
            <NextIcon width={30} height={30} />
          </button>
          <button
            type="button"
            onClick={cycleRepeat}
            aria-label="Wiederholen"
            className={repeat !== "off" ? "text-accent" : "text-muted hover:text-foreground"}
          >
            <RepeatGlyph width={22} height={22} />
          </button>
        </div>

        <div className="flex items-center gap-2 mt-6 justify-center">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Ton an" : "Stummschalten"}
            className="text-muted hover:text-foreground"
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
            className="w-40"
            aria-label="Lautstärke"
          />
          </div>
        </div>
        </div>

        {/* Right: roomy synced lyrics */}
        <LyricsPanel
          artist={track.artist}
          title={track.title}
          trackId={track.id}
          currentTime={currentTime}
          onSeek={seek}
        />
      </div>
    </div>
  );
}

function LyricsPanel({
  artist,
  title,
  trackId,
  currentTime,
  onSeek,
}: {
  artist: string;
  title: string;
  trackId: number | string;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["lyrics", trackId],
    queryFn: () => api.lyrics(artist, title, String(trackId)),
    enabled: !!trackId,
    staleTime: 3600_000,
    retry: false,
  });

  const lines = data?.synced ? (data.lines ?? []) : [];

  // Active line = last line whose timestamp has passed.
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= currentTime + 0.15) active = i;
    else break;
  }

  useEffect(() => {
    const el = activeRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;
    const top =
      el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top, behavior: "smooth" });
  }, [active]);

  return (
    <div className="min-h-0 mt-8 lg:mt-0 flex flex-col">
      <span className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted mb-4">
        Songtext
      </span>
      {lines.length > 0 ? (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto py-[40vh] lg:py-[35vh] pr-2"
        >
          {lines.map((line, i) => {
            const isActive = i === active;
            return (
              <button
                key={i}
                type="button"
                ref={isActive ? activeRef : undefined}
                onClick={() => onSeek(line.t)}
                className={`block w-full text-left py-2 text-2xl sm:text-3xl font-bold leading-snug transition-all duration-300 ${
                  isActive
                    ? "text-foreground opacity-100"
                    : "text-muted opacity-50 hover:opacity-80"
                }`}
              >
                {line.text || "♪"}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <p className="text-muted">
            {isLoading ? "Lädt…" : "Kein Songtext"}
          </p>
        </div>
      )}
    </div>
  );
}
