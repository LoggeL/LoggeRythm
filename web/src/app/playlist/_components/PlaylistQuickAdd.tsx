"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SEARCH_MIN_LENGTH, searchTracksOptions } from "@/lib/catalogQueries";
import { isRateLimitError } from "@/lib/rateLimit";
import { trackArtistLabel } from "@/lib/trackArtists";
import { formatTime } from "@/lib/format";
import { useSearchInput } from "@/hooks/useSearchInput";
import { useAddToPlaylist } from "@/hooks/useLibrary";
import { toast } from "@/store/toast";
import SearchField from "@/components/SearchField";
import SearchRateLimitAlert from "@/components/SearchRateLimitAlert";
import Cover from "@/components/ui/Cover";
import QueryError from "@/components/ui/QueryError";
import { CheckIcon, PlusIcon, SpinnerIcon } from "@/components/icons";
import type { Track } from "@/types";

/**
 * Inline Quick-Add search shown on editable playlists so listeners can search
 * and drop songs directly into the playlist without leaving the page.
 */
export default function PlaylistQuickAdd({
  playlistId,
  existingTrackIds,
}: {
  playlistId: string;
  existingTrackIds: ReadonlySet<string>;
}) {
  const search = useSearchInput("", playlistId);
  const addToPlaylist = useAddToPlaylist();
  const [addingId, setAddingId] = useState<string | null>(null);
  const enabled = !search.preparing && search.query.length >= SEARCH_MIN_LENGTH;
  const query = useQuery({ ...searchTracksOptions(enabled ? search.query : ""), enabled });
  const tracks = enabled && !query.isError ? (query.data ?? []).slice(0, 8) : [];

  function handleAdd(track: Track) {
    const id = String(track.id);
    if (addingId !== null) return;
    setAddingId(id);
    addToPlaylist.mutate(
      { id: playlistId, track },
      {
        onSuccess: () => {
          toast.success(`„${track.title}“ hinzugefügt.`);
        },
        onSettled: () => setAddingId(null),
      },
    );
  }

  return (
    <section aria-label="Titel zur Playlist hinzufügen" className="mt-8 border-t border-hairline pt-6">
      <h2 className="font-display text-lg font-bold tracking-tight">Titel schnell hinzufügen</h2>
      <SearchField
        value={search.input}
        onValueChange={search.setInput}
        onSubmit={() => search.submit()}
        onClear={search.clear}
        label="Songs zum Hinzufügen suchen"
        placeholder="Titel oder Künstler suchen…"
        className="mt-3 max-w-xl"
        inputProps={{
          onCompositionStart: () => search.setComposing(true),
          onCompositionEnd: () => search.setComposing(false),
        }}
      />

      {enabled && query.isError && (
        isRateLimitError(query.error) ? (
          <SearchRateLimitAlert
            className="mt-3 max-w-xl"
            labels={["Suchergebnisse"]}
            error={query.error}
            isFetching={query.isFetching}
            onRetry={() => query.refetch()}
          />
        ) : (
          <QueryError label="Suchergebnisse" query={query} className="mt-3 max-w-xl" />
        )
      )}

      {search.input.trim().length >= SEARCH_MIN_LENGTH && (search.preparing || query.isLoading) && (
        <div role="status" aria-label="Suche läuft" className="mt-3 flex max-w-2xl flex-col gap-1">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3 py-2">
              <span className="skeleton h-10 w-10 shrink-0 rounded-md" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="skeleton h-3.5 w-1/2 rounded" />
                <span className="skeleton h-3 w-1/3 rounded" />
              </span>
            </div>
          ))}
        </div>
      )}

      {tracks.length > 0 && (
        <ul className="mt-3 flex max-w-2xl flex-col divide-y divide-hairline">
          {tracks.map((track) => {
            const id = String(track.id);
            const already = existingTrackIds.has(id);
            const busy = addingId === id;
            return (
              <li key={id} className="flex items-center gap-3 py-2">
                <Cover src={track.cover} className="h-10 w-10 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{track.title}</p>
                  <p className="truncate text-xs text-muted">
                    {trackArtistLabel(track)}
                    {track.album ? ` · ${track.album}` : ""}
                  </p>
                </div>
                <span className="hidden font-mono text-xs tabular-nums text-subtle sm:inline">
                  {formatTime(track.duration_sec)}
                </span>
                <button
                  type="button"
                  disabled={addingId !== null}
                  onClick={() => handleAdd(track)}
                  aria-label={`${track.title} zur Playlist hinzufügen`}
                  className={`min-h-9 shrink-0 px-3 text-xs ${already ? "action-secondary text-success" : "action-secondary"}`}
                >
                  {busy ? (
                    <SpinnerIcon width={14} height={14} className="animate-spin" />
                  ) : already ? (
                    <CheckIcon width={14} height={14} />
                  ) : (
                    <PlusIcon width={14} height={14} />
                  )}
                  {already ? "Nochmal" : "Hinzufügen"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {enabled && query.isSuccess && tracks.length === 0 && (
        <p role="status" className="mt-3 text-sm text-muted">
          Keine Titel für „{search.query}“ gefunden.
        </p>
      )}
    </section>
  );
}
