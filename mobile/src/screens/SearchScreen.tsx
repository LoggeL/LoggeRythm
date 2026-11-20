import React, { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Track } from '../api/types';
import { useProgress } from '../player/player';
import { ActionButton, EmptyState, ScreenHeader, SectionHeader, TrackRowSkeleton } from '../components/ui';
import { SearchBar } from '../components/search/SearchBar';
import {
  SearchLibraryLikesNotice,
  SearchMetadataFeedback,
  SearchResultsFeedback,
  showsPrimaryStaleNotice,
} from '../components/search/SearchFeedback';
import { SearchSortControls, SearchTabs } from '../components/search/SearchFilters';
import { SearchGenreBrowse } from '../components/search/SearchGenreBrowse';
import { SearchImportMode } from '../components/search/SearchImportMode';
import { SearchErrorNotice, SearchLoadingStatus } from '../components/search/SearchRemoteStates';
import {
  SearchAlbumSection,
  SearchArtistSection,
  SearchPlaylistSection,
} from '../components/search/SearchResultSections';
import {
  SearchTrackResultRow,
  searchTrackRadioOccurrence,
} from '../components/search/SearchResults';
import { SearchTopResultCard } from '../components/search/SearchTopResult';
import { SearchVirtualizedResults } from '../components/search/SearchVirtualizedResults';
import { SpotifyImportToggle } from '../components/search/SpotifyImportToggle';
import {
  createSearchListRows,
  type SearchListRow,
} from '../components/search/searchListModel';
import { showTrackActions } from '../components/trackActions';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries, queryKeys } from '../data';
import { resolveRemoteVisualState } from '../data/remoteState';
import { useAuth } from '../auth/AuthContext';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { useLocaleRevision } from '../localization/LocaleProvider';
import { playTrackWithRadio, playTracks, TrackRadioError } from '../player/controller';
import {
  dismissSpotifyImportRequest,
  getSpotifyImportRequestForScope,
  subscribeSpotifyImportRequests,
} from '../share/spotifyImport';
import { colors, layout, spacing } from '../theme';
import type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';
import {
  assertSearchRouteCallbacks,
  isCurrentSearchQuery,
  isSearchableQuery,
  normalizeSearchInput,
  orderedPlaylistTrackIds,
  pickSearchTopResult,
  scheduleSearchDebounce,
  searchInputReducer,
  type SearchRouteCallbacks,
  type SearchSort,
  type SearchTab,
  type SearchTopResult,
} from './searchModel';
import { useSearchLibrary } from './useSearchLibrary';
import { useSearchResults } from './useSearchResults';

export type SearchScreenProps = SearchRouteCallbacks;
export type {
  SearchAlbumRouteParams,
  SearchArtistRouteParams,
  SearchGenreRouteParams,
} from './searchModel';

export default function SearchScreen(props: Partial<SearchScreenProps>) {
  assertSearchRouteCallbacks(props);
  const locale = useLocaleRevision();
  const { onOpenAlbum, onOpenArtist, onOpenGenre } = props;
  const { user } = useAuth();
  if (user === null) throw new Error('SearchScreen requires an authenticated user');

  const queryClient = useQueryClient();
  const activeProgress = useProgress(1);
  const bottomInset = useBottomInset();
  const accountScope = musicCacheScope(getCurrentApiBase(), user.id);
  const [{ input, publishedQuery: debouncedQuery }, dispatchSearchInput] = useReducer(
    searchInputReducer,
    { input: '', publishedQuery: '' },
  );
  const [tab, setTab] = useState<SearchTab>('all');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingPlaylist, setStartingPlaylist] = useState<string | null>(null);
  const [manualImporting, setManualImporting] = useState(false);
  const getScopedImportRequest = () => getSpotifyImportRequestForScope(accountScope);
  const sharedImportRequest = useSyncExternalStore(
    subscribeSpotifyImportRequests,
    getScopedImportRequest,
    getScopedImportRequest,
  );
  const importing = manualImporting || sharedImportRequest !== null;

  const normalizedInput = normalizeSearchInput(input);
  const inputIsSearchable = isSearchableQuery(normalizedInput);
  const ready = isCurrentSearchQuery(normalizedInput, debouncedQuery);
  const browsing = normalizedInput.length === 0;

  useEffect(() => {
    if (ready) return;
    return scheduleSearchDebounce(normalizedInput, (query) => {
      dispatchSearchInput({ type: 'publish', query });
    });
  }, [normalizedInput, ready]);

  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: queryKeys.search.root() });
    },
    [queryClient],
  );

  // Saved tracks match the text in the field on every keystroke, without a request.
  const library = useSearchLibrary({ accountScope, input: normalizedInput, tab });
  const results = useSearchResults({
    query: debouncedQuery,
    ready,
    tab,
    sort,
    locale,
    libraryTrackIds: library.shownIds,
  });
  const { wanted, tracks, state: searchState } = results;
  const genresQuery = useQuery({ ...musicQueries.genres(), enabled: browsing });
  const genresState = resolveRemoteVisualState({
    hasData: genresQuery.data !== undefined,
    empty: genresQuery.data !== undefined && genresQuery.data.length === 0,
    pending: genresQuery.isPending,
    fetching: genresQuery.isFetching,
    stale: genresQuery.isStale,
    fetchStatus: genresQuery.fetchStatus,
    error: genresQuery.error,
  });

  const openTrackAlbum = (params: AlbumRouteParams) => onOpenAlbum({
    albumId: params.albumId,
    title: params.title ?? strings.navigation.album,
  });
  const openTrackArtist = (params: ArtistRouteParams) => onOpenArtist({
    artistId: params.artistId,
    name: params.name ?? strings.navigation.artist,
  });

  const updateInput = (value: string) => {
    dispatchSearchInput({ type: 'edit', value });
    setActionError(null);
    if (normalizeSearchInput(value) !== normalizedInput) {
      void queryClient.cancelQueries({ queryKey: queryKeys.search.root() });
    }
  };

  const toggleImport = () => {
    if (importing) {
      setManualImporting(false);
      dismissSpotifyImportRequest(sharedImportRequest?.id);
    } else {
      setManualImporting(true);
    }
  };

  // A tapped track plays on its own and continues with its track radio; the
  // other results never become the queue. Library matches behave the same:
  // they are rows of the same result list, so a different tap semantic per
  // section would be surprising.
  const playWithRadio = (track: Track) => {
    Keyboard.dismiss();
    setActionError(null);
    void playTrackWithRadio(track).catch((error: unknown) => {
      console.error('Search track playback failed', error);
      setActionError(
        error instanceof TrackRadioError ? strings.search.radioFailed : strings.search.playFailed,
      );
    });
  };

  const play = (index: number) => {
    if (index < 0 || index >= tracks.length) {
      throw new Error(`Search playback index ${index} is outside ${tracks.length} tracks`);
    }
    playWithRadio(tracks[index]);
  };

  const playLibrary = (index: number) => {
    if (index < 0 || index >= library.matches.length) {
      throw new Error(
        `Library search playback index ${index} is outside ${library.matches.length} tracks`,
      );
    }
    playWithRadio(library.matches[index]);
  };

  const startDeezerPlaylist = async (playlistId: string) => {
    setStartingPlaylist(playlistId);
    setActionError(null);
    try {
      const playlist = await queryClient.fetchQuery(musicQueries.deezerPlaylist(playlistId));
      if (playlist.tracks.length === 0) throw new Error(strings.search.noResults);
      const fullTracks = await Promise.all(
        orderedPlaylistTrackIds(playlist.tracks).map((id) =>
          queryClient.fetchQuery(musicQueries.track(id)),
        ),
      );
      await playTracks(fullTracks, 0, {
        context: {
          type: 'collection',
          id: `deezer-playlist:${playlistId}`,
          label: playlist.name,
        },
      });
    } catch {
      setActionError(strings.search.playlistLoadFailed);
    } finally {
      setStartingPlaylist(null);
    }
  };

  const openTopResult = (result: SearchTopResult) => {
    switch (result.kind) {
      case 'artist':
        return onOpenArtist({ artistId: result.artist.id, name: result.artist.name });
      case 'album':
        return onOpenAlbum({ albumId: result.album.id, title: result.album.title });
      case 'track':
        return play(result.index);
    }
  };

  const searchChrome = (
    <View style={styles.chrome}>
      <ScreenHeader title={strings.navigation.search} style={styles.gutter} />
      {!importing ? (
        <SearchBar
          value={input}
          onChangeText={updateInput}
          onSubmit={() => {
            dispatchSearchInput({ type: 'submit' });
            Keyboard.dismiss();
          }}
        />
      ) : null}
      <SpotifyImportToggle expanded={importing} onToggle={toggleImport} />
      {!importing && inputIsSearchable ? <SearchTabs tab={tab} onSelect={setTab} /> : null}
      {!importing && inputIsSearchable && wanted.track ? (
        <SearchSortControls sort={sort} onSelect={setSort} />
      ) : null}
      {!importing && actionError !== null ? (
        <SearchErrorNotice testID="search-action-error" message={actionError} />
      ) : null}
    </View>
  );

  const browseBody = browsing ? (
    <SearchGenreBrowse
      testID="search-genre-browse"
      id="search-genres"
      genres={genresQuery.data ?? []}
      genresState={genresState}
      retryBusy={genresQuery.fetchStatus === 'fetching'}
      onRetry={() => { void genresQuery.refetch(); }}
      onOpenGenre={onOpenGenre}
    />
  ) : !inputIsSearchable ? (
    <EmptyState
      testID="search-minimum-hint"
      icon="text-search"
      title={strings.search.minimumQueryHint}
    />
  ) : null;

  // Progress, failures and the empty state of the remote search. Rendered as
  // the list row below the library section, so that section never moves.
  const remoteStatus = !ready ? (
    <TrackRowSkeleton
      testID="search-debounce-status"
      accessibilityLabel={strings.search.preparing}
      style={styles.bodyGap}
    />
  ) : (
    <View style={styles.bodyGap}>
      <SearchResultsFeedback
        state={searchState}
        owners={results.owners}
        renderLoading={({ testID, accessibilityLabel }) =>
          searchState.body === 'loading' ? (
            <TrackRowSkeleton testID={testID} accessibilityLabel={accessibilityLabel} />
          ) : (
            <SearchLoadingStatus testID={testID} label={accessibilityLabel} />
          )}
      />
      {searchState.body === 'empty' && library.shown.length === 0 ? (
        <EmptyState
          testID="search-results-empty"
          icon="magnify-close"
          title={strings.search.noResultsFor(debouncedQuery)}
          message={strings.search.noResultsHint}
          action={(
            <ActionButton
              testID="search-results-empty-clear"
              variant="secondary"
              icon="close"
              label={strings.search.clear}
              onPress={() => updateInput('')}
            />
          )}
        />
      ) : null}
      {searchState.body === 'content' ? (
        <View testID="search-results">
          <SearchMetadataFeedback
            state={results.metadata.state}
            retryBusy={results.metadata.retryBusy}
            onRetry={results.metadata.retry}
            primaryStale={showsPrimaryStaleNotice(searchState)}
          />
        </View>
      ) : null}
    </View>
  );

  const showRemoteRows = ready && searchState.body === 'content';
  const searchRows = inputIsSearchable
    ? createSearchListRows({
      libraryTracks: library.shown,
      libraryNotice: library.likesIssue !== null,
      remoteStatus: true,
      artists: showRemoteRows && wanted.artist ? results.shownArtists : [],
      tracks: showRemoteRows && wanted.track ? results.shownTracks : [],
      albums: showRemoteRows && wanted.album ? results.shownAlbums : [],
      playlists: showRemoteRows && wanted.playlist ? results.shownPlaylists : [],
      topResult: showRemoteRows && tab === 'all' && sort === 'relevance'
        ? pickSearchTopResult({
          query: debouncedQuery,
          artists: results.shownArtists,
          tracks: results.foundTracks,
          albums: results.shownAlbums,
          libraryTrackIds: library.shownIds,
        })
        : null,
    })
    : [];

  const renderSearchRow = (row: SearchListRow) => {
    switch (row.kind) {
      case 'library-header':
        return (
          <View testID="search-section-library" style={styles.librarySectionHeader}>
            <SectionHeader title={strings.search.sections.library} />
          </View>
        );
      case 'library-track': {
        const { track, index } = row;
        return (
          <SearchTrackResultRow
            track={track}
            testID={`search-library-track-${track.id}`}
            occurrence={searchTrackRadioOccurrence(track.id)}
            position={index + 1}
            rollingDeviceCacheSeconds={activeProgress.cached}
            onPlay={() => playLibrary(index)}
            onActions={() => showTrackActions(track, setActionError)}
            onOpenAlbum={openTrackAlbum}
            onOpenArtist={openTrackArtist}
          />
        );
      }
      case 'library-notice':
        // Rows of this kind exist only while the likes query reports an issue.
        if (library.likesIssue === null) {
          throw new Error('Library notice row rendered without a likes issue');
        }
        return (
          <SearchLibraryLikesNotice
            kind={library.likesIssue.kind}
            retryBusy={library.likesIssue.retryBusy}
            onRetry={library.likesIssue.retry}
          />
        );
      case 'remote-status':
        return remoteStatus;
      case 'top-result': {
        const { result } = row;
        return (
          <SearchTopResultCard
            result={result}
            onPress={() => openTopResult(result)}
            onLongPress={result.kind === 'track'
              ? () => showTrackActions(result.track, setActionError)
              : undefined}
          />
        );
      }
      case 'artist-section':
        return <SearchArtistSection artists={row.artists} onOpenArtist={onOpenArtist} />;
      case 'track-header':
        return (
          <View testID="search-section-tracks" style={styles.trackSectionHeader}>
            <SectionHeader title={strings.search.sections.tracks} />
          </View>
        );
      case 'track': {
        const { track, index } = row;
        return (
          <SearchTrackResultRow
            track={track}
            testID={`search-track-${track.id}-${index}`}
            occurrence={searchTrackRadioOccurrence(track.id)}
            position={index + 1}
            plays={results.trackPlays?.[track.id]}
            rollingDeviceCacheSeconds={activeProgress.cached}
            onPlay={() => play(index)}
            onActions={() => showTrackActions(track, setActionError)}
            onOpenAlbum={openTrackAlbum}
            onOpenArtist={openTrackArtist}
          />
        );
      }
      case 'album-section':
        return <SearchAlbumSection albums={row.albums} onOpenAlbum={onOpenAlbum} />;
      case 'playlist-section':
        return (
          <SearchPlaylistSection
            playlists={row.playlists}
            startingPlaylistId={startingPlaylist}
            onStartPlaylist={(playlistId) => void startDeezerPlaylist(playlistId)}
          />
        );
    }
  };

  return (
    <View testID="search-screen" style={styles.container}>
      {importing ? (
        <SearchImportMode
          accountScope={accountScope}
          chrome={searchChrome}
          sharedRequest={sharedImportRequest}
          rollingDeviceCacheSeconds={activeProgress.cached}
          onOpenAlbum={openTrackAlbum}
          onOpenArtist={openTrackArtist}
        />
      ) : (
        <SearchVirtualizedResults
          accessibilityLabel={strings.navigation.search}
          rows={searchRows}
          bottomInset={bottomInset}
          header={(
            <>
              {searchChrome}
              {browseBody}
            </>
          )}
          renderRow={renderSearchRow}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  chrome: { gap: spacing.sm, paddingTop: spacing.md },
  gutter: { paddingHorizontal: layout.pagePadding },
  bodyGap: { paddingTop: spacing.md },
  librarySectionHeader: { paddingTop: spacing.md, paddingBottom: spacing.xs },
  trackSectionHeader: { paddingTop: spacing.xl, paddingBottom: spacing.xs },
});
