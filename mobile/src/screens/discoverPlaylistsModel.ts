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
  const libraryIds = new Set(own.map((playlist) => playlist.id));
  return [
    ...own.map((playlist) => ({ playlist, own: playlist.is_owner })),
    ...community
      .filter((playlist) => !libraryIds.has(playlist.id))
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

export interface DiscoverPlaylistSourceQuery extends Omit<CatalogQueryVisualState, 'hasData'> {
  data: readonly PlaylistSummary[] | undefined;
}

export interface DiscoverPlaylistsSectionModel {
  entries: DiscoverPlaylistEntry[];
  state: CatalogQueryVisualState;
  empty: boolean;
}

/**
 * Decouples the user's own playlists from community playlists on Discover so
 * whichever list resolves first with items renders immediately instead of
 * waiting on the slower query, while keeping failures/offline states loud:
 * - If both lists have loaded: renders the full merged list (or empty).
 * - If only one list has loaded with items: renders those items right away;
 *   the other query's loading/offline/error state surfaces as a non-blocking
 *   refresh indicator or retryable notice (never silently swallowed).
 * - If one list loaded empty while the other is pending/offline/failed:
 *   keeps `hasData: false` so Discover never flashes a false empty state.
 */
export function resolveDiscoverPlaylistsSection(
  own: DiscoverPlaylistSourceQuery,
  community: DiscoverPlaylistSourceQuery,
): DiscoverPlaylistsSectionModel {
  const bothLoaded = own.data !== undefined && community.data !== undefined;
  const entries =
    own.data !== undefined || community.data !== undefined
      ? mergeDiscoverPlaylists(own.data ?? [], community.data ?? [])
      : [];
  const hasVisibleEntries = entries.length > 0;
  const states: CatalogQueryVisualState[] = [
    {
      hasData: own.data !== undefined,
      isPending: own.isPending,
      isFetching: own.isFetching,
      isStale: own.isStale,
      fetchStatus: own.fetchStatus,
      error: own.error,
    },
    {
      hasData: community.data !== undefined,
      isPending: community.isPending,
      isFetching: community.isFetching,
      isStale: community.isStale,
      fetchStatus: community.fetchStatus,
      error: community.error,
    },
  ];
  const combined = combineCatalogQueryStates(states);
  const progressiveHasData = bothLoaded || hasVisibleEntries;
  return {
    entries,
    empty: bothLoaded && entries.length === 0,
    state: {
      ...combined,
      hasData: progressiveHasData,
      isPending: !progressiveHasData && combined.isPending,
    },
  };
}
