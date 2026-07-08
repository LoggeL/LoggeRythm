"use client";

import { useEffect, useRef } from "react";
import type { Track } from "@/types";
import { usePlayerStore } from "@/store/player";
import { useLyrics } from "@/hooks/useLyrics";
import { useBassGlow } from "@/hooks/useBassGlow";
import type { CoverPalette } from "@/hooks/useCoverColors";
import { formatTime } from "@/lib/format";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import {
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  MusicNoteIcon,
} from "@/components/icons";

interface CompactLyricsProps {
  track: Track;
  /** Cover-derived palette for the bass glow (falls back to brand violet). */
  palette?: CoverPalette | null;
  /** Called when a title/artist link navigates, to close the fullscreen view. */
  onNavigate?: () => void;
}

/**
 * Compact lyrics view for the mobile fullscreen player: a small track header,
 * a dense scrolling lyric list (auto-centered on the active line), and a slim
 * transport bar so playback stays controllable while reading. Hidden on lg,
 * where the roomier {@link LyricsPanel} grid column is used instead.
 */
export default function CompactLyrics({
  track,
  palette,
  onNavigate,
}: CompactLyricsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const seek = usePlayerStore((s) => s.seek);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  // Bass-reactive pulse on the header cover, tinted by the cover palette.
  const coverRef = useBassGlow<HTMLDivElement>(isPlaying, {
    baseSpread: 8,
    peakSpread: 34,
    baseAlpha: 0.25,
    peakAlpha: 0.85,
    maxScale: 0.07,
    tintBorder: false,
    color: palette?.rgb,
  });
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
        <div
          ref={coverRef}
          className="h-12 w-12 flex-shrink-0 rounded-lg will-change-transform"
        >
          {track.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={track.cover}
              alt=""
              className="h-full w-full rounded-lg object-cover shadow"
            />
          ) : (
            <CoverPlaceholder className="h-full w-full rounded-lg" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <TrackTitle
            track={track}
            onNavigate={onNavigate}
            className="block truncate text-sm font-bold hover:underline"
          />
          <ArtistLinks
            track={track}
            onNavigate={onNavigate}
            className="block truncate text-xs text-muted"
            linkClassName="hover:text-foreground hover:underline"
          />
        </div>
      </div>

      {/* Lyrics label */}
      <div className="flex flex-shrink-0 items-center gap-2 pb-2 text-foreground/90">
        <MusicNoteIcon width={14} height={14} />
        <span className="text-[11px] font-semibold uppercase tracking-widest">
          Lyrics
        </span>
        {isAiGenerated && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
            ✦ AI
          </span>
        )}
      </div>

      {/* Lyrics */}
      {lines.length > 0 ? (
        <div
          ref={scrollRef}
          data-np-scroll
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain no-scrollbar py-[34vh] pr-1"
        >
          {lines.map((line, i) => {
            const isActive = i === active;
            const dist = Math.abs(i - active);
            return (
              <button
                key={i}
                type="button"
                ref={isActive ? activeRef : undefined}
                onClick={() => hasTimedLines && seek(line.t)}
                disabled={!hasTimedLines}
                style={
                  isActive
                    ? undefined
                    : { opacity: dist === 1 ? 0.6 : dist === 2 ? 0.45 : 0.3 }
                }
                className={`block w-full text-left py-1.5 text-lg font-bold leading-snug transition-all duration-300 ${
                  isActive ? "text-[color:var(--accent-soft)]" : "text-muted"
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
            onChange={(e) => seek(Number(e.target.value))}
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
            onClick={prev}
            aria-label="Vorheriger Titel"
            className="text-muted hover:text-foreground"
          >
            <PrevIcon width={26} height={26} />
          </button>
          <button
            type="button"
            onClick={toggle}
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
            onClick={next}
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
