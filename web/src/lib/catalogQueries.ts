import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_STALE_TIME = 60_000;

export function normalizeCatalogQuery(query: string): string {
  return query.trim();
}

type SearchEntity = "track" | "album" | "artist" | "playlist";

/** Route search and quick search share one request and one cached result. */
export function catalogSearchKey(entity: SearchEntity, query: string) {
  return ["search", entity, normalizeCatalogQuery(query)] as const;
}

const searchPolicy = {
  staleTime: SEARCH_STALE_TIME,
  retry: false,
} as const;

export function searchTracksOptions(query: string) {
  const term = normalizeCatalogQuery(query);
  return queryOptions({
    ...searchPolicy,
    queryKey: catalogSearchKey("track", term),
    queryFn: ({ signal }) => api.search(term, "track", signal),
  });
}

export function searchAlbumsOptions(query: string) {
  const term = normalizeCatalogQuery(query);
  return queryOptions({
    ...searchPolicy,
    queryKey: catalogSearchKey("album", term),
    queryFn: ({ signal }) => api.search(term, "album", signal),
  });
}

export function searchArtistsOptions(query: string) {
  const term = normalizeCatalogQuery(query);
  return queryOptions({
    ...searchPolicy,
    queryKey: catalogSearchKey("artist", term),
    queryFn: ({ signal }) => api.searchArtists(term, signal),
  });
}

export function searchPlaylistsOptions(query: string) {
  const term = normalizeCatalogQuery(query);
  return queryOptions({
    ...searchPolicy,
    queryKey: catalogSearchKey("playlist", term),
    queryFn: ({ signal }) => api.searchPlaylists(term, signal),
  });
}
