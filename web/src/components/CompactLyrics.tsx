"use client";

import { useEffect, useRef } from "react";
import type { Track } from "@/types";
import { useLyrics } from "@/hooks/useLyrics";
import { formatTime } from "@/lib/format";
import { PlayIcon, PauseIcon, NextIcon, PrevIcon } from "@/components/icons";

interface CompactLyricsProps {
  track: Track;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (t: number) => void;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
}

/**
 * Compact lyrics view for the mobile fullscreen player: a small track header,
 * a dense scrolling lyric list (auto-centered on the active line), and a slim
 * transport bar so playback stays controllable while reading. Hidden on lg,
 * where the roomier {@link LyricsPanel} grid column is used instead.
 */
export default function CompactLyrics({
  track,
  currentTime,
  duration,
  isPlaying,
  onSeek,
  onToggle,
  onNext,
  onPrev,
}: CompactLyricsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const { lines, active, hasTimedLines, isLoading, isAiGenerated } = useLyrics(
    track.artist,
    track.title,
    track.id,
    currentTime,
  );

  useEffect(() => {
    const el = activeRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;
    const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top, behavior: "smooth" });
  }, [active]);

  return (
    <div className="flex flex-1 min-h-0 flex-col lg:hidden">
      {/* Compact track header */}
      <div className="flex flex-shrink-0 items-center gap-3 pb-3">
        {track.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.cover}
            alt=""
            className="h-12 w-12 flex-shrink-0 rounded-lg object-cover shadow"
          />
        ) : (
          <div className="h-12 w-12 flex-shrink-0 rounded-lg gradient-violet opacity-80" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{track.title}</div>
          <div className="truncate text-xs text-muted">{track.artist}</div>
        </div>
        {isAiGenerated && (
          <span className="flex-shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
            ✦ AI
          </span>
        )}
      </div>

      {/* Lyrics */}
      {lines.length > 0 ? (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto no-scrollbar py-[34vh] pr-1"
        >
          {lines.map((line, i) => {
            const isActive = i === active;
            return (
              <button
                key={i}
                type="button"
                ref={isActive ? activeRef : undefined}
                onClick={() => hasTimedLines && onSeek(line.t)}
                disabled={!hasTimedLines}
                className={`block w-full text-left py-1.5 text-lg font-bold leading-snug transition-all duration-300 ${
                  isActive
                    ? "text-foreground opacity-100"
                    : "text-muted opacity-50"
                }`}
              >
                {line.text || "♪"}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-muted">{isLoading ? "Lädt…" : "Kein Songtext"}</p>
        </div>
      )}

      {/* Slim transport */}
      <div className="flex-shrink-0 pt-3">
        <div className="flex items-center gap-2">
          <span className="w-9 text-right text-[11px] tabular-nums text-muted">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => onSeek(Number(e.target.value))}
            disabled={!duration}
            className="flex-1"
            aria-label="Fortschritt"
          />
          <span className="w-9 text-[11px] tabular-nums text-muted">
            {formatTime(duration)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-center gap-8">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Vorheriger Titel"
            className="text-muted hover:text-foreground"
          >
            <PrevIcon width={26} height={26} />
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-label={isPlaying ? "Pause" : "Abspielen"}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105"
          >
            {isPlaying ? (
              <PauseIcon width={24} height={24} />
            ) : (
              <PlayIcon width={24} height={24} />
            )}
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Nächster Titel"
            className="text-muted hover:text-foreground"
          >
            <NextIcon width={26} height={26} />
          </button>
        </div>
      </div>
    </div>
  );
}
