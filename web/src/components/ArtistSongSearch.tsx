"use client";

import { useQuery } from "@tanstack/react-query";
import { SEARCH_MIN_LENGTH, searchTracksOptions } from "@/lib/catalogQueries";
import { useSearchInput } from "@/hooks/useSearchInput";
import SearchField from "@/components/SearchField";
import PopularTrackTable from "@/components/PopularTrackTable";
import { RowListSkeleton } from "@/components/Skeleton";
import SectionHeader from "@/components/ui/SectionHeader";
import { artistSongQuery, isArtistTrack } from "./artistSearchModel";

/** Search within one artist's songs; results only ever list that artist. */
export default function ArtistSongSearch({ artistId, artistName }: { artistId: string; artistName: string }) {
  const search = useSearchInput("", artistId);
  const enabled = !search.preparing && search.query.length >= SEARCH_MIN_LENGTH;
  const scopedQuery = enabled ? artistSongQuery(artistName, search.query) : "";
  const result = useQuery({ ...searchTracksOptions(scopedQuery), enabled });
  const results = enabled && !result.isError ? (result.data ?? []).filter((track) => isArtistTrack(track, artistId, artistName)) : [];
  const waiting = search.input.trim().length >= SEARCH_MIN_LENGTH && (search.preparing || (result.isLoading && results.length === 0));

  return (
    <section aria-label={`Songs von ${artistName} durchsuchen`}>
      <SectionHeader title="Songs durchsuchen" />
      <SearchField value={search.input} onValueChange={search.setInput} onSubmit={() => search.submit()} onClear={search.clear} label={`Songs von ${artistName} suchen`} placeholder={`Songs von ${artistName} suchen`} className="mb-3 max-w-xl"
        inputProps={{
          onCompositionStart: () => search.setComposing(true),
          onCompositionEnd: () => search.setComposing(false),
        }}
      />
      {enabled && result.isError && <div role="alert" className="error-panel mb-4 flex flex-wrap items-center justify-between gap-3">
        Songs konnten nicht geladen werden: {result.error.message}
        <button type="button" className="action-secondary min-h-9 px-4 text-xs" disabled={result.isFetching} onClick={() => void result.refetch()}>{result.isFetching ? "Wird geladen…" : "Erneut versuchen"}</button>
      </div>}
      {waiting ? <RowListSkeleton count={4} />
        : results.length > 0 ? <PopularTrackTable tracks={results} context={artistName} />
        : enabled && result.isSuccess ? <p role="status" className="py-2 text-sm text-muted">Keine Songs von {artistName} für „{search.query}“ gefunden.</p>
        : null}
    </section>
  );
}
