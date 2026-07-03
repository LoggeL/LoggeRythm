"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore, currentTrack } from "@/store/player";
import { MusicNoteIcon, ChevronDownIcon } from "@/components/icons";

type Line = { t: number; text: string };

const LINE_H = 30; // px per lyric line
const COLLAPSED_ROWS = 3;
const EXPANDED_ROWS = 7;

export default function Lyrics() {
  const open = usePlayerStore((s) => s.lyricsOpen);
  const track = usePlayerStore(currentTrack);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const [expanded, setExpanded] = useState(false);

  // Slide-out animation: keep the panel mounted while it collapses shut,
  // and mount it collapsed so opening always transitions from height 0.
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setPresent(true);
      // Double rAF: let the browser paint the collapsed state first so the
      // grid-rows transition actually runs on open.
      let id2 = 0;
      const id1 = requestAnimationFrame(() => {
        id2 = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(id1);
        cancelAnimationFrame(id2);
      };
    }
    setShown(false);
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: ["lyrics", track?.id],
    queryFn: () => api.lyrics(track!.artist, track!.title, String(track!.id)),
    enabled: open && !!track,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  if (!present) return null;

  const lines: Line[] = data?.lines ?? [];
  const isAiGenerated = !!data?.ai_generated;

  // Active line = last line whose timestamp has passed.
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= currentTime + 0.15) active = i;
    else break;
  }
  const a = active < 0 ? 0 : active;
  const hasLyrics = !!track && !isLoading && lines.length > 0;

  const rows = expanded ? EXPANDED_ROWS : COLLAPSED_ROWS;
  // How many lines to show above the active one (centred-ish when expanded,
  // anchored to the top when collapsed).
  const above = expanded ? 2 : 0;

  const status = !track
    ? "Es wird nichts abgespielt."
    : isLoading
      ? "Lädt…"
      : "Kein Songtext gefunden.";

  return (
    <div
      className={`grid flex-shrink-0 transition-[grid-template-rows,opacity] duration-300 ease-out ${
        shown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
      onTransitionEnd={(e) => {
        // Unmount only after the collapse finishes (not on inner transitions).
        if (e.target === e.currentTarget && !open) setPresent(false);
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="border-t border-white/10 bg-[#0c0c18]/90 backdrop-blur-xl flex items-center gap-4 px-6 py-3 overflow-hidden">
          {/* Label */}
          <div className="flex flex-shrink-0 items-center gap-2 text-foreground/90 self-start pt-1">
            <MusicNoteIcon width={16} height={16} />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Lyrics
            </span>
            {isAiGenerated && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
                ✦ AI
              </span>
            )}
          </div>

          {/* Karaoke window */}
          {hasLyrics ? (
            <div
              className="flex-1 min-w-0 overflow-hidden transition-[height] duration-300 ease-out"
              style={{ height: rows * LINE_H }}
            >
              <div
                className="transition-transform duration-500 ease-out will-change-transform"
                style={{ transform: `translateY(${(above - a) * LINE_H}px)` }}
              >
                {lines.map((line, i) => {
                  const dist = Math.abs(i - a);
                  const isActive = i === active;
                  return (
                    <p
                      key={i}
                      style={{ height: LINE_H, opacity: isActive ? 1 : dist === 1 ? 0.6 : dist === 2 ? 0.4 : 0.25 }}
                      className={`flex items-center justify-center w-full truncate text-center transition-all duration-300 ${
                        isActive
                          ? "text-[15px] font-bold text-[#c06bff]"
                          : "text-sm text-muted"
                      }`}
                    >
                      {line.text || "♪"}
                    </p>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              className="flex-1 min-w-0 flex items-center justify-center text-center transition-[height] duration-300"
              style={{ height: COLLAPSED_ROWS * LINE_H }}
            >
              <p className="text-sm text-muted truncate">{status}</p>
            </div>
          )}

          {/* Expand / collapse */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Songtext verkleinern" : "Songtext vergrößern"}
            aria-expanded={expanded}
            disabled={!hasLyrics}
            className="flex-shrink-0 self-start mt-1 text-muted hover:text-foreground transition disabled:opacity-30 p-1"
          >
            <ChevronDownIcon
              width={20}
              height={20}
              className={`transition-transform duration-300 ${
                expanded ? "rotate-0" : "rotate-180"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
