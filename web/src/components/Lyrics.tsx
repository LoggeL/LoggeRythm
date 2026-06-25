"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore, currentTrack } from "@/store/player";

type Line = { t: number; text: string };

export default function Lyrics() {
  const open = usePlayerStore((s) => s.lyricsOpen);
  const setOpen = usePlayerStore((s) => s.setLyricsOpen);
  const track = usePlayerStore(currentTrack);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seek = usePlayerStore((s) => s.seek);

  const { data, isLoading } = useQuery({
    queryKey: ["lyrics", track?.id],
    queryFn: () => api.lyrics(track!.artist, track!.title, String(track!.id)),
    enabled: open && !!track,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  if (!open) return null;

  const lines: Line[] = data?.lines ?? [];

  // Active line = last line whose timestamp has passed.
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= currentTime + 0.15) active = i;
    else break;
  }

  const hasLyrics = !!track && !isLoading && lines.length > 0;

  // Status message when there is no synced karaoke view to show.
  const status = !track
    ? "Es wird nichts abgespielt."
    : isLoading
      ? "Lädt…"
      : "Kein synchronisierter Songtext gefunden.";

  const LINE_H = 28; // px, matches leading-7
  const ROWS = 3;
  const a = active < 0 ? 0 : active;

  return (
    <div className="animate-in flex-shrink-0 bg-gradient-to-t from-black/85 via-black/70 to-black/30 backdrop-blur-sm border-t border-white/10 flex items-stretch">
      <div className="flex-shrink-0 flex items-center px-4 sm:px-6">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Lyrics
        </span>
      </div>

      {hasLyrics ? (
        <div
          className="flex-1 min-w-0 overflow-hidden px-4"
          style={{ height: LINE_H * ROWS }}
        >
          <div
            className="transition-transform duration-500 ease-out will-change-transform"
            style={{ transform: `translateY(${(1 - a) * LINE_H}px)` }}
          >
            {lines.map((line, i) => {
              const activeLine = i === active;
              const dist = Math.abs(i - a);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => seek(line.t)}
                  style={{
                    height: LINE_H,
                    opacity: activeLine ? 1 : dist === 1 ? 0.55 : 0.3,
                  }}
                  className={`flex items-center justify-center w-full truncate text-center text-sm leading-7 transition-all duration-300 ${
                    activeLine
                      ? "text-foreground font-semibold"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {line.text || "♪"}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0 h-10 flex items-center justify-center text-center px-4">
          <p className="text-sm text-muted truncate">{status}</p>
        </div>
      )}

      <div className="flex-shrink-0 flex items-start p-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Songtext schließen"
          className="text-muted hover:text-foreground text-sm"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
