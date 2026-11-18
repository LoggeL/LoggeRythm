import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SearchIssueOwner } from '../components/search/SearchFeedback';
import { musicQueries } from '../data';
import type { AppLocale } from '../localization';
import { withoutLibraryTracks } from './searchLibraryModel';
import {
  resultLimit,
  sortSearchTracks,
  wantedSearchEntities,
  type SearchEntity,
  type SearchSort,
  type SearchTab,
} from './searchModel';
import {
  resolveSearchAggregateRemoteState,
  searchRemoteEntry,
  type SearchRemoteQueryLike,
} from './searchRemoteState';

interface SearchResultsInput {
  /** The published (debounced) query identity. */
  query: string;
  /** The input still equals `query`; nothing is fetched or shown otherwise. */
  ready: boolean;
  tab: SearchTab;
  sort: SearchSort;
  locale: AppLocale;
  /** Tracks the library section already shows; never repeated in the track list. */
  libraryTrackIds: ReadonlySet<string>;
}

interface OwnedQuery<Key extends string> {
  key: Key;
  query: SearchRemoteQueryLike;
  itemCount: number;
  retry: () => void;
}

function limited<T>(items: readonly T[], tab: SearchTab, entity: SearchEntity): readonly T[] {
  return items.slice(0, resultLimit(tab, entity) ?? items.length);
}

/**
 * Every server read behind a result page: the four entity searches of the
 * active tab plus the optional track details. TanStack Query stays the only
 * owner of server state; this hook only derives what the screen shows.
 */
export function useSearchResults({
  query,
  ready,
  tab,
  sort,
  locale,
  libraryTrackIds,
}: SearchResultsInput) {
  const wanted = wantedSearchEntities(tab);

  const tracksQuery = useQuery({
    ...musicQueries.searchTracks(query),
    enabled: ready && wanted.track,
  });
  const albumsQuery = useQuery({
    ...musicQueries.searchAlbums(query),
    enabled: ready && wanted.album,
  });
  const artistsQuery = useQuery({
    ...musicQueries.searchArtists(query),
    enabled: ready && wanted.artist,
  });
  const playlistsQuery = useQuery({
    ...musicQueries.searchPlaylists(query),
    enabled: ready && wanted.playlist,
  });

  /** Every found track in display order, library tracks included. */
  const foundTracks = useMemo(
    () => sortSearchTracks(tracksQuery.data ?? [], sort, locale),
    [locale, sort, tracksQuery.data],
  );
  /**
   * The track list below the library section and its playback queue: row
   * positions, `play(index)` and occurrence indices all refer to this list.
   */
  const tracks = useMemo(
    () => withoutLibraryTracks(foundTracks, libraryTrackIds),
    [foundTracks, libraryTrackIds],
  );
  const shownTracks = useMemo(() => limited(tracks, tab, 'track'), [tab, tracks]);
  const albums = albumsQuery.data ?? [];
  const artists = artistsQuery.data ?? [];
  const playlists = playlistsQuery.data ?? [];

  const trackPlayRequest = useMemo(
    () => shownTracks.map(({ id, artist, title }) => ({ id, artist, title })),
    [shownTracks],
  );
  const metadataEnabled = ready && wanted.track && trackPlayRequest.length > 0;
  const trackPlaysQuery = useQuery({
    ...musicQueries.trackPlayCounts(trackPlayRequest),
    enabled: metadataEnabled,
  });
  const cachedTracksQuery = useQuery({
    ...musicQueries.cachedTrackIds(),
    enabled: metadataEnabled,
  });

  const entityQueries: OwnedQuery<SearchEntity>[] = [
    ...(wanted.track ? [{
      key: 'track' as const,
      query: tracksQuery,
      // A search that found only library tracks is not an empty search.
      itemCount: foundTracks.length,
      retry: () => { void tracksQuery.refetch(); },
    }] : []),
    ...(wanted.album ? [{
      key: 'album' as const,
      query: albumsQuery,
      itemCount: albums.length,
      retry: () => { void albumsQuery.refetch(); },
    }] : []),
    ...(wanted.artist ? [{
      key: 'artist' as const,
      query: artistsQuery,
      itemCount: artists.length,
      retry: () => { void artistsQuery.refetch(); },
    }] : []),
    ...(wanted.playlist ? [{
      key: 'playlist' as const,
      query: playlistsQuery,
      itemCount: playlists.length,
      retry: () => { void playlistsQuery.refetch(); },
    }] : []),
  ];
  const state = resolveSearchAggregateRemoteState(
    entityQueries.map(({ key, query: owned, itemCount }) =>
      searchRemoteEntry(key, owned, itemCount)),
  );
  const owners: SearchIssueOwner[] = entityQueries.map(({ key, query: owned, retry }) => ({
    key,
    fetching: owned.fetchStatus === 'fetching',
    retry,
  }));

  const metadataQueries: OwnedQuery<string>[] = metadataEnabled ? [
    {
      key: 'track-plays',
      query: trackPlaysQuery,
      itemCount: 0,
      retry: () => { void trackPlaysQuery.refetch(); },
    },
    {
      key: 'cache-membership',
      query: cachedTracksQuery,
      itemCount: 0,
      retry: () => { void cachedTracksQuery.refetch(); },
    },
  ] : [];
  const metadataState = metadataQueries.length > 0
    ? resolveSearchAggregateRemoteState(
      metadataQueries.map(({ key, query: owned, itemCount }) =>
        searchRemoteEntry(key, owned, itemCount)),
    )
    : null;
  const failedMetadata = metadataQueries.filter(({ key }) =>
    metadataState?.issues.some((issue) => issue.key === key) === true);

  return {
    wanted,
    foundTracks,
    tracks,
    shownTracks,
    shownAlbums: limited(albums, tab, 'album'),
    shownArtists: limited(artists, tab, 'artist'),
    shownPlaylists: limited(playlists, tab, 'playlist'),
    trackPlays: trackPlaysQuery.data,
    state,
    owners,
    metadata: {
      state: metadataState,
      retryBusy: failedMetadata.some(({ query: owned }) => owned.fetchStatus === 'fetching'),
      retry: () => {
        for (const failed of failedMetadata) failed.retry();
      },
    },
  };
}
