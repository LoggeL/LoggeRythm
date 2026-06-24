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

  // Always render a fixed 3-row window (prev / current / next).
  const window: { line: Line | null; isActive: boolean }[] = [-1, 0, 1].map(
    (off) => {
      const idx = active + off;
      return {
        line: idx >= 0 && idx < lines.length ? lines[idx] : null,
        isActive: off === 0 && active >= 0,
      };
    },
  );

  const hasLyrics = !!track && !isLoading && lines.length > 0;

  // Status message when there is no synced karaoke view to show.
  const status = !track
    ? "Es wird nichts abgespielt."
    : isLoading
      ? "Lädt…"
      : "Kein synchronisierter Songtext gefunden.";

  return (
    <div className="animate-in flex-shrink-0 bg-panel border-t border-white/10 flex items-stretch">
      <div className="flex-shrink-0 flex items-center px-4 sm:px-6">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Lyrics
        </span>
      </div>

      {hasLyrics ? (
        <div className="flex-1 min-w-0 h-24 flex flex-col items-center justify-center text-center px-4">
          {window.map((row, i) => (
            <button
              key={i}
              type="button"
              onClick={() => row.line && seek(row.line.t)}
              disabled={!row.line}
              className={`block w-full truncate leading-7 transition-colors ${
                row.isActive
                  ? "text-foreground font-semibold text-base"
                  : "text-muted/60 text-sm"
              }`}
            >
              {row.line?.text || "♪"}
            </button>
          ))}
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
