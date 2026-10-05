"use client";

import type { LyricsData } from "@/hooks/useLyrics";

/** Distinguish an unavailable lyric from a failed request in both layouts. */
export default function LyricsStatus({ lyrics }: { lyrics: LyricsData }) {
  if (lyrics.isError) {
    if (!lyrics.error) throw new Error("Songtext-Anfrage fehlgeschlagen, aber die Fehlerursache fehlt.");
    return (
      <div role="alert" className="error-panel w-full">
        <p className="font-medium">Der Songtext konnte nicht geladen werden.</p>
        <p className="mt-1 break-words text-xs">{lyrics.error.message}</p>
        <button
          type="button"
          onClick={lyrics.retry}
          disabled={lyrics.isFetching}
          className="action-secondary mt-3"
        >
          {lyrics.isFetching ? "Wird geladen…" : "Erneut versuchen"}
        </button>
      </div>
    );
  }

  return (
    <p role="status" className="text-sm text-muted">
      {lyrics.isLoading ? "Songtext wird geladen…" : "Für diesen Titel ist kein Songtext verfügbar."}
    </p>
  );
}
