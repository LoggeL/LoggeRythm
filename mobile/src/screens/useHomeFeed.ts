import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HomeSectionState } from '../components/home/HomeSection';
import type { RemoteFetchStatus } from '../data/remoteState';
import { musicQueries } from '../data';

/** The slice of a query result a Home section needs. */
export interface HomeFeedQuery<T> {
  data: T | undefined;
  isPending: boolean;
  isFetching: boolean;
  fetchStatus: RemoteFetchStatus;
  isStale: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

export interface HomeFeedSection<T> {
  data: T | undefined;
  /** Spread into `<HomeSection>`. */
  state: HomeSectionState;
}

/** Maps a query to the HomeSection contract. The error passes through untouched. */
export function homeFeedSection<T>(query: HomeFeedQuery<T>): HomeFeedSection<T> {
  return {
    data: query.data,
    state: {
      hasData: query.data !== undefined,
      pending: query.isPending,
      fetching: query.isFetching,
      fetchStatus: query.fetchStatus,
      stale: query.isStale,
      error: query.error,
      onRetry: () => void query.refetch(),
    },
  };
}

/**
 * Every remote source of the Home feed. `moodTag === null` is the "Top"
 * discovery view (nine sections); any other tag loads only that mood rail.
 * The inactive side stays disabled, so switching moods never fetches the
 * whole feed and pull-to-refresh only refetches what is on screen.
 */
export function useHomeFeed(scope: string, moodTag: string | null) {
  const top = moodTag === null;
  // The spinner belongs to a pull the user made. Background refetches (the
  // stats are invalidated after every recorded play) must not drop it into
  // the page on their own; each section reports its own refresh state.
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const stats = useQuery({ ...musicQueries.stats(scope), enabled: top });
  const mixes = useQuery({ ...musicQueries.homeMixes(scope), enabled: top });
  const radar = useQuery({ ...musicQueries.releaseRadar(scope), enabled: top });
  const because = useQuery({ ...musicQueries.becauseYouListened(scope), enabled: top });
  const collections = useQuery({ ...musicQueries.homeChartCollections(), enabled: top });
  const charts = useQuery({ ...musicQueries.charts(), enabled: top });
  const releases = useQuery({ ...musicQueries.newReleases(), enabled: top });
  const publicPlaylists = useQuery({ ...musicQueries.publicPlaylists(scope), enabled: top });
  const genres = useQuery({ ...musicQueries.genres(), enabled: top });
  const mood = useQuery({ ...musicQueries.mood(moodTag ?? 'inactive'), enabled: !top });

  const active = top
    ? [stats, mixes, radar, because, collections, charts, releases, publicPlaylists, genres]
    : [mood];

  return {
    stats: homeFeedSection(stats),
    mixes: homeFeedSection(mixes),
    radar: homeFeedSection(radar),
    because: homeFeedSection(because),
    collections: homeFeedSection(collections),
    charts: homeFeedSection(charts),
    releases: homeFeedSection(releases),
    publicPlaylists: homeFeedSection(publicPlaylists),
    genres: homeFeedSection(genres),
    mood: homeFeedSection(mood),
    refreshing: manualRefreshing,
    refresh: () => {
      setManualRefreshing(true);
      void Promise.allSettled(active.map((query) => query.refetch())).finally(() => {
        setManualRefreshing(false);
      });
    },
  };
}
