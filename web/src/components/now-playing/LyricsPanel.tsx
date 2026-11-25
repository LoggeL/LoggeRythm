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
      <div className="flex min-h-7 flex-shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="sr-only">Songtext</h2>
          <LyricsVariantToggle lyrics={lyrics} />
          {showLines && !hasTimedLines && <span className="label-mono">Nicht synchronisiert</span>}
          {showLines && hasWordTimings && (
            <span className="label-mono rounded-full border border-accent/35 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
              Karaoke
            </span>
          )}
        </div>
        {showLines && hasTimedLines && userScrolled && (
          <button
            type="button"
            onClick={resumeSync}
            className="action-secondary min-h-8 border-accent/45 bg-backdrop/75 px-3 text-xs text-accent-soft backdrop-blur"
          >
            Synchronisieren
          </button>
        )}
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
                className={`block w-full origin-left rounded-lg py-2 text-left font-display text-[1.7rem] font-extrabold leading-[1.12] tracking-[-0.03em] transition-[color,transform] duration-300 motion-reduce:transition-none lg:py-3 lg:text-[clamp(2rem,3.1vw,3.25rem)] ${
                  !hasTimedLines
                    ? "text-foreground/90"
                    : isActive
                      ? "text-foreground lg:scale-[1.03]"
                      : isPast
                        ? "text-foreground/30 hover:text-foreground/70"
                        : "text-foreground/45 hover:text-foreground/80"
                }`}
              >
                <KaraokeLine
                  line={line}
                  isActive={hasTimedLines && isActive}
                  isPast={isPast}
                  currentTime={currentTime}
                />
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
