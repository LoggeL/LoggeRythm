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

  const { data, isFetching } = useQuery({
    queryKey: ["artist-song-search", artistId, query],
    queryFn: () => api.search(`artist:"${artistName}" track:"${query}"`),
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
      <h2 className="text-2xl font-bold mb-4">Songs durchsuchen</h2>
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
          className="w-full rounded-full bg-white/[0.06] border border-white/10 pl-11 pr-4 py-3 text-[15px] outline-none placeholder:text-muted focus:border-accent focus:bg-white/[0.08] transition"
        />
      </div>

      {query.length === 0 ? null : isFetching && results.length === 0 ? (
        <RowListSkeleton />
      ) : results.length > 0 ? (
        <PopularTrackTable tracks={results} context={artistName} />
      ) : (
        <p className="text-sm text-muted px-1">
          Keine Songs für &bdquo;{query}&ldquo; gefunden.
        </p>
      )}
    </section>
  );
}
