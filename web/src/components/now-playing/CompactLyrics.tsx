"use client";

import { useLayoutEffect, useRef } from "react";
import type { Track } from "@/types";
import { usePlayerStore } from "@/store/player";
import { useLyrics } from "@/hooks/useLyrics";
import LyricsVariantToggle from "@/components/LyricsVariantToggle";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { MusicNoteIcon } from "@/components/icons";
import { SeekBar, TransportRow } from "./Controls";
import LyricsStatus from "./LyricsStatus";

interface CompactLyricsProps {
  track: Track;
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
  onNavigate,
}: CompactLyricsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const hasPositionedRef = useRef(false);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seek = usePlayerStore((s) => s.seek);
  const lyrics = useLyrics(track.artist, track.title, track.id, currentTime);
  const { lines, active, hasTimedLines } = lyrics;

  useLayoutEffect(() => {
    const el = activeRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;

    const positionActiveLine = () => {
      if (container.clientHeight === 0) return false;
      const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
      if (hasPositionedRef.current) {
        container.scrollTo({ top, behavior: "smooth" });
      } else {
        // Opening fullscreen must start on the current lyric, before paint.
        container.scrollTop = top;
        hasPositionedRef.current = true;
      }
      return true;
    };

    if (positionActiveLine()) return;
    const observer = new ResizeObserver(() => {
      if (positionActiveLine()) observer.disconnect();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, lines.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:hidden">
      {/* Compact track header */}
      <div className="flex flex-shrink-0 items-center gap-3 pb-3">
        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-border">
          {track.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={track.cover}
              alt=""
              className="h-full w-full object-cover"
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
        <span className="text-xs font-medium">
          Songtext
        </span>
        <LyricsVariantToggle lyrics={lyrics} />
      </div>

      {/* Lyrics */}
      {lines.length > 0 && !lyrics.isError ? (
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
                    : hasTimedLines ? { opacity: dist === 1 ? 0.85 : dist === 2 ? 0.7 : 0.55 } : undefined
                }
                className={`block w-full py-2 text-left text-xl font-semibold leading-snug transition-colors duration-200 ${
                  isActive ? "text-accent-soft" : "text-foreground"
                }`}
              >
                {line.text || "♪"}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <LyricsStatus lyrics={lyrics} />
        </div>
      )}

      {/* Slim transport */}
      <div className="flex-shrink-0 border-t border-border pt-3">
        <SeekBar />
        <TransportRow />
      </div>
    </div>
  );
}
