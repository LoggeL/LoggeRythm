import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProgress } from '../player/player';
import AppIcon from '../components/AppIcon';
import {
  SearchEntityCard,
  SearchResultRail,
  SearchTrackResultRow,
  searchTrackOccurrence,
} from '../components/search/SearchResults';
import { SearchImportMode } from '../components/search/SearchImportMode';
import { SearchVirtualizedResults } from '../components/search/SearchVirtualizedResults';
import {
  createSearchListRows,
  type SearchListRow,
} from '../components/search/searchListModel';
import {
  SearchErrorNotice,
  SearchLoadingStatus,
  SearchPoliteStatus,
  SearchRemoteBoundary,
} from '../components/search/SearchRemoteStates';
import { showTrackActions } from '../components/trackActions';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries, persistRecentSearches, queryKeys } from '../data';
import { resolveRemoteVisualState } from '../data/remoteState';
import { useAuth } from '../auth/AuthContext';
import { strings } from '../localization';
import { useLocaleRevision } from '../localization/LocaleProvider';
import { playTrackRow, playTracks } from '../player/controller';
import {
  dismissSpotifyImportRequest,
  getSpotifyImportRequestForScope,
  subscribeSpotifyImportRequests,
} from '../share/spotifyImport';
import { colors, metrics } from '../theme';
import type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';
import {
  SEARCH_SORTS,
  SEARCH_TABS,
  addRecentSearch,
  assertSearchRouteCallbacks,
  decodeRecentSearches,
  isCurrentSearchQuery,
  isSearchableQuery,
  normalizeSearchInput,
  orderedPlaylistTrackIds,
  recentSearchHydrationIdentity,
  recentSearchStorageKey,
  recentSearchIdentity,
  removeRecentSearch,
  resultLimit,
  scheduleSearchDebounce,
  sortSearchTracks,
  wantedSearchEntities,
  type SearchRouteCallbacks,
  type SearchEntity,
  type SearchSort,
  type SearchTab,
} from './searchModel';
import {
  resolveSearchAggregateRemoteState,
  searchRemoteEntry,
} from './searchRemoteState';

export type SearchScreenProps = SearchRouteCallbacks;
export type {
  SearchAlbumRouteParams,
  SearchArtistRouteParams,
  SearchGenreRouteParams,
} from './searchModel';

function SearchResultSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <View testID={`search-section-${id}`} style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function SearchScreen(props: Partial<SearchScreenProps>) {
  assertSearchRouteCallbacks(props);
  const locale = useLocaleRevision();
  const { onOpenAlbum, onOpenArtist, onOpenGenre } = props;
  const { user } = useAuth();
  if (user === null) throw new Error('SearchScreen requires an authenticated user');

  const queryClient = useQueryClient();
  const activeProgress = useProgress(1);
  const accountScope = musicCacheScope(getCurrentApiBase(), user.id);
  const historyKey = recentSearchStorageKey(accountScope);
  const [input, setInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [tab, setTab] = useState<SearchTab>('all');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingPlaylist, setStartingPlaylist] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [loadedHistoryKey, setLoadedHistoryKey] = useState<string | null>(null);
  const [manualImporting, setManualImporting] = useState(false);
  const recentRef = useRef<string[]>([]);
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
  const wanted = wantedSearchEntities(tab);
  const historyHydrationIdentity = recentSearchHydrationIdentity(historyKey, locale);
  const historyLoaded = loadedHistoryKey === historyHydrationIdentity;
  const scopedRecent = historyLoaded ? recent : [];

  useEffect(() => {
    return scheduleSearchDebounce(normalizedInput, setDebouncedQuery);
  }, [normalizedInput]);

  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: queryKeys.search.root() });
    },
    [queryClient],
  );

  useEffect(() => {
    let active = true;
    recentRef.current = [];
    void AsyncStorage.getItem(historyKey)
      .then((raw) => {
        if (!active) return;
        const decoded = decodeRecentSearches(raw, locale);
        recentRef.current = decoded;
        setRecent(decoded);
        setLoadedHistoryKey(historyHydrationIdentity);
      })
      .catch((error) => {
        if (!active) return;
        recentRef.current = [];
        setRecent([]);
        setActionError(strings.search.historyFailed);
        setLoadedHistoryKey(historyHydrationIdentity);
      });
    return () => { active = false; };
  }, [historyHydrationIdentity, historyKey, locale]);

  useEffect(() => {
    if (!ready || !historyLoaded) return;
    const next = addRecentSearch(recentRef.current, debouncedQuery, locale);
    if (JSON.stringify(next) === JSON.stringify(recentRef.current)) return;
    recentRef.current = next;
    setRecent(next);
    void persistRecentSearches(AsyncStorage, accountScope, next).catch(() =>
      setActionError(strings.search.historyFailed),
    );
  }, [accountScope, debouncedQuery, historyLoaded, locale, ready]);

  const tracksQuery = useQuery({
    ...musicQueries.searchTracks(debouncedQuery),
    enabled: ready && wanted.track,
  });
  const albumsQuery = useQuery({
    ...musicQueries.searchAlbums(debouncedQuery),
    enabled: ready && wanted.album,
  });
  const artistsQuery = useQuery({
    ...musicQueries.searchArtists(debouncedQuery),
    enabled: ready && wanted.artist,
  });
  const playlistsQuery = useQuery({
    ...musicQueries.searchPlaylists(debouncedQuery),
    enabled: ready && wanted.playlist,
  });
  const genresQuery = useQuery({ ...musicQueries.genres(), enabled: browsing });

  const tracks = useMemo(
    () => sortSearchTracks(tracksQuery.data ?? [], sort, locale),
    [locale, sort, tracksQuery.data],
  );
  const albums = albumsQuery.data ?? [];
  const shownTracks = useMemo(
    () => tracks.slice(0, resultLimit(tab, 'track') ?? tracks.length),
    [tab, tracks],
  );
  const shownAlbums = albums.slice(0, resultLimit(tab, 'album') ?? albums.length);
  const shownArtists = (artistsQuery.data ?? []).slice(
    0,
    resultLimit(tab, 'artist') ?? artistsQuery.data?.length ?? 0,
  );
  const shownPlaylists = (playlistsQuery.data ?? []).slice(
    0,
    resultLimit(tab, 'playlist') ?? playlistsQuery.data?.length ?? 0,
  );
  const trackPlayRequest = useMemo(
    () => shownTracks.map(({ id, artist, title }) => ({ id, artist, title })),
    [shownTracks],
  );
  const trackMetadataEnabled = ready && wanted.track && trackPlayRequest.length > 0;
  const trackPlaysQuery = useQuery({
    ...musicQueries.trackPlayCounts(trackPlayRequest),
    enabled: trackMetadataEnabled,
  });
  const cachedTracksQuery = useQuery({
    ...musicQueries.cachedTrackIds(),
    enabled: trackMetadataEnabled,
  });
  const openTrackAlbum = (params: AlbumRouteParams) => onOpenAlbum({
    albumId: params.albumId,
    title: params.title ?? strings.navigation.album,
  });
  const openTrackArtist = (params: ArtistRouteParams) => onOpenArtist({
    artistId: params.artistId,
    name: params.name ?? strings.navigation.artist,
  });

  const entityLabels: Record<SearchEntity, string> = {
    track: strings.search.tabs.track,
    album: strings.search.tabs.album,
    artist: strings.search.tabs.artist,
    playlist: strings.search.tabs.playlist,
  };
  const activeSearchQueries = [
    ...(wanted.track ? [{
      key: 'track' as const,
      query: tracksQuery,
      itemCount: tracks.length,
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
      itemCount: artistsQuery.data?.length ?? 0,
      retry: () => { void artistsQuery.refetch(); },
    }] : []),
    ...(wanted.playlist ? [{
      key: 'playlist' as const,
      query: playlistsQuery,
      itemCount: playlistsQuery.data?.length ?? 0,
      retry: () => { void playlistsQuery.refetch(); },
    }] : []),
  ];
  const searchState = resolveSearchAggregateRemoteState(
    activeSearchQueries.map(({ key, query, itemCount }) =>
      searchRemoteEntry(key, query, itemCount)),
  );
  const activeSearchQuery = (key: string) =>
    activeSearchQueries.find((candidate) => candidate.key === key);

  const metadataQueries = trackMetadataEnabled ? [
    {
      key: 'track-plays',
      query: trackPlaysQuery,
      retry: () => { void trackPlaysQuery.refetch(); },
    },
    {
      key: 'cache-membership',
      query: cachedTracksQuery,
      retry: () => { void cachedTracksQuery.refetch(); },
    },
  ] : [];
  const metadataEntries = metadataQueries.map(({ key, query }) =>
    searchRemoteEntry(key, query, 0));
  const metadataState = metadataEntries.length > 0
    ? resolveSearchAggregateRemoteState(metadataEntries)
    : null;
  const metadataIssueKeys = new Set(metadataState?.issues.map(({ key }) => key) ?? []);
  const metadataRetryBusy = metadataQueries.some(
    ({ key, query }) => metadataIssueKeys.has(key) && query.fetchStatus === 'fetching',
  );
  const retryMetadata = () => {
    for (const candidate of metadataQueries) {
      if (metadataIssueKeys.has(candidate.key)) candidate.retry();
    }
  };

  const genresState = resolveRemoteVisualState({
    hasData: genresQuery.data !== undefined,
    empty: genresQuery.data !== undefined && genresQuery.data.length === 0,
    pending: genresQuery.isPending,
    fetching: genresQuery.isFetching,
    stale: genresQuery.isStale,
    fetchStatus: genresQuery.fetchStatus,
    error: genresQuery.error,
  });

  const updateInput = (value: string) => {
    setInput(value);
    setDebouncedQuery('');
    setActionError(null);
    void queryClient.cancelQueries({ queryKey: queryKeys.search.root() });
  };

  const play = (index: number) => {
    Keyboard.dismiss();
    if (index < 0 || index >= tracks.length) {
      throw new Error(`Search playback index ${index} is outside ${tracks.length} tracks`);
    }
    void playTrackRow(tracks, index, {
      context: {
        type: 'search',
        id: debouncedQuery,
        label: strings.queue.searchContext(debouncedQuery),
      },
    }).catch((error) =>
      setActionError(strings.search.playFailed),
    );
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

  const clearHistory = () => {
    recentRef.current = [];
    setRecent([]);
    void persistRecentSearches(AsyncStorage, accountScope, []).catch(() =>
      setActionError(strings.search.historyFailed),
    );
  };

  const removeHistoryEntry = (entry: string) => {
    const next = removeRecentSearch(recentRef.current, entry, locale);
    recentRef.current = next;
    setRecent(next);
    void persistRecentSearches(AsyncStorage, accountScope, next).catch(() =>
      setActionError(strings.search.historyFailed),
    );
  };

  const sortLabels: Record<SearchSort, string> = {
    relevance: strings.search.sorts.relevance,
    title: strings.search.sorts.title,
    'dur-asc': strings.search.sorts.durationAscending,
    'dur-desc': strings.search.sorts.durationDescending,
  };
  const primaryIssuesPresent = searchState.issues.length > 0;
  const primaryLoadingPresent = searchState.loadingKeys.length > 0;
  const primaryStaleNotice =
    !primaryIssuesPresent
    && !primaryLoadingPresent
    && searchState.refreshingKeys.length === 0
    && searchState.staleKeys.length > 0;
  const searchFeedback = ready ? (
    <>
      {searchState.issues.map((issue) => {
        const owner = activeSearchQuery(issue.key);
        if (owner === undefined) return null;
        const label = entityLabels[owner.key];
        const offline = issue.kind === 'offline' || issue.kind === 'cached-offline';
        const cached = issue.kind === 'cached-offline' || issue.kind === 'cached-refresh-error';
        const message = offline
          ? cached
            ? strings.search.remoteCachedOffline(label)
            : strings.search.remoteOffline(label)
          : cached
            ? strings.search.remoteCachedRefreshFailed(label)
            : strings.search.remoteLoadFailed(label);
        return (
          <SearchErrorNotice
            key={`${owner.key}:${issue.kind}`}
            testID={`search-results-${owner.key}-${issue.kind}`}
            message={message}
            actionLabel={strings.search.retrySection(label)}
            actionBusy={owner.query.fetchStatus === 'fetching'}
            onAction={owner.retry}
            liveRegion={cached ? 'polite' : 'assertive'}
          />
        );
      })}
      {primaryLoadingPresent ? (
        <SearchLoadingStatus testID="search-results-loading" label={strings.search.searching} />
      ) : null}
      {!primaryIssuesPresent && !primaryLoadingPresent && searchState.refreshingKeys.length > 0 ? (
        <SearchLoadingStatus
          testID="search-results-refreshing"
          label={strings.search.remoteRefreshing(strings.search.tabs.all)}
        />
      ) : null}
      {primaryStaleNotice ? (
          <SearchPoliteStatus
            testID="search-results-stale"
            message={strings.search.remoteStale(strings.search.tabs.all)}
            compact
          />
        ) : null}
    </>
  ) : null;

  const metadataFeedback = metadataState === null ? null : metadataState.issues.length > 0 ? (() => {
    const anyBlocking = metadataState.issues.some(
      ({ kind }) => kind === 'offline' || kind === 'hard-error',
    );
    const anyOffline = metadataState.issues.some(
      ({ kind }) => kind === 'offline' || kind === 'cached-offline',
    );
    const message = anyBlocking
      ? anyOffline
        ? strings.search.remoteOffline(strings.search.metadataTitle)
        : strings.search.remoteLoadFailed(strings.search.metadataTitle)
      : anyOffline
        ? strings.search.remoteCachedOffline(strings.search.metadataTitle)
        : strings.search.remoteCachedRefreshFailed(strings.search.metadataTitle);
    return (
      <SearchErrorNotice
        testID="search-metadata-error"
        message={message}
        actionLabel={strings.search.retrySection(strings.search.metadataTitle)}
        actionBusy={metadataRetryBusy}
        onAction={retryMetadata}
        liveRegion="polite"
      />
    );
  })() : metadataState.loadingKeys.length > 0 || metadataState.refreshingKeys.length > 0 ? (
    <SearchPoliteStatus
      testID="search-metadata-refreshing"
      message={metadataState.loadingKeys.length > 0
        ? strings.search.remoteLoading(strings.search.metadataTitle)
        : strings.search.remoteRefreshing(strings.search.metadataTitle)}
    />
  ) : metadataState.staleKeys.length > 0 && !primaryStaleNotice ? (
    <SearchPoliteStatus
      testID="search-metadata-stale"
      message={strings.search.remoteStale(strings.search.metadataTitle)}
      compact
    />
  ) : null;

  const searchChrome = (
    <>
        <View style={styles.searchBar}>
          <TextInput
            testID="search-input"
            accessibilityLabel={strings.search.inputLabel}
            style={styles.input}
            placeholder={strings.search.placeholder}
            placeholderTextColor={colors.textSecondary}
            value={input}
            onChangeText={updateInput}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {input.length > 0 ? (
            <Pressable
              testID="search-clear"
              accessibilityRole="button"
              accessibilityLabel={strings.search.clear}
              onPress={() => updateInput('')}
              style={styles.clearButton}
            >
              <AppIcon name="close" color={colors.textSecondary} size={20} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.importToggleRow}>
          <Pressable
            testID="spotify-import-toggle"
            accessibilityRole="button"
            accessibilityLabel={
              importing ? strings.search.importClose : strings.search.importOpen
            }
            accessibilityState={{ expanded: importing }}
            onPress={() => {
              if (importing) {
                setManualImporting(false);
                dismissSpotifyImportRequest(sharedImportRequest?.id);
              } else {
                setManualImporting(true);
              }
            }}
            style={[styles.importToggle, importing && styles.importToggleSelected]}
          >
            <Text style={[styles.importToggleText, importing && styles.importToggleTextSelected]}>
              {importing ? strings.search.importClose : strings.search.importOpen}
            </Text>
          </Pressable>
        </View>

        {inputIsSearchable ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
            accessibilityRole="tablist"
          >
            {SEARCH_TABS.map((candidate) => {
              const selected = candidate === tab;
              return (
                <Pressable
                  key={candidate}
                  testID={`search-tab-${candidate}`}
                  accessibilityRole="tab"
                  accessibilityLabel={strings.search.tabs[candidate]}
                  accessibilityState={{ selected }}
                  onPress={() => setTab(candidate)}
                  style={[styles.tab, selected && styles.tabSelected]}
                >
                  <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                    {strings.search.tabs[candidate]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {inputIsSearchable && (tab === 'all' || tab === 'track') ? (
          <View testID="search-sort-controls" style={styles.sortBlock}>
            <Text style={styles.sortLabel}>{strings.search.sortLabel}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sorts}>
              {SEARCH_SORTS.map((candidate) => {
                const selected = candidate === sort;
                return (
                  <Pressable
                    key={candidate}
                    testID={`search-sort-${candidate}`}
                    accessibilityRole="button"
                    accessibilityLabel={sortLabels[candidate]}
                    accessibilityState={{ selected }}
                    onPress={() => setSort(candidate)}
                    style={[styles.sort, selected && styles.sortSelected]}
                  >
                    <Text style={[styles.sortText, selected && styles.sortTextSelected]}>
                      {sortLabels[candidate]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {actionError !== null ? (
          <SearchErrorNotice testID="search-action-error" message={actionError} />
        ) : null}
    </>
  );

  const searchBody = browsing ? (
          <View testID="search-genre-browse" style={styles.browse}>
            {!historyLoaded ? (
              <SearchPoliteStatus
                testID="search-history-loading"
                message={strings.search.historyLoading}
              />
            ) : null}
            {scopedRecent.length > 0 ? (
              <View testID="search-recent" style={styles.recentBlock}>
                <View style={styles.recentHeader}>
                  <Text accessibilityRole="header" style={styles.sectionTitle}>{strings.search.recentTitle}</Text>
                  <Pressable
                    testID="search-recent-clear"
                    accessibilityRole="button"
                    accessibilityLabel={strings.search.clearHistory}
                    onPress={clearHistory}
                    style={styles.historyClear}
                  >
                    <Text style={styles.historyClearText}>{strings.search.clearHistory}</Text>
                  </Pressable>
                </View>
                <View style={styles.recentChips}>
                  {scopedRecent.map((entry, index) => (
                    <View key={recentSearchIdentity(entry, locale)} style={styles.recentChip}>
                      <Pressable
                        testID={`search-recent-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={entry}
                        onPress={() => updateInput(entry)}
                        style={styles.recentChoice}
                      >
                        <Text style={styles.recentChipText}>{entry}</Text>
                      </Pressable>
                      <Pressable
                        testID={`search-recent-remove-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={strings.search.removeRecent(entry)}
                        onPress={() => removeHistoryEntry(entry)}
                        style={({ pressed }) => [styles.recentRemove, pressed && styles.pressed]}
                      >
                        <AppIcon name="close" color={colors.textSecondary} size={16} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            <Text accessibilityRole="header" style={styles.sectionTitle}>{strings.search.browseTitle}</Text>
            <SearchRemoteBoundary
              id="search-genres"
              state={genresState}
              loadingLabel={strings.search.browseLoading}
              emptyLabel={strings.search.browsePrompt}
              offlineLabel={strings.search.remoteOffline(strings.search.browseTitle)}
              errorLabel={strings.search.remoteLoadFailed(strings.search.browseTitle)}
              cachedOfflineLabel={strings.search.remoteCachedOffline(strings.search.browseTitle)}
              cachedErrorLabel={strings.search.remoteCachedRefreshFailed(strings.search.browseTitle)}
              refreshingLabel={strings.search.remoteRefreshing(strings.search.browseTitle)}
              staleLabel={strings.search.remoteStale(strings.search.browseTitle)}
              retryLabel={strings.search.retrySection(strings.search.browseTitle)}
              retryBusy={genresQuery.fetchStatus === 'fetching'}
              onRetry={() => { void genresQuery.refetch(); }}
            >
              <SearchResultRail
                id="genres"
                data={genresQuery.data ?? []}
                keyExtractor={(genre, index) => `${genre.id}:${index}`}
                renderItem={(genre) => (
                  <SearchEntityCard
                    testID={`search-genre-${genre.id}`}
                    accessibilityLabel={strings.search.openGenre(genre.name)}
                    title={genre.name}
                    subtitle={strings.search.browseTitle}
                    imageUri={genre.picture}
                    onPress={() => onOpenGenre({ genreId: genre.id, name: genre.name })}
                  />
                )}
              />
            </SearchRemoteBoundary>
          </View>
        ) : !inputIsSearchable ? (
          <Text testID="search-minimum-hint" style={styles.hint}>{strings.search.minimumQueryHint}</Text>
        ) : !ready ? (
          <Text testID="search-debounce-status" accessibilityLiveRegion="polite" style={styles.status}>{strings.search.preparing}</Text>
        ) : (
          <>
            {searchFeedback}
            {searchState.body === 'empty' ? (
              <SearchPoliteStatus
                testID="search-results-empty"
                message={strings.search.noResultsFor(debouncedQuery)}
              />
            ) : null}
            {searchState.body === 'content' ? (
              <View testID="search-results">
                {metadataFeedback}
              </View>
            ) : null}
          </>
        );

  const searchRows = searchState.body === 'content'
    ? createSearchListRows({
      artists: wanted.artist ? shownArtists : [],
      tracks: wanted.track ? shownTracks : [],
      albums: wanted.album ? shownAlbums : [],
      playlists: wanted.playlist ? shownPlaylists : [],
    })
    : [];

  const renderSearchRow = (row: SearchListRow) => {
    switch (row.kind) {
      case 'artist-section':
        return (
          <SearchResultSection id="artists" title={strings.search.sections.artists}>
            <SearchResultRail
              id="artists"
              data={row.artists}
              keyExtractor={(artist, index) => `${artist.id}:${index}`}
              renderItem={(artist) => (
                <SearchEntityCard
                  testID={`search-artist-${artist.id}`}
                  accessibilityLabel={strings.search.openArtist(artist.name)}
                  title={artist.name}
                  subtitle={strings.search.sections.artists}
                  imageUri={artist.picture}
                  round
                  onPress={() => onOpenArtist({ artistId: artist.id, name: artist.name })}
                />
              )}
            />
          </SearchResultSection>
        );
      case 'track-header':
        return (
          <View testID="search-section-tracks" style={styles.trackSectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              {strings.search.sections.tracks}
            </Text>
          </View>
        );
      case 'track': {
        const { track, index } = row;
        return (
          <SearchTrackResultRow
            track={track}
            testID={`search-track-${track.id}-${index}`}
            occurrence={searchTrackOccurrence(debouncedQuery, index)}
            position={index + 1}
            plays={trackPlaysQuery.data?.[track.id]}
            rollingDeviceCacheSeconds={activeProgress.cached}
            onPlay={() => play(index)}
            onActions={() => showTrackActions(track, setActionError)}
            onOpenAlbum={openTrackAlbum}
            onOpenArtist={openTrackArtist}
          />
        );
      }
      case 'album-section':
        return (
          <SearchResultSection id="albums" title={strings.search.sections.albums}>
            <SearchResultRail
              id="albums"
              data={row.albums}
              keyExtractor={(album, index) => `${album.id}:${index}`}
              renderItem={(album, index) => (
                <SearchEntityCard
                  testID={`search-album-${album.id}-${index}`}
                  accessibilityLabel={strings.search.openAlbum(album.title, album.artistName)}
                  title={album.title}
                  subtitle={album.artistName}
                  imageUri={album.artworkUrl ?? ''}
                  onPress={() => onOpenAlbum({ albumId: album.id, title: album.title })}
                />
              )}
            />
          </SearchResultSection>
        );
      case 'playlist-section':
        return (
          <SearchResultSection id="playlists" title={strings.search.sections.playlists}>
            <SearchResultRail
              id="playlists"
              data={row.playlists}
              keyExtractor={(playlist, index) => `${playlist.id}:${index}`}
              renderItem={(playlist) => {
                const busy = startingPlaylist === playlist.id;
                return (
                  <SearchEntityCard
                    testID={`search-playlist-${playlist.id}`}
                    accessibilityLabel={strings.search.openPlaylist(playlist.title, playlist.track_count)}
                    title={playlist.title}
                    subtitle={busy ? strings.search.playlistLoading : strings.common.trackCount(playlist.track_count)}
                    imageUri={playlist.cover}
                    disabled={startingPlaylist !== null}
                    busy={busy}
                    onPress={() => void startDeezerPlaylist(playlist.id)}
                  />
                );
              }}
            />
          </SearchResultSection>
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
          header={(
            <>
              {searchChrome}
              {searchBody}
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
  searchBar: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  input: {
    minHeight: metrics.minimumTouchTarget,
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 52,
    paddingVertical: 10,
    fontSize: 16,
  },
  clearButton: {
    position: 'absolute',
    right: 18,
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearGlyph: { color: colors.textSecondary, fontSize: 25 },
  importToggleRow: { alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 12 },
  importToggle: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: colors.surfaceElevated,
  },
  importToggleSelected: { backgroundColor: colors.textPrimary },
  importToggleText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  importToggleTextSelected: { color: colors.background },
  tabs: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  tab: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: colors.surfaceElevated,
  },
  tabSelected: { backgroundColor: colors.textPrimary },
  tabText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  tabTextSelected: { color: colors.background, fontSize: 14, fontWeight: '800' },
  sortBlock: { gap: 7, paddingBottom: 14 },
  sortLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', paddingHorizontal: 16 },
  sorts: { gap: 7, paddingHorizontal: 16 },
  sort: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sortSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
  sortText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  sortTextSelected: { color: colors.accentSoft },
  browse: { gap: 14, paddingTop: 6 },
  recentBlock: { gap: 10, marginBottom: 12 },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 12 },
  historyClear: { minHeight: metrics.minimumTouchTarget, justifyContent: 'center', paddingHorizontal: 8 },
  historyClearText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  recentChip: { flexDirection: 'row', alignItems: 'center', borderRadius: 24, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
  recentChoice: { minHeight: metrics.minimumTouchTarget, justifyContent: 'center', paddingLeft: 15, paddingRight: 6 },
  recentChipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  recentRemove: { width: metrics.minimumTouchTarget, height: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  recentRemoveGlyph: { color: colors.textSecondary, fontSize: 20, lineHeight: 22 },
  pressed: { opacity: 0.7 },
  section: { gap: 10, paddingTop: 28 },
  trackSectionHeader: { paddingTop: 28, paddingBottom: 10 },
  sectionTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', paddingHorizontal: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: 16 },
  hint: { color: colors.textSecondary, textAlign: 'center', marginTop: 38, paddingHorizontal: 32 },
  errorBox: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surfaceElevated,
  },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  retryButton: { minHeight: metrics.minimumTouchTarget, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 24, backgroundColor: colors.accent },
  retryText: { color: colors.onAccent, fontSize: 13, fontWeight: '700' },
});
