import type { PlaylistSummary } from '../api/types';
import type { CatalogQueryVisualState } from '../components/catalog/catalogQueryState';

/** One card of the Discover playlists row. */
export interface DiscoverPlaylistEntry {
  playlist: PlaylistSummary;
  /** The signed-in user owns it, so the card says so instead of naming an owner. */
  own: boolean;
}

function assertUniquePlaylistIds(playlists: readonly PlaylistSummary[], source: string): void {
  const seen = new Set<number>();
  for (const playlist of playlists) {
    if (seen.has(playlist.id)) {
      throw new Error(`${source} playlists list playlist ${playlist.id} more than once`);
    }
    seen.add(playlist.id);
  }
}

/**
 * The Discover playlists row: every playlist of the user (private ones
 * included) in the library's order, then the community's public ones. A
 * playlist both lists carry is the user's own and appears once, as own.
 */
export function mergeDiscoverPlaylists(
  own: readonly PlaylistSummary[],
  community: readonly PlaylistSummary[],
): DiscoverPlaylistEntry[] {
  assertUniquePlaylistIds(own, 'Own');
  assertUniquePlaylistIds(community, 'Community');
  const ownIds = new Set(own.map((playlist) => playlist.id));
  return [
    ...own.map((playlist) => ({ playlist, own: true })),
    ...community
      .filter((playlist) => !ownIds.has(playlist.id))
      .map((playlist) => ({ playlist, own: false })),
  ];
}

/**
 * One remote state for a section that needs several queries at once. The
 * section only has data when every query has; a failure or an offline pause
 * of any query is the section's, so a partial row is never shown as complete.
 */
export function combineCatalogQueryStates(
  states: readonly CatalogQueryVisualState[],
): CatalogQueryVisualState {
  if (states.length === 0) throw new Error('A combined catalog state needs at least one query');
  const failed = states.find((state) => state.error !== null && state.error !== undefined);
  return {
    hasData: states.every((state) => state.hasData),
    isPending: states.some((state) => state.isPending),
    isFetching: states.some((state) => state.isFetching),
    isStale: states.some((state) => state.isStale),
    fetchStatus: states.some((state) => state.fetchStatus === 'fetching')
      ? 'fetching'
      : states.some((state) => state.fetchStatus === 'paused')
        ? 'paused'
        : 'idle',
    error: failed === undefined ? null : failed.error,
  };
}
