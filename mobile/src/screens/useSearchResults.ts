import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ArtistSummary, PlaylistSearchResult, Track } from '../api/types';
import type { SearchIssueOwner } from '../components/search/SearchFeedback';
import { musicQueries } from '../data';
import type { AlbumCard } from '../domain/catalog';
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

const EMPTY_TRACKS: readonly Track[] = [];
const EMPTY_ALBUMS: readonly AlbumCard[] = [];
const EMPTY_ARTISTS: readonly ArtistSummary[] = [];
const EMPTY_PLAYLISTS: readonly PlaylistSearchResult[] = [];

interface SearchResultsInput {
  /** Server-origin + account cache boundary for remote search queries. */
  accountScope: string;
  /** The published (debounced) query identity. */
  query: string;
  /** The input still equals `query`; nothing is fetched otherwise. */
  ready: boolean;
  tab: SearchTab;
  sort: SearchSort;
  locale: AppLocale;
  /** Tracks the library section already shows; never repeated in the track list. */
  libraryTrackIds: ReadonlySet<string>;
  /** Full library tracks shown above; enables ISRC/recording dedupe across releases. */
  libraryTracks?: readonly Track[];
}

interface OwnedQuery<Key extends string> {
  key: Key;
  query: SearchRemoteQueryLike;
  itemCount: number;
  retry: () => void;
}

function limited<T>(items: readonly T[], tab: SearchTab, entity: SearchEntity): readonly T[] {
  const limit = resultLimit(tab, entity);
  if (limit === undefined || items.length <= limit) return items;
  return items.slice(0, limit);
}

/**
 * Every server read behind a result page: the four entity searches of the
 * active tab plus the optional track details. TanStack Query stays the only
 * owner of server state; this hook only derives what the screen shows.
 */
export function useSearchResults({
  accountScope,
  query,
  ready,
  tab,
  sort,
  locale,
  libraryTrackIds,
  libraryTracks,
}: SearchResultsInput) {
  const wanted = useMemo(() => wantedSearchEntities(tab), [tab]);

  const tracksQuery = useQuery({
    ...musicQueries.searchTracks(accountScope, query),
    enabled: ready && wanted.track,
  });
  const albumsQuery = useQuery({
    ...musicQueries.searchAlbums(accountScope, query),
    enabled: ready && wanted.album,
  });
  const artistsQuery = useQuery({
    ...musicQueries.searchArtists(accountScope, query),
    enabled: ready && wanted.artist,
  });
  const playlistsQuery = useQuery({
    ...musicQueries.searchPlaylists(accountScope, query),
    enabled: ready && wanted.playlist,
  });

  /** Every found track in display order, library tracks included. */
  const foundTracks = useMemo(
    () => sortSearchTracks(tracksQuery.data ?? EMPTY_TRACKS, sort, locale),
    [locale, sort, tracksQuery.data],
  );
  /**
   * The track list below the library section and its playback queue: row
   * positions, `play(index)` and occurrence indices all refer to this list.
   */
  const tracks = useMemo(
    () => withoutLibraryTracks(foundTracks, libraryTrackIds, libraryTracks),
    [foundTracks, libraryTrackIds, libraryTracks],
  );
  const shownTracks = useMemo(() => limited(tracks, tab, 'track'), [tab, tracks]);
  const albums = albumsQuery.data ?? EMPTY_ALBUMS;
  const artists = artistsQuery.data ?? EMPTY_ARTISTS;
  const playlists = playlistsQuery.data ?? EMPTY_PLAYLISTS;
  const shownAlbums = useMemo(() => limited(albums, tab, 'album'), [albums, tab]);
  const shownArtists = useMemo(() => limited(artists, tab, 'artist'), [artists, tab]);
  const shownPlaylists = useMemo(() => limited(playlists, tab, 'playlist'), [playlists, tab]);

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
    shownAlbums,
    shownArtists,
    shownPlaylists,
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
