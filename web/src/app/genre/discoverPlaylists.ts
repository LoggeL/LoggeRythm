import type { PlaylistSummary } from "@/types";

/** One card of the Discover playlists row. */
export interface DiscoverPlaylist {
  playlist: PlaylistSummary;
  /** The signed-in user owns it, so the card says "Von dir" instead of naming an owner. */
  own: boolean;
}

/** The slice of a TanStack query the playlists row reads from each of its two sources. */
export interface PlaylistsSource<T = PlaylistSummary[]> {
  data: T | undefined;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

function assertUniqueIds(playlists: readonly PlaylistSummary[], source: string): void {
  const seen = new Set<string>();
  for (const playlist of playlists) {
    const id = String(playlist.id);
    if (seen.has(id)) throw new Error(`${source} enthalten die Playlist ${id} mehrfach.`);
    seen.add(id);
  }
}

/**
 * The Discover playlists row: the user's library playlists (owned and
 * collaborated) first, then the community's public ones. A playlist both lists
 * carry appears once, preserving whether the user owns it (`own: true`) or
 * collaborates on someone else's (`own: false`).
 */
export function mergeDiscoverPlaylists(own: readonly PlaylistSummary[], community: readonly PlaylistSummary[]): DiscoverPlaylist[] {
  assertUniqueIds(own, "Eigene Playlists");
  assertUniqueIds(community, "Community-Playlists");
  const libraryIds = new Set(own.map((playlist) => String(playlist.id)));
  return [
    ...own.map((playlist) => ({
      playlist,
      own: typeof playlist.is_owner === "boolean" ? playlist.is_owner : !playlist.is_collaborator,
    })),
    ...community.filter((playlist) => !libraryIds.has(String(playlist.id))).map((playlist) => ({ playlist, own: false })),
  ];
}

/**
 * One query state for the row's two sources. The row only has data once both
 * lists have loaded, and a failure of either one is the row's failure, so a
 * partial row is never shown as if it were complete.
 */
export function discoverPlaylistsQuery(own: PlaylistsSource, community: PlaylistsSource): PlaylistsSource<DiscoverPlaylist[]> {
  const sources = [
    { label: "Eigene Playlists", query: own },
    { label: "Community-Playlists", query: community },
  ];
  const failed = sources.filter(({ query }) => query.isError);
  for (const { label, query } of failed) {
    if (!query.error) throw new Error(`${label} melden einen Fehler ohne Ursache.`);
  }
  return {
    data: own.data === undefined || community.data === undefined ? undefined : mergeDiscoverPlaylists(own.data, community.data),
    error:
      failed.length === 0
        ? null
        : failed.length === 1
          ? failed[0].query.error
          : new Error(failed.map(({ label, query }) => `${label}: ${query.error?.message}`).join(" · ")),
    isError: failed.length > 0,
    isLoading: own.isLoading || community.isLoading,
    isFetching: own.isFetching || community.isFetching,
    refetch: () => Promise.all((failed.length > 0 ? failed : sources).map(({ query }) => query.refetch())),
  };
}
