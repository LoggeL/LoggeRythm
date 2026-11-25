"use client";

import type { LyricsData } from "@/hooks/useLyrics";
import { LyricsIcon, MusicNoteIcon } from "@/components/icons";

/** Loading, instrumental, missing and failed lyrics — a failed request is never shown as "no lyrics". */
export default function LyricsStatus({ lyrics }: { lyrics: LyricsData }) {
  if (lyrics.isError) {
    if (!lyrics.error) throw new Error("Songtext-Anfrage fehlgeschlagen, aber die Fehlerursache fehlt.");
    return (
      <div role="alert" className="error-panel w-full max-w-md">
        <p className="font-medium">Der Songtext konnte nicht geladen werden.</p>
        <p className="mt-1 break-words text-xs">{lyrics.error.message}</p>
        <button type="button" onClick={lyrics.retry} disabled={lyrics.isFetching} className="action-secondary mt-3 min-h-9 px-4 text-xs">
          {lyrics.isFetching ? "Wird geladen…" : "Erneut versuchen"}
        </button>
      </div>
    );
  }

  if (lyrics.isLoading) {
    return (
      <div role="status" aria-label="Songtext wird geladen" className="flex w-full max-w-xl flex-col gap-4">
        {["w-4/5", "w-3/5", "w-11/12", "w-2/3", "w-3/4"].map((width, i) => (
          <span key={i} className={`skeleton h-7 rounded-lg lg:h-9 ${width}`} />
        ))}
      </div>
    );
  }

  if (lyrics.instrumental) {
    return (
      <div role="status" className="flex flex-col items-center text-center">
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-accent/35 bg-accent/12 text-accent">
          <MusicNoteIcon width={24} height={24} />
        </span>
        <p className="font-display text-lg font-extrabold tracking-tight">Instrumental</p>
        <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">
          Dieser Titel ist rein instrumental – lehne dich zurück und genieße die Musik.
        </p>
      </div>
    );
  }

  return (
    <div role="status" className="flex flex-col items-center text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-white/[0.07] text-muted">
        <LyricsIcon width={24} height={24} />
      </span>
      <p className="text-base font-semibold">Kein Songtext verfügbar</p>
      <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">Für diesen Titel haben wir keinen Text gefunden. Unter „Ähnliche Titel“ geht die Musik weiter.</p>
    </div>
  );
}
