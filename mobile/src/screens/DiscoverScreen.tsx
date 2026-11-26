import React, { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import type { AlbumSummary, Genre, Track } from '../api/types';
import { resolveServerUrl } from '../api/url';
import {
  CatalogAlbumCard,
  CatalogPlaylistCard,
  CatalogTrackCard,
  HorizontalCatalogRail,
} from '../components/catalog/CatalogCards';
import { CatalogRuntimeError, CatalogSection } from '../components/catalog/CatalogStates';
import { GenreTileGrid } from '../components/search/GenreTiles';
import { FilterChip, ScreenHeader } from '../components/ui';
import { showTrackActions } from '../components/trackActions';
import { useAuth } from '../auth/AuthContext';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
import { useBottomInset } from '../hooks/useBottomInset';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { playTrackRow } from '../player/controller';
import { colors, layout, spacing } from '../theme';
import { TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../tv';
import {
  assertDiscoverRouteCallbacks,
  catalogTestIdSegment,
  playbackSelection,
  trackContextKey,
  type DiscoverRouteCallbacks,
} from './catalogModel';
import { catalogFailureMessage } from './catalogFeedback';
import { catalogStrings } from './catalogStrings';
import { resolveDiscoverPlaylistsSection } from './discoverPlaylistsModel';

export type DiscoverScreenProps = DiscoverRouteCallbacks;
export type {
  AlbumRouteParams,
  ArtistRouteParams,
  GenreRouteParams,
  PublicPlaylistRouteParams,
} from './catalogModel';

const EMPTY_TRACKS: readonly Track[] = [];
const EMPTY_ALBUMS: readonly AlbumSummary[] = [];
const EMPTY_GENRES: readonly Genre[] = [];

export default function DiscoverScreen(props: DiscoverScreenProps) {
  assertDiscoverRouteCallbacks(props);
  const { onOpenAlbum, onOpenArtist, onOpenGenre, onOpenPlaylist } = props;
  const { user } = useAuth();
  if (user === null) throw new Error('DiscoverScreen requires an authenticated user');

  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const isFocused = useIsFocused();
  const tv = useTvEnvironment();
  const reducedMotion = useReducedMotion();
  useTvFocusReturn({ scope: 'discover', active: isFocused, enabled: tv.isTv });
  const charts = useQuery(musicQueries.charts());
  const genres = useQuery(musicQueries.genres());
  const releases = useQuery(musicQueries.newReleases());
  const ownPlaylists = useQuery(musicQueries.playlists(scope));
  const communityPlaylists = useQuery(musicQueries.publicPlaylists(scope));
  const playlistsModel = useMemo(
    () =>
      resolveDiscoverPlaylistsSection(
        {
          data: ownPlaylists.data,
          isPending: ownPlaylists.isPending,
          isFetching: ownPlaylists.isFetching,
          isStale: ownPlaylists.isStale,
          fetchStatus: ownPlaylists.fetchStatus,
          error: ownPlaylists.error,
        },
        {
          data: communityPlaylists.data,
          isPending: communityPlaylists.isPending,
          isFetching: communityPlaylists.isFetching,
          isStale: communityPlaylists.isStale,
          fetchStatus: communityPlaylists.fetchStatus,
          error: communityPlaylists.error,
        },
      ),
    [
      ownPlaylists.data,
      ownPlaylists.isPending,
      ownPlaylists.isFetching,
      ownPlaylists.isStale,
      ownPlaylists.fetchStatus,
      ownPlaylists.error,
      communityPlaylists.data,
      communityPlaylists.isPending,
      communityPlaylists.isFetching,
      communityPlaylists.isStale,
      communityPlaylists.fetchStatus,
      communityPlaylists.error,
    ],
  );
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Partial<Record<string, number>>>({});
  const bottomInset = useBottomInset();

  const refresh = useCallback(() => {
    setManualRefreshing(true);
    void Promise.allSettled([
      charts.refetch(),
      genres.refetch(),
      releases.refetch(),
      ownPlaylists.refetch(),
      communityPlaylists.refetch(),
    ]).finally(() => setManualRefreshing(false));
  }, [charts, communityPlaylists, genres, ownPlaylists, releases]);

  const jumpToSection = (id: string) => {
    const offset = sectionOffsets.current[id];
    if (scroll.current === null || offset === undefined) {
      throw new Error(`Discover section ${id} is not laid out yet`);
    }
    scroll.current.scrollTo({ y: Math.max(0, offset - spacing.lg), animated: !reducedMotion });
  };
  const shortcuts = [
    { id: 'charts', title: catalogStrings.discover.charts },
    { id: 'new-releases', title: catalogStrings.discover.newReleases },
    { id: 'playlists', title: catalogStrings.discover.playlists },
    { id: 'genres', title: catalogStrings.discover.genres },
  ];

  const chartTracks = charts.data ?? EMPTY_TRACKS;
  const releaseAlbums = releases.data ?? EMPTY_ALBUMS;
  const genreItems = genres.data ?? EMPTY_GENRES;

  const playChartTrack = useCallback((tracks: readonly Track[], index: number) => {
    let selected: ReturnType<typeof playbackSelection>;
    try {
      selected = playbackSelection([...tracks], index);
    } catch (error) {
      setRuntimeError(catalogFailureMessage('playback', error));
      return;
    }
    setRuntimeError(null);
    void playTrackRow(selected.tracks, selected.startIndex, {
      context: { type: 'chart', id: 'discover', label: catalogStrings.discover.charts },
    }).catch((error) =>
      setRuntimeError(catalogFailureMessage('playback', error)),
    );
  }, []);

  const contentStyle = tv.isTv
    ? [
        styles.content,
        {
          gap: tv.sectionGap,
          paddingBottom: bottomInset,
        },
      ]
    : [styles.content, { paddingBottom: bottomInset }];
  const tvRailStyle = tv.isTv
    ? { gap: tv.gridGap, paddingHorizontal: tv.contentPaddingHorizontal }
    : undefined;

  return (
    <TvFocusScope scope="discover">
      <View testID="discover-screen" style={styles.container}>
        <ScrollView
          ref={scroll}
          testID="discover-scroll"
          refreshControl={
            <RefreshControl
              refreshing={manualRefreshing}
              onRefresh={refresh}
              accessibilityLabel={catalogStrings.common.refreshing}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surfaceElevated}
            />
          }
          contentContainerStyle={contentStyle}
        >
          <ScreenHeader
            titleTestID="discover-title"
            title={catalogStrings.discover.title}
            style={tv.isTv ? { paddingHorizontal: tv.contentPaddingHorizontal } : styles.gutter}
          />
          <ScrollView
            testID="discover-shortcuts"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={
              tv.isTv
                ? { gap: spacing.sm, paddingHorizontal: tv.contentPaddingHorizontal }
                : styles.shortcuts
            }
          >
            {shortcuts.map(({ id, title }) => (
              <FilterChip
                key={id}
                testID={`discover-jump-${id}`}
                label={title}
                accessibilityLabel={catalogStrings.discover.jumpToSection(title)}
                onPress={() => jumpToSection(id)}
              />
            ))}
          </ScrollView>
          <CatalogRuntimeError id="discover" message={runtimeError} />

          <CatalogSection
            id="charts"
            onLayout={({ nativeEvent }) => { sectionOffsets.current.charts = nativeEvent.layout.y; }}
            title={catalogStrings.discover.charts}
            skeleton="tracks"
            hasData={charts.data !== undefined}
            empty={(charts.data?.length ?? 0) === 0}
            isPending={charts.isPending}
            isFetching={charts.isFetching}
            isStale={charts.isStale}
            fetchStatus={charts.fetchStatus}
            error={charts.error}
            onRetry={() => void charts.refetch()}
          >
            <HorizontalCatalogRail
              id="discover-charts"
              data={chartTracks}
              contentContainerStyle={tvRailStyle}
              keyExtractor={(track, index) => `${track.id}:${index}`}
              renderItem={(track, index) => (
                <CatalogTrackCard
                  track={track}
                  rank={index + 1}
                  testID={`discover-chart-${trackContextKey(track, index)}`}
                  occurrence={{
                    queueContext: { type: 'chart', id: 'discover' },
                    originalContextOrder: index,
                  }}
                  onPress={() => playChartTrack(chartTracks, index)}
                  onLongPress={() =>
                    showTrackActions(track, (message) => setRuntimeError(message))
                  }
                  onOpenAlbum={onOpenAlbum}
                  onOpenArtist={onOpenArtist}
                />
              )}
            />
          </CatalogSection>

          <CatalogSection
            id="new-releases"
            onLayout={({ nativeEvent }) => { sectionOffsets.current['new-releases'] = nativeEvent.layout.y; }}
            title={catalogStrings.discover.newReleases}
            skeleton="rail"
            hasData={releases.data !== undefined}
            empty={(releases.data?.length ?? 0) === 0}
            isPending={releases.isPending}
            isFetching={releases.isFetching}
            isStale={releases.isStale}
            fetchStatus={releases.fetchStatus}
            error={releases.error}
            onRetry={() => void releases.refetch()}
          >
            <HorizontalCatalogRail
              id="discover-new-releases"
              data={releaseAlbums}
              contentContainerStyle={tvRailStyle}
              keyExtractor={(album) => album.id}
              renderItem={(album) => (
                <CatalogAlbumCard
                  album={album}
                  cardSize={tv.isTv ? tv.cardSize : undefined}
                  testID={`discover-album-${catalogTestIdSegment(album.id)}`}
                  onPress={() => onOpenAlbum({ albumId: album.id, title: album.title })}
                />
              )}
            />
          </CatalogSection>

          <CatalogSection
            id="playlists"
            onLayout={({ nativeEvent }) => { sectionOffsets.current.playlists = nativeEvent.layout.y; }}
            title={catalogStrings.discover.playlists}
            skeleton="playlists"
            {...playlistsModel.state}
            empty={playlistsModel.empty}
            onRetry={() => {
              void Promise.allSettled([ownPlaylists.refetch(), communityPlaylists.refetch()]);
            }}
          >
            <HorizontalCatalogRail
              id="discover-playlists"
              data={playlistsModel.entries}
              contentContainerStyle={tvRailStyle}
              keyExtractor={({ playlist }) => String(playlist.id)}
              renderItem={({ playlist, own }) => (
                <CatalogPlaylistCard
                  playlist={playlist}
                  own={own}
                  coverUrl={
                    playlist.cover_url === null
                      ? null
                      : resolveServerUrl(playlist.cover_url, apiBase)
                  }
                  testID={`discover-playlist-${catalogTestIdSegment(playlist.id)}`}
                  onPress={() => onOpenPlaylist({ playlistId: playlist.id, name: playlist.name })}
                />
              )}
            />
          </CatalogSection>

          <CatalogSection
            id="genres"
            onLayout={({ nativeEvent }) => { sectionOffsets.current.genres = nativeEvent.layout.y; }}
            title={catalogStrings.discover.genres}
            skeleton="genres"
            hasData={genres.data !== undefined}
            empty={(genres.data?.length ?? 0) === 0}
            isPending={genres.isPending}
            isFetching={genres.isFetching}
            isStale={genres.isStale}
            fetchStatus={genres.fetchStatus}
            error={genres.error}
            onRetry={() => void genres.refetch()}
          >
            <GenreTileGrid
              testID="discover-genre-grid"
              genres={genreItems}
              tileTestID={(genre) => `discover-genre-${catalogTestIdSegment(genre.id)}`}
              tileAccessibilityLabel={(genre) => catalogStrings.common.openGenre(genre.name)}
              onOpenGenre={(genre) => onOpenGenre({ genreId: genre.id, name: genre.name })}
            />
          </CatalogSection>
        </ScrollView>
      </View>
    </TvFocusScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: layout.sectionGap, paddingTop: spacing.md },
  gutter: { paddingHorizontal: layout.pagePadding },
  shortcuts: { gap: spacing.xs, paddingHorizontal: layout.pagePadding },
});
