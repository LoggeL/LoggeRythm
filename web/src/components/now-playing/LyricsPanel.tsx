"use client";

import { useLayoutEffect, useRef } from "react";
import { usePlayerStore } from "@/store/player";
import { useLyrics } from "@/hooks/useLyrics";
import { MusicNoteIcon } from "@/components/icons";
import type { Track } from "@/types";

/**
 * Roomy desktop lyrics column: large centered lines, the active one
 * highlighted in the cover accent, neighbours progressively dimmed. Mobile
 * uses {@link CompactLyrics} instead.
 */
export default function LyricsPanel({ track }: { track: Track }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const hasPositionedRef = useRef(false);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seek = usePlayerStore((s) => s.seek);
  const { lines, active, hasTimedLines, isLoading, isAiGenerated } = useLyrics(
    track.artist,
    track.title,
    track.id,
    currentTime,
  );

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
    <div className="hidden min-h-0 flex-col lg:flex">
      <span className="mb-4 flex flex-shrink-0 items-center gap-2 text-foreground/90">
        <MusicNoteIcon width={16} height={16} />
        <span className="text-xs font-semibold uppercase tracking-widest">
          Lyrics
        </span>
        {isAiGenerated && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
            ✦ AI
          </span>
        )}
      </span>
      {lines.length > 0 ? (
        <div
          ref={scrollRef}
          data-np-scroll
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain no-scrollbar py-[35vh] pr-2 text-center"
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
                className={`block w-full py-2 text-3xl font-bold leading-snug transition-all duration-300 ${
                  isActive
                    ? "text-[color:var(--accent-soft)]"
                    : "text-muted hover:opacity-90"
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
    </div>
  );
}
