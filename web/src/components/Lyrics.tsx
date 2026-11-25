"use client";

import { useState } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import { useLyrics } from "@/hooks/useLyrics";
import { useLivePlaybackTime } from "@/hooks/useLivePlaybackTime";
import KaraokeLine from "@/components/KaraokeLine";
import LyricsVariantToggle from "@/components/LyricsVariantToggle";
import { LyricsIcon, ChevronDownIcon } from "@/components/icons";

const LINE_H = 32; // px per lyric line
const COLLAPSED_ROWS = 3;
const EXPANDED_ROWS = 7;

/**
 * Lyrics dock at the bottom of the main panel: a short karaoke window that
 * follows the playing line (with word-by-word fill when available) or shows
 * clean unsynced / Instrumental states. Click a timed line to jump there.
 */
export default function Lyrics() {
  const open = usePlayerStore((s) => s.lyricsOpen);
  const track = usePlayerStore(currentTrack);
  const currentTime = useLivePlaybackTime(open);
  const seek = usePlayerStore((s) => s.seek);
  const [expanded, setExpanded] = useState(false);

  // Shares fetch, variant preference and toggle with the fullscreen view;
  // an empty trackId keeps the query disabled while the dock is closed.
  const lyrics = useLyrics(track?.artist ?? "", track?.title ?? "", open && track ? track.id : "", currentTime, {
    album: track?.album,
    duration_sec: track?.duration_sec,
  });
  const { lines, active, isLoading, hasTimedLines, instrumental } = lyrics;
  const a = active < 0 ? 0 : active;
  const hasLyrics = !!track && !isLoading && !lyrics.isError && !instrumental && lines.length > 0;

  const rows = expanded ? EXPANDED_ROWS : COLLAPSED_ROWS;
  // Lines shown above the active one: it sits in the middle of the window.
  const above = expanded ? 3 : 1;

  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={`grid flex-shrink-0 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <section aria-label="Songtext" className="glass flex items-start gap-4 border-t border-hairline px-4 py-3 sm:px-6">
          <div className="flex flex-shrink-0 items-center gap-2 pt-1.5 text-muted">
            <LyricsIcon width={16} height={16} />
            <span className="text-xs font-semibold max-sm:sr-only">Songtext</span>
            <LyricsVariantToggle lyrics={lyrics} />
          </div>

          {hasLyrics ? (
            <div className="min-w-0 flex-1 overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none" style={{ height: rows * LINE_H }}>
              <div
                className="transition-transform duration-500 ease-out will-change-transform motion-reduce:transition-none"
                style={{ transform: `translateY(${(above - a) * LINE_H}px)` }}
              >
                {lines.map((line, i) => {
                  const isActive = i === active;
                  const near = Math.abs(i - a) <= above;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => seek(line.t)}
                      disabled={!hasTimedLines}
                      tabIndex={near ? 0 : -1}
                      aria-current={isActive ? "true" : undefined}
                      style={{ height: LINE_H }}
                      className={`block w-full truncate px-2 text-center transition-colors duration-300 motion-reduce:transition-none ${
                        isActive ? "font-display text-base font-bold text-foreground" : "text-sm text-subtle enabled:hover:text-foreground"
                      }`}
                    >
                      {hasTimedLines ? (
                        <KaraokeLine
                          line={line}
                          isActive={isActive}
                          isPast={active >= 0 && i < active}
                          currentTime={currentTime}
                        />
                      ) : (
                        line.text || "♪"
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center justify-center gap-3 text-center" style={{ height: COLLAPSED_ROWS * LINE_H }}>
              {lyrics.isError ? (
                <p role="alert" className="flex min-w-0 flex-wrap items-center justify-center gap-3 text-sm text-danger">
                  <span className="min-w-0 break-words">Songtext konnte nicht geladen werden: {lyrics.error?.message}</span>
                  <button type="button" onClick={lyrics.retry} disabled={lyrics.isFetching} className="action-secondary min-h-9 px-4 text-xs">
                    {lyrics.isFetching ? "Wird geladen…" : "Erneut versuchen"}
                  </button>
                </p>
              ) : !track ? (
                <p className="truncate text-sm text-muted">Starte einen Titel, um den Songtext zu sehen.</p>
              ) : isLoading ? (
                <span role="status" aria-label="Songtext wird geladen" className="flex w-full max-w-sm flex-col items-center gap-2.5">
                  <span className="skeleton h-3.5 w-3/5 rounded" />
                  <span className="skeleton h-4 w-4/5 rounded" />
                  <span className="skeleton h-3.5 w-1/2 rounded" />
                </span>
              ) : instrumental ? (
                <p className="truncate text-sm font-medium text-accent">Instrumental – dieser Titel hat keinen Gesang.</p>
              ) : (
                <p className="truncate text-sm text-muted">Für diesen Titel gibt es keinen Songtext.</p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Songtext verkleinern" : "Songtext vergrößern"}
            aria-expanded={expanded}
            disabled={!hasLyrics}
            className="action-icon h-9 min-h-9 w-9"
          >
            <ChevronDownIcon width={20} height={20} className={`transition-transform duration-300 motion-reduce:transition-none ${expanded ? "" : "rotate-180"}`} />
          </button>
        </section>
      </div>
    </div>
  );
}
