"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SearchIcon } from "@/components/icons";
import PopularTrackTable from "@/components/PopularTrackTable";
import { RowListSkeleton } from "@/components/Skeleton";
import type { Track } from "@/types";

/**
 * Search within a single artist's catalogue. Uses Deezer's advanced query
 * syntax (`artist:"…" track:"…"`) and additionally filters results down to the
 * artist so featured/compilation noise is dropped.
 */
export default function ArtistSongSearch({
  artistId,
  artistName,
}: {
  artistId: string;
  artistName: string;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  // Debounce typing into the actual query.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["artist-song-search", artistId, query],
    queryFn: ({ signal }) => api.search(`artist:"${artistName}" track:"${query}"`, "track", signal),
    enabled: query.length > 0,
    staleTime: 5 * 60_000,
  });

  const results: Track[] = (data ?? []).filter((t) => {
    if (String(t.artist_id) === String(artistId)) return true;
    const credits = t.artists ?? [];
    if (credits.some((a) => String(a.id) === String(artistId))) return true;
    // Fall back to a name match when ids aren't present.
    return t.artist?.toLowerCase().includes(artistName.toLowerCase());
  });

  return (
    <section className="mb-10">
      <h2 className="section-heading mb-4">Songs durchsuchen</h2>
      <div className="relative max-w-xl mb-5">
        <SearchIcon
          className="absolute left-4 top-1/2 -translate-y-1/2 text-muted"
          width={18}
          height={18}
        />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Songs von ${artistName} suchen…`}
          aria-label={`Songs von ${artistName} suchen`}
          className="field-input w-full pl-11"
        />
      </div>

      {query.length > 0 && isError && (
        <div role="alert" className="error-panel mb-4">
          Songs konnten nicht geladen werden: {error.message}
          <button type="button" className="ml-3 underline" disabled={isFetching} onClick={() => void refetch()}>Erneut versuchen</button>
        </div>
      )}
      {query.length === 0 ? null : isFetching && results.length === 0 ? (
        <RowListSkeleton />
      ) : results.length > 0 ? (
        <PopularTrackTable tracks={results} context={artistName} />
      ) : isError ? null : (
        <p className="text-sm text-muted px-1">
          Keine Songs für &bdquo;{query}&ldquo; gefunden.
        </p>
      )}
    </section>
  );
}
