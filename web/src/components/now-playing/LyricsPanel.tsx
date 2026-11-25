"use client";

import { usePlayerStore } from "@/store/player";
import { useLyrics } from "@/hooks/useLyrics";
import { useLivePlaybackTime } from "@/hooks/useLivePlaybackTime";
import KaraokeLine from "@/components/KaraokeLine";
import LyricsVariantToggle from "@/components/LyricsVariantToggle";
import type { Track } from "@/types";
import LyricsStatus from "./LyricsStatus";
import { useActiveLineScroll } from "./useActiveLineScroll";

/**
 * Karaoke-style lyrics: large lines, word-by-word highlight when word timings
 * are available, explicit Instrumental state, and clean unsynced view. Tapping
 * a timed line seeks to it. Respects manual scrolling with a "Synchronisieren" pill.
 */
export default function LyricsPanel({ track }: { track: Track }) {
  const currentTime = useLivePlaybackTime(true);
  const seek = usePlayerStore((s) => s.seek);
  const lyrics = useLyrics(track.artist, track.title, track.id, currentTime, {
    album: track.album,
    duration_sec: track.duration_sec,
  });
  const { lines, active, hasTimedLines, hasWordTimings, instrumental } = lyrics;
  const { scrollRef, activeRef, userScrolled, resumeSync } = useActiveLineScroll(active, lines.length);
  const showLines = !instrumental && lines.length > 0 && !lyrics.isError;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-7 flex-shrink-0 items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-2">
          <h2 className="sr-only">Songtext</h2>
          <LyricsVariantToggle lyrics={lyrics} />
          {showLines && !hasTimedLines && (
            <span className="label-mono rounded-full border border-white/14 bg-[#0f0e11]/75 px-2.5 py-0.5 text-[10px] text-foreground/85">
              Nicht synchronisiert
            </span>
          )}
          {showLines && hasWordTimings && (
            <span className="label-mono rounded-full border border-accent/45 bg-[#0f0e11]/80 px-2.5 py-0.5 text-[10px] text-accent-soft">
              Karaoke
            </span>
          )}
        </div>
        {showLines && hasTimedLines && userScrolled && (
          <button
            type="button"
            onClick={resumeSync}
            className="action-secondary min-h-8 border-accent/50 bg-[#0f0e11]/85 px-3 text-xs text-accent-soft shadow-[0_6px_18px_rgb(0_0_0/0.45)] backdrop-blur-md hover:bg-[#0f0e11]/95"
          >
            Synchronisieren
          </button>
        )}
      </div>
      {showLines ? (
        <div
          ref={scrollRef}
          data-np-scroll
          className={`no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 [mask-image:linear-gradient(to_bottom,transparent,black_14%,black_84%,transparent)] ${
            hasTimedLines ? "py-[38vh]" : "py-10"
          }`}
        >
          {lines.map((line, i) => {
            const isActive = i === active;
            const isPast = hasTimedLines && active >= 0 && i < active;
            return (
              <button
                key={i}
                type="button"
                ref={isActive ? activeRef : undefined}
                onClick={() => {
                  seek(line.t);
                  resumeSync();
                }}
                disabled={!hasTimedLines}
                aria-current={isActive ? "true" : undefined}
                className={`block w-full rounded-xl py-2 text-left font-display text-[1.7rem] font-extrabold leading-[1.12] tracking-[-0.03em] transition-[color,background-color] duration-300 motion-reduce:transition-none lg:py-3 lg:text-[clamp(2rem,3.1vw,3.25rem)] ${
                  !hasTimedLines
                    ? "px-2.5 text-foreground/95 [text-shadow:0_2px_12px_rgb(0_0_0/0.8)]"
                    : isActive
                      ? "bg-white/[0.07] px-3 text-foreground ring-1 ring-white/[0.09] [text-shadow:0_2px_16px_rgb(0_0_0/0.88)]"
                      : isPast
                        ? "px-2.5 text-foreground/50 [text-shadow:0_1px_10px_rgb(0_0_0/0.75)] hover:bg-white/[0.04] hover:text-foreground/85"
                        : "px-2.5 text-foreground/68 [text-shadow:0_1px_10px_rgb(0_0_0/0.78)] hover:bg-white/[0.04] hover:text-foreground/92"
                }`}
              >
                <span
                  className={`block origin-left transition-transform duration-300 motion-reduce:transition-none ${
                    hasTimedLines && isActive ? "lg:max-w-[97%] lg:scale-[1.02]" : ""
                  }`}
                >
                  <KaraokeLine
                    line={line}
                    isActive={hasTimedLines && isActive}
                    isPast={isPast}
                    currentTime={currentTime}
                  />
                </span>
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
