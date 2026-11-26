import { useIsFocused } from '@react-navigation/native';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Keyboard, StyleSheet, View, type TextInput } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Genre, Track } from '../api/types';
import { ActionButton, EmptyState, ScreenHeader, SectionHeader, TrackRowSkeleton } from '../components/ui';
import { RecentSearches } from '../components/search/RecentSearches';
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
import { useRecentSearches } from '../components/search/useRecentSearches';
import { showTrackActions } from '../components/trackActions';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries, queryKeys } from '../data';
import { resolveRemoteVisualState } from '../data/remoteState';
import { useAuth } from '../auth/AuthContext';
import { useBackHandler } from '../hooks/useBackHandler';
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
import { TvFocusScope, tvFocusRegistry, useTvEnvironment, useTvFocusReturn } from '../tv';
import type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';
import {
  assertSearchRouteCallbacks,
  formatSearchErrorDetail,
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

const EMPTY_GENRES: readonly Genre[] = [];
const EMPTY_TRACKS: readonly Track[] = [];
const SEARCH_TV_SCOPE = 'search';

export default function SearchScreen(props: Partial<SearchScreenProps>) {
  assertSearchRouteCallbacks(props);
  const locale = useLocaleRevision();
  const { onOpenAlbum, onOpenArtist, onOpenGenre } = props;
  const { user } = useAuth();
  if (user === null) throw new Error('SearchScreen requires an authenticated user');

  const isFocused = useIsFocused();
  const tv = useTvEnvironment();
  const queryClient = useQueryClient();
  const bottomInset = useBottomInset();
  const accountScope = musicCacheScope(getCurrentApiBase(), user.id);
  const [{ input, publishedQuery: debouncedQuery }, dispatchSearchInput] = useReducer(
    searchInputReducer,
    { input: '', publishedQuery: '' },
  );
  const [previousContentQuery, setPreviousContentQuery] = useState<string | null>(null);
  const latestContentQueryRef = useRef<string | null>(null);
  const [tab, setTab] = useState<SearchTab>('all');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingPlaylist, setStartingPlaylist] = useState<string | null>(null);
  const [manualImporting, setManualImporting] = useState(false);

  const searchInputRef = useRef<TextInput | null>(null);
  const [requestedInputFocus, setRequestedInputFocus] = useState(false);

  useEffect(() => {
    if (!tv.isTv) return;
    return tvFocusRegistry.register(
      'search-input',
      {
        requestFocus: () => {
          setRequestedInputFocus(true);
          searchInputRef.current?.focus();
        },
      },
      SEARCH_TV_SCOPE,
    );
  }, [tv.isTv]);

  useTvFocusReturn({
    scope: SEARCH_TV_SCOPE,
    active: isFocused,
    fallbackKey: 'search-input',
    enabled: tv.isTv,
  });

  const recordSearchFocus = useCallback(
    (focusKey: string) => {
      if (tv.isTv) tvFocusRegistry.recordFocus(focusKey, SEARCH_TV_SCOPE);
    },
    [tv.isTv],
  );

  const recentSearches = useRecentSearches(accountScope);
  const getScopedImportRequest = useCallback(
    () => getSpotifyImportRequestForScope(accountScope),
    [accountScope],
  );
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
  // While typing during debounce (`!ready`), keep the last query that had content
  // keyed with `enabled: false` so previous results stay calm on screen instead of
  // flashing 6 skeleton rows on every character. Never retain prior errors or empty states.
  const activeResultQuery = ready
    ? debouncedQuery
    : (inputIsSearchable ? (previousContentQuery ?? '') : '');
  const results = useSearchResults({
    query: activeResultQuery,
    ready,
    tab,
    sort,
    locale,
    libraryTrackIds: library.shownIds,
    libraryTracks: library.shown,
  });
  const { wanted, tracks, state: searchState } = results;

  useEffect(() => {
    if (!inputIsSearchable) {
      latestContentQueryRef.current = null;
      return;
    }
    if (!ready) return;
    if (searchState.body === 'content') {
      latestContentQueryRef.current = debouncedQuery;
    } else if (searchState.body === 'empty' || searchState.body === 'blocked') {
      latestContentQueryRef.current = null;
    }
  }, [debouncedQuery, inputIsSearchable, ready, searchState.body]);

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

  const rememberCurrentQuery = useCallback(() => {
    if (isSearchableQuery(normalizedInput)) {
      recentSearches.remember(normalizedInput);
    }
  }, [normalizedInput, recentSearches]);

  const openTrackAlbum = useCallback(
    (params: AlbumRouteParams) => {
      rememberCurrentQuery();
      onOpenAlbum({
        albumId: params.albumId,
        title: params.title ?? strings.navigation.album,
      });
    },
    [onOpenAlbum, rememberCurrentQuery],
  );

  const openTrackArtist = useCallback(
    (params: ArtistRouteParams) => {
      rememberCurrentQuery();
      onOpenArtist({
        artistId: params.artistId,
        name: params.name ?? strings.navigation.artist,
      });
    },
    [onOpenArtist, rememberCurrentQuery],
  );

  const openSearchAlbum = useCallback(
    (params: Parameters<SearchRouteCallbacks['onOpenAlbum']>[0]) => {
      rememberCurrentQuery();
      onOpenAlbum(params);
    },
    [onOpenAlbum, rememberCurrentQuery],
  );

  const openSearchArtist = useCallback(
    (params: Parameters<SearchRouteCallbacks['onOpenArtist']>[0]) => {
      rememberCurrentQuery();
      onOpenArtist(params);
    },
    [onOpenArtist, rememberCurrentQuery],
  );

  const openSearchGenre = useCallback(
    (params: Parameters<SearchRouteCallbacks['onOpenGenre']>[0]) => {
      onOpenGenre(params);
    },
    [onOpenGenre],
  );

  const updateInput = useCallback(
    (value: string) => {
      const nextNormalized = normalizeSearchInput(value);
      dispatchSearchInput({ type: 'edit', value });
      setActionError(null);
      if (!isSearchableQuery(nextNormalized)) {
        setPreviousContentQuery(null);
      } else if (nextNormalized !== normalizedInput) {
        setPreviousContentQuery(latestContentQueryRef.current);
      }
      if (nextNormalized !== normalizedInput) {
        void queryClient.cancelQueries({ queryKey: queryKeys.search.root() });
      }
    },
    [normalizedInput, queryClient],
  );

  const selectRecentSearch = useCallback(
    (query: string) => {
      setActionError(null);
      setPreviousContentQuery(null);
      dispatchSearchInput({ type: 'select', query });
      recentSearches.remember(query);
      Keyboard.dismiss();
    },
    [recentSearches],
  );

  const toggleImport = useCallback(() => {
    if (importing) {
      setManualImporting(false);
      dismissSpotifyImportRequest(sharedImportRequest?.id);
    } else {
      setManualImporting(true);
    }
  }, [importing, sharedImportRequest?.id]);

  // Android hardware/gesture Back: close Spotify Import -> clear active query -> normal tab Back.
  const handleBack = useCallback(() => {
    if (importing) {
      setManualImporting(false);
      dismissSpotifyImportRequest(sharedImportRequest?.id);
      return true;
    }
    if (input.length > 0) {
      updateInput('');
      return true;
    }
    return false;
  }, [importing, input.length, sharedImportRequest?.id, updateInput]);

  useBackHandler(isFocused && (importing || input.length > 0), handleBack);

  // A tapped track plays on its own and continues with its track radio; the
  // other results never become the queue. Library matches behave the same:
  // they are rows of the same result list, so a different tap semantic per
  // section would be surprising.
  const playWithRadio = useCallback(
    (track: Track) => {
      Keyboard.dismiss();
      rememberCurrentQuery();
      setActionError(null);
      void playTrackWithRadio(track).catch((error: unknown) => {
        console.error('Search track playback failed', error);
        const base =
          error instanceof TrackRadioError ? strings.search.radioFailed : strings.search.playFailed;
        const detail = formatSearchErrorDetail(error);
        setActionError(detail !== null ? `${base}: ${detail}` : base);
      });
    },
    [rememberCurrentQuery],
  );

  const play = useCallback(
    (index: number) => {
      if (index < 0 || index >= tracks.length) {
        throw new Error(`Search playback index ${index} is outside ${tracks.length} tracks`);
      }
      playWithRadio(tracks[index]);
    },
    [playWithRadio, tracks],
  );

  const playLibrary = useCallback(
    (index: number) => {
      if (index < 0 || index >= library.matches.length) {
        throw new Error(
          `Library search playback index ${index} is outside ${library.matches.length} tracks`,
        );
      }
      playWithRadio(library.matches[index]);
    },
    [library.matches, playWithRadio],
  );

  const startDeezerPlaylist = useCallback(
    async (playlistId: string) => {
      setStartingPlaylist(playlistId);
      setActionError(null);
      rememberCurrentQuery();
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
      } catch (error: unknown) {
        console.error('Search playlist playback failed', error);
        const detail = formatSearchErrorDetail(error);
        setActionError(
          detail !== null
            ? `${strings.search.playlistLoadFailed}: ${detail}`
            : strings.search.playlistLoadFailed,
        );
      } finally {
        setStartingPlaylist(null);
      }
    },
    [queryClient, rememberCurrentQuery],
  );

  const openTopResult = useCallback(
    (result: SearchTopResult) => {
      switch (result.kind) {
        case 'artist':
          return openSearchArtist({ artistId: result.artist.id, name: result.artist.name });
        case 'album':
          return openSearchAlbum({ albumId: result.album.id, title: result.album.title });
        case 'track':
          // Play the track the card shows. Its index is a position in the
          // unfiltered hits, while `play(index)` addresses the list below the
          // library section, which drops liked recordings: the same index is
          // then another song, or outside the list.
          return playWithRadio(result.track);
      }
    },
    [openSearchAlbum, openSearchArtist, playWithRadio],
  );

  const tvPaddingHorizontal = tv.isTv ? tv.contentPaddingHorizontal : undefined;
  const tvGap = tv.isTv ? tv.gridGap : undefined;
  const tvCardSize = tv.isTv ? tv.cardSize : undefined;
  const tvGenreColumns = tv.isTv ? Math.min(4, Math.max(3, tv.gridColumns)) : undefined;
  const tvGenreTileHeight = tv.isTv ? Math.round(layout.artwork.lg * 1.15) : undefined;
  const tvLabelStyle = tv.isTv ? tv.typography.label : undefined;
  const tvBodyStyle = tv.isTv ? tv.typography.body : undefined;
  const tvTitleStyle = tv.isTv ? tv.typography.bodyStrong : undefined;
  const tvSubtitleStyle = tv.isTv ? tv.typography.callout : undefined;
  const tvSectionTitleStyle = tv.isTv ? tv.typography.section : undefined;
  const tvTopArtwork = tv.isTv ? Math.round((layout.artwork.md + spacing.md) * 1.25) : undefined;

  const searchChrome = (
    <View style={styles.chrome}>
      <ScreenHeader
        title={strings.navigation.search}
        style={
          tvPaddingHorizontal === undefined
            ? styles.gutter
            : { paddingHorizontal: tvPaddingHorizontal }
        }
      />
      {!importing ? (
        <SearchBar
          inputRef={searchInputRef}
          value={input}
          onChangeText={updateInput}
          marginHorizontal={tvPaddingHorizontal}
          minHeight={tv.isTv ? tv.minFocusTargetHeight : undefined}
          inputTextStyle={tvBodyStyle}
          hasTVPreferredFocus={tv.isTv && isFocused && requestedInputFocus ? true : undefined}
          onInputFocus={() => {
            setRequestedInputFocus(false);
            recordSearchFocus('search-input');
          }}
          onSubmit={() => {
            dispatchSearchInput({ type: 'submit' });
            rememberCurrentQuery();
            Keyboard.dismiss();
          }}
        />
      ) : null}
      <SpotifyImportToggle
        expanded={importing}
        onToggle={toggleImport}
        marginHorizontal={
          tvPaddingHorizontal === undefined
            ? undefined
            : tvPaddingHorizontal - spacing.sm
        }
        labelStyle={tvLabelStyle}
        onFocus={() => recordSearchFocus('spotify-import-toggle')}
      />
      {!importing && inputIsSearchable ? (
        <SearchTabs
          tab={tab}
          onSelect={setTab}
          paddingHorizontal={tvPaddingHorizontal}
          onChipFocus={recordSearchFocus}
        />
      ) : null}
      {!importing && inputIsSearchable && wanted.track ? (
        <SearchSortControls
          sort={sort}
          onSelect={setSort}
          paddingHorizontal={tvPaddingHorizontal}
          onChipFocus={recordSearchFocus}
        />
      ) : null}
      {!importing && actionError !== null ? (
        <SearchErrorNotice testID="search-action-error" message={actionError} />
      ) : null}
    </View>
  );

  const browseBody = browsing ? (
    <>
      <RecentSearches
        recent={recentSearches.recent}
        error={recentSearches.error}
        onSelect={selectRecentSearch}
        onRemove={recentSearches.remove}
        onClear={recentSearches.clear}
        onRetry={recentSearches.retry}
        paddingHorizontal={tvPaddingHorizontal}
        minTargetHeight={tv.isTv ? tv.minFocusTargetHeight : undefined}
        labelStyle={tvLabelStyle}
        onChipFocus={recordSearchFocus}
      />
      <SearchGenreBrowse
        testID="search-genre-browse"
        id="search-genres"
        genres={genresQuery.data ?? EMPTY_GENRES}
        genresState={genresState}
        retryBusy={genresQuery.fetchStatus === 'fetching'}
        onRetry={() => { void genresQuery.refetch(); }}
        onOpenGenre={openSearchGenre}
        columns={tvGenreColumns}
        tileHeight={tvGenreTileHeight}
        paddingHorizontal={tvPaddingHorizontal}
        gap={tvGap}
        titleStyle={tvTitleStyle}
        onTileFocus={recordSearchFocus}
        tvMode={tv.isTv}
      />
    </>
  ) : !inputIsSearchable ? (
    <EmptyState
      testID="search-minimum-hint"
      icon="text-search"
      title={strings.search.minimumQueryHint}
    />
  ) : null;

  const hasVisibleRemoteFeedback =
    !ready ||
    searchState.body !== 'content' ||
    searchState.issues.length > 0 ||
    searchState.loadingKeys.length > 0 ||
    searchState.refreshingKeys.length > 0 ||
    showsPrimaryStaleNotice(searchState) ||
    (results.metadata.state !== null &&
      (results.metadata.state.issues.length > 0 ||
        results.metadata.state.loadingKeys.length > 0 ||
        results.metadata.state.refreshingKeys.length > 0 ||
        (results.metadata.state.staleKeys.length > 0 && !showsPrimaryStaleNotice(searchState))));

  // Progress, failures and the empty state of the remote search. Rendered as
  // the list row below the library section, so that section never moves.
  const remoteStatus = !ready ? (
    <View style={styles.debounceWrap}>
      <SearchLoadingStatus
        testID="search-debounce-status"
        label={strings.search.preparing}
        paddingHorizontal={tvPaddingHorizontal}
      />
    </View>
  ) : (
    <View style={hasVisibleRemoteFeedback ? styles.bodyGap : undefined}>
      <SearchResultsFeedback
        state={searchState}
        owners={results.owners}
        tvMode={tv.isTv}
        renderLoading={({ testID, accessibilityLabel }) =>
          searchState.body === 'loading' ? (
            <TrackRowSkeleton testID={testID} accessibilityLabel={accessibilityLabel} />
          ) : (
            <SearchLoadingStatus
              testID={testID}
              label={accessibilityLabel}
              paddingHorizontal={tvPaddingHorizontal}
            />
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
            tvMode={tv.isTv}
          />
        </View>
      ) : null}
    </View>
  );

  const showingPreviousWhileTyping =
    !ready && previousContentQuery !== null && searchState.body === 'content';
  const showRemoteRows = (ready && searchState.body === 'content') || showingPreviousWhileTyping;

  const searchRows = useMemo(
    () =>
      inputIsSearchable
        ? createSearchListRows({
            libraryTracks: library.shown,
            libraryNotice: library.likesIssue !== null,
            remoteStatus: true,
            artists: showRemoteRows && wanted.artist ? results.shownArtists : [],
            tracks: showRemoteRows && wanted.track ? results.shownTracks : EMPTY_TRACKS,
            albums: showRemoteRows && wanted.album ? results.shownAlbums : [],
            playlists: showRemoteRows && wanted.playlist ? results.shownPlaylists : [],
            topResult:
              showRemoteRows && tab === 'all' && sort === 'relevance'
                ? pickSearchTopResult({
                    query: activeResultQuery,
                    artists: results.shownArtists,
                    tracks: results.foundTracks,
                    albums: results.shownAlbums,
                    libraryTrackIds: library.shownIds,
                  })
                : null,
          })
        : [],
    [
      activeResultQuery,
      inputIsSearchable,
      library.likesIssue,
      library.shown,
      library.shownIds,
      results.foundTracks,
      results.shownAlbums,
      results.shownArtists,
      results.shownPlaylists,
      results.shownTracks,
      showRemoteRows,
      sort,
      tab,
      wanted.album,
      wanted.artist,
      wanted.playlist,
      wanted.track,
    ],
  );

  const renderSearchRow = (row: SearchListRow) => {
    switch (row.kind) {
      case 'library-header':
        return (
          <View testID="search-section-library" style={styles.librarySectionHeader}>
            <SectionHeader
              title={strings.search.sections.library}
              style={
                tvPaddingHorizontal === undefined
                  ? undefined
                  : { paddingHorizontal: tvPaddingHorizontal }
              }
            />
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
            paddingHorizontal={tvPaddingHorizontal}
            artworkSize={tvTopArtwork}
            titleStyle={tvSectionTitleStyle}
            subtitleStyle={tvSubtitleStyle}
            onFocus={() => recordSearchFocus('search-top-result')}
            onPress={() => openTopResult(result)}
            onLongPress={result.kind === 'track'
              ? () => showTrackActions(result.track, setActionError)
              : undefined}
          />
        );
      }
      case 'artist-section':
        return (
          <SearchArtistSection
            artists={row.artists}
            onOpenArtist={openSearchArtist}
            cardSize={tvCardSize}
            paddingHorizontal={tvPaddingHorizontal}
            gap={tvGap}
            titleStyle={tvLabelStyle}
            subtitleStyle={tvSubtitleStyle}
            onCardFocus={recordSearchFocus}
          />
        );
      case 'track-header':
        return (
          <View testID="search-section-tracks" style={styles.trackSectionHeader}>
            <SectionHeader
              title={strings.search.sections.tracks}
              style={
                tvPaddingHorizontal === undefined
                  ? undefined
                  : { paddingHorizontal: tvPaddingHorizontal }
              }
            />
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
            onPlay={() => play(index)}
            onActions={() => showTrackActions(track, setActionError)}
            onOpenAlbum={openTrackAlbum}
            onOpenArtist={openTrackArtist}
          />
        );
      }
      case 'album-section':
        return (
          <SearchAlbumSection
            albums={row.albums}
            onOpenAlbum={openSearchAlbum}
            cardSize={tvCardSize}
            paddingHorizontal={tvPaddingHorizontal}
            gap={tvGap}
            titleStyle={tvLabelStyle}
            subtitleStyle={tvSubtitleStyle}
            onCardFocus={recordSearchFocus}
          />
        );
      case 'playlist-section':
        return (
          <SearchPlaylistSection
            playlists={row.playlists}
            startingPlaylistId={startingPlaylist}
            onStartPlaylist={(playlistId) => void startDeezerPlaylist(playlistId)}
            cardSize={tvCardSize}
            paddingHorizontal={tvPaddingHorizontal}
            gap={tvGap}
            titleStyle={tvLabelStyle}
            subtitleStyle={tvSubtitleStyle}
            onCardFocus={recordSearchFocus}
          />
        );
    }
  };

  return (
    <TvFocusScope scope={SEARCH_TV_SCOPE}>
      <View testID="search-screen" style={styles.container}>
        {importing ? (
          <SearchImportMode
            accountScope={accountScope}
            chrome={searchChrome}
            sharedRequest={sharedImportRequest}
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
    </TvFocusScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  chrome: { gap: spacing.sm, paddingTop: spacing.md },
  gutter: { paddingHorizontal: layout.pagePadding },
  debounceWrap: { paddingTop: spacing.xs },
  bodyGap: { paddingTop: spacing.md },
  librarySectionHeader: { paddingTop: spacing.md, paddingBottom: spacing.xs },
  trackSectionHeader: { paddingTop: spacing.xl, paddingBottom: spacing.xs },
});
