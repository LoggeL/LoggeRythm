import { useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Track } from '../api/types';
import { createCachedPlaylistDetailsStore, musicQueries } from '../data';
import { useOfflineDownloads } from '../offline/hooks';
import { accountOfflineDownloadedTracks } from './offlineScreenModel';
import {
  collectSearchLibraryTracks,
  createSearchLibraryIndex,
  matchSearchLibrary,
  searchLibraryLimit,
} from './searchLibraryModel';
import type { SearchTab } from './searchModel';
import { searchRemoteIssueKind, type SearchRemoteIssueKind } from './searchRemoteState';

const NO_LIKES: readonly Track[] = [];

interface SearchLibraryInput {
  accountScope: string;
  /** The text currently in the search field, not the debounced query. */
  input: string;
  tab: SearchTab;
}

/** The liked songs are missing from, or possibly outdated in, the instant matches. */
export interface SearchLibraryLikesIssue {
  kind: SearchRemoteIssueKind;
  retryBusy: boolean;
  retry: () => void;
}

export interface SearchLibraryMatches {
  /** Every saved track matching the input, best first: the section's queue. */
  matches: Track[];
  /** The leading matches the active tab shows. */
  shown: readonly Track[];
  /** Ids of `shown`; remote results must not repeat them. */
  shownIds: ReadonlySet<string>;
  /**
   * Set while the likes query is failed or offline in a tab that shows the
   * section; null while it is healthy or still loading for the first time.
   */
  likesIssue: SearchLibraryLikesIssue | null;
}

/**
 * Saved tracks matching the current input, from data that is already on the
 * device: the likes query the app keeps loaded anyway, playlist details that
 * happen to be cached, and the offline download manifest. Matching is
 * synchronous and never waits for (or starts) a search request. Playlists
 * that are not cached contribute nothing by design; a likes query that failed
 * is reported as `likesIssue`, because the app does expect that list here.
 */
export function useSearchLibrary({
  accountScope,
  input,
  tab,
}: SearchLibraryInput): SearchLibraryMatches {
  const queryClient = useQueryClient();
  const likesQuery = useQuery(musicQueries.likes(accountScope));
  const likes = likesQuery.data ?? NO_LIKES;
  const playlistStore = useMemo(
    () => createCachedPlaylistDetailsStore(queryClient, accountScope),
    [accountScope, queryClient],
  );
  const playlists = useSyncExternalStore(
    playlistStore.subscribe,
    playlistStore.getSnapshot,
    playlistStore.getSnapshot,
  );
  // Download progress republishes the snapshot; only these fields change the library.
  const { hydrated, scope, manifest, downloadedTrackIds } = useOfflineDownloads();
  const downloads = useMemo(
    () => accountOfflineDownloadedTracks(
      { hydrated, scope, manifest, downloadedTrackIds },
      accountScope,
    ),
    [accountScope, downloadedTrackIds, hydrated, manifest, scope],
  );

  const index = useMemo(
    () => createSearchLibraryIndex(collectSearchLibraryTracks({ likes, playlists, downloads })),
    [downloads, likes, playlists],
  );
  const matches = useMemo(() => matchSearchLibrary(index, input), [index, input]);
  const limit = searchLibraryLimit(tab);
  const shownMatches = useMemo(() => {
    const shown = matches.slice(0, limit);
    return { matches, shown, shownIds: new Set(shown.map(({ id }) => id)) };
  }, [limit, matches]);

  const likesIssueKind = limit > 0 ? searchRemoteIssueKind(likesQuery) : null;
  return {
    ...shownMatches,
    likesIssue: likesIssueKind === null
      ? null
      : {
        kind: likesIssueKind,
        retryBusy: likesQuery.fetchStatus === 'fetching',
        retry: () => { void likesQuery.refetch(); },
      },
  };
}
