import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_STALE_TIME = 5 * 60_000;

/** Trim outer whitespace only; preserves case and internal spaces (e.g. quoted phrases). */
export function normalizeCatalogQuery(query: string): string {
  return query.trim();
}

type SearchEntity = "track" | "album" | "artist" | "playlist";

/**
 * Route search, quick search, artist search, playlist quick-add and party
 * search share one in-flight request and one cached result per entity/term.
 */
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
