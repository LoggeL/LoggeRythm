"use client";

import { useQuery } from "@tanstack/react-query";
import { SEARCH_MIN_LENGTH, searchTracksOptions } from "@/lib/catalogQueries";
import { useSearchInput } from "@/hooks/useSearchInput";
import SearchField from "@/components/SearchField";
import PopularTrackTable from "@/components/PopularTrackTable";
import { RowListSkeleton } from "@/components/Skeleton";
import { artistSongQuery, isArtistTrack } from "./artistSearchModel";

export default function ArtistSongSearch({ artistId, artistName }: { artistId: string; artistName: string }) {
  const search = useSearchInput("", artistId);
  const enabled = !search.preparing && search.query.length >= SEARCH_MIN_LENGTH;
  const scopedQuery = enabled ? artistSongQuery(artistName, search.query) : "";
  const result = useQuery({ ...searchTracksOptions(scopedQuery), enabled });
  const results = enabled && !result.isError ? (result.data ?? []).filter((track) => isArtistTrack(track, artistId, artistName)) : [];

  return (
    <section className="mb-10" aria-label={`Songs von ${artistName} durchsuchen`}>
      <h2 className="section-heading mb-4">Songs durchsuchen</h2>
      <SearchField value={search.input} onValueChange={search.setInput} onSubmit={() => search.submit()} onClear={search.clear} label={`Songs von ${artistName} suchen`} placeholder={`Songs von ${artistName} suchen`} className="max-w-xl mb-5"
        inputProps={{
          onCompositionStart: () => search.setComposing(true),
          onCompositionEnd: () => search.setComposing(false),
        }}
      />
      {enabled && result.isError && <div role="alert" className="error-panel mb-4">
        Songs konnten nicht geladen werden: {result.error.message}
        <button type="button" className="action-secondary mt-3" disabled={result.isFetching} onClick={() => void result.refetch()}>Erneut versuchen</button>
      </div>}
      {search.input.trim().length >= SEARCH_MIN_LENGTH && (search.preparing || (result.isLoading && results.length === 0)) ? <RowListSkeleton />
        : results.length > 0 ? <PopularTrackTable tracks={results} context={artistName} />
        : enabled && result.isSuccess ? <p role="status" className="text-sm text-muted px-1">Keine Songs für &quot;{search.query}&quot; gefunden.</p>
        : null}
    </section>
  );
}
