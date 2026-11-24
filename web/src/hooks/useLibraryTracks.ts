"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useQueryClient, type QueryCache } from "@tanstack/react-query";
import { useLikes } from "@/hooks/useLibrary";
import { indexLibraryTracks } from "@/lib/libraryMatch";
import type { Playlist } from "@/types";

const NO_PLAYLISTS: Playlist[] = [];

/**
 * The user's own and collaborated playlists whose details are in the query
 * cache right now. Reads the cache only: it never requests an unloaded playlist.
 */
export function cachedOwnPlaylists(cache: QueryCache): Playlist[] {
  const own: Playlist[] = [];
  for (const query of cache.findAll({ queryKey: ["playlist"] })) {
    const playlist = query.state.data as Playlist | undefined;
    if (playlist?.is_owner || playlist?.is_collaborator) own.push(playlist);
  }
  return own;
}

/**
 * `cachedOwnPlaylists` as an external store for React. The snapshot keeps its
 * identity until one of those playlists is loaded, updated or dropped.
 */
export function ownPlaylistStore(cache: QueryCache) {
  let snapshot = NO_PLAYLISTS;
  return {
    subscribe: (onChange: () => void) => cache.subscribe(onChange),
    read: () => {
      const next = cachedOwnPlaylists(cache);
      if (next.length !== snapshot.length || next.some((playlist, position) => playlist !== snapshot[position])) snapshot = next;
      return snapshot;
    },
  };
}

const serverPlaylists = () => NO_PLAYLISTS;

function useCachedOwnPlaylists(): Playlist[] {
  const cache = useQueryClient().getQueryCache();
  const store = useMemo(() => ownPlaylistStore(cache), [cache]);
  return useSyncExternalStore(store.subscribe, store.read, serverPlaylists);
}

/**
 * Search index over the songs this client already knows the user saved: the
 * liked songs first, then the tracks of their own cached playlists. `likes`
 * is the underlying query, so a caller can report why liked songs are missing.
 */
export function useLibraryTracks() {
  const likes = useLikes();
  const playlists = useCachedOwnPlaylists();
  const liked = likes.data;
  const index = useMemo(
    () => indexLibraryTracks([...(liked ?? []), ...playlists.flatMap((playlist) => playlist.tracks)]),
    [liked, playlists],
  );
  return { index, likes };
}
