"use client";

import { usePlayerStore } from "@/store/player";
import { useLyrics } from "@/hooks/useLyrics";
import LyricsVariantToggle from "@/components/LyricsVariantToggle";
import type { Track } from "@/types";
import LyricsStatus from "./LyricsStatus";
import { useActiveLineScroll } from "./useActiveLineScroll";

/**
 * Karaoke-style lyrics: large lines, the active one in full white and centred,
 * everything else dimmed. Tapping a timed line seeks to it.
 */
export default function LyricsPanel({ track }: { track: Track }) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seek = usePlayerStore((s) => s.seek);
  const lyrics = useLyrics(track.artist, track.title, track.id, currentTime);
  const { lines, active, hasTimedLines } = lyrics;
  const { scrollRef, activeRef } = useActiveLineScroll(active, lines.length);
  const showLines = lines.length > 0 && !lyrics.isError;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-7 flex-shrink-0 items-center gap-2">
        <h2 className="sr-only">Songtext</h2>
        <LyricsVariantToggle lyrics={lyrics} />
        {showLines && !hasTimedLines && <span className="label-mono">Nicht synchronisiert</span>}
      </div>
      {showLines ? (
        <div
          ref={scrollRef}
          data-np-scroll
          className={`no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_14%,black_84%,transparent)] ${
            hasTimedLines ? "py-[38vh]" : "py-10"
          }`}
        >
          {lines.map((line, i) => {
            const isActive = i === active;
            return (
              <button
                key={i}
                type="button"
                ref={isActive ? activeRef : undefined}
                onClick={() => seek(line.t)}
                disabled={!hasTimedLines}
                aria-current={isActive ? "true" : undefined}
                className={`block w-full origin-left rounded-lg py-2 text-left font-display text-[1.7rem] font-extrabold leading-[1.12] tracking-[-0.03em] transition-[color,transform] duration-300 motion-reduce:transition-none lg:py-3 lg:text-[clamp(2rem,3.1vw,3.25rem)] ${
                  !hasTimedLines
                    ? "text-foreground/90"
                    : isActive
                      ? "text-foreground lg:scale-[1.03]"
                      : i < active
                        ? "text-foreground/30 hover:text-foreground/70"
                        : "text-foreground/45 hover:text-foreground/80"
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
    </div>
  );
}
