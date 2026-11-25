import { useIsFocused } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { AlbumSummary, Genre, HomeShelf, PlaylistSummary, Track } from '../api/types';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import AppIcon from '../components/AppIcon';
import { CatalogPlaylistCard } from '../components/catalog/CatalogCards';
import { MemoHomeAlbumCard, MemoHomeGenreCard } from '../components/home/HomeCards';
import {
  HomeQuickGrid,
  HomeQuickGridSkeleton,
  MemoHomeRecentCard,
  QUICK_GRID_COLUMNS,
} from '../components/home/HomeQuickGrid';
import { HomeRadarCardSkeleton, MemoHomeRadarCard } from '../components/home/HomeRadarCard';
import { FriendsListeningSection } from '../components/home/FriendsListeningSection';
import { PersonalMixesHomeSection } from '../components/home/PersonalMixesHomeSection';
import { HomeShelfRail, HomeTrackRail } from '../components/home/HomeRails';
import { HomeSection, type HomeSectionSkeletonProps } from '../components/home/HomeSection';
import { HorizontalShelf } from '../components/home/HorizontalShelf';
import {
  ActionButton,
  AppText,
  FilterChip,
  FocusRingOverlay,
  ScreenHeader,
  createFocusRingController,
} from '../components/ui';
import { getCurrentApiBase } from '../config';
import { musicCacheScope } from '../data';
import type { RecentPlay } from '../domain/listeningStats';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { rootNavigation } from '../navigation/rootNavigation';
import { colors, layout, metrics, opacity, radii, spacing } from '../theme';
import { TvFocusScope, tvFocusRegistry, useTvEnvironment, useTvFocusReturn } from '../tv';
import {
  HOME_MOODS,
  HOME_QUICK_GRID_LIMIT,
  assertHomeRouteCallbacks,
  greetingKeyForHour,
  homeAlbumRoute,
  homeDisplayName,
  homeGenreRoute,
  homeMixRoute,
  homePlaylistRoute,
  homeQueueContext,
  homeRecentShelf,
  playableHomeShelves,
  testIdSegment,
  type HomeMoodKey,
  type HomeRouteCallbacks,
} from './homeModel';
import { useHomeFeed } from './useHomeFeed';
import { useHomePlayback } from './useHomePlayback';
import { useReleaseRadarUnseen } from './useReleaseRadarUnseen';

export type HomeScreenProps = HomeRouteCallbacks;
export type {
  HomeAlbumRouteParams,
  HomeArtistRouteParams,
  HomeGenreRouteParams,
  HomeMixRouteParams,
  HomePlaylistRouteParams,
} from './homeModel';

const EMPTY_RECENT: readonly RecentPlay[] = [];
const EMPTY_TRACKS: readonly Track[] = [];
const EMPTY_ALBUMS: readonly AlbumSummary[] = [];
const EMPTY_PLAYLISTS: readonly PlaylistSummary[] = [];
const EMPTY_GENRES: readonly Genre[] = [];
const HOME_TV_SCOPE = 'home';
const TV_QUICK_GRID_COLUMNS = 3;

/**
 * Home: greeting with the search shortcut (the profile avatar sits in the
 * stack header right above it), the mood switcher, then either the mood rail
 * or the discovery feed — a quick grid to jump back in, followed by rails.
 */
export default function HomeScreen(props: HomeScreenProps) {
  assertHomeRouteCallbacks(props);
  const {
    onOpenAlbum,
    onOpenArtist,
    onOpenGenre,
    onOpenPlaylist,
    onOpenMix,
    onOpenRadar,
    onOpenSearch,
  } = props;
  const { user } = useAuth();
  if (user === null) throw new Error('HomeScreen requires an authenticated user');

  const isFocused = useIsFocused();
  const tv = useTvEnvironment();
  const [moodKey, setMoodKey] = useState<HomeMoodKey>('top');
  const activeMood = HOME_MOODS.find((mood) => mood.key === moodKey);
  if (activeMood === undefined) throw new Error(`Unsupported home mood ${moodKey}`);
  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const bottomInset = useBottomInset();

  const [requestedFocusKey, setRequestedFocusKey] = useState<string | null>(null);

  useEffect(() => {
    if (!tv.isTv) return;
    const unregisters = HOME_MOODS.map((mood) => {
      const key = `home-mood-${mood.key}`;
      return tvFocusRegistry.register(
        key,
        { requestFocus: () => setRequestedFocusKey(key) },
        HOME_TV_SCOPE,
      );
    });
    return () => {
      unregisters.forEach((unregister) => unregister());
    };
  }, [tv.isTv]);

  useTvFocusReturn({
    scope: HOME_TV_SCOPE,
    active: isFocused,
    fallbackKey: 'home-mood-top',
    enabled: tv.isTv,
  });

  const recordHomeFocus = useCallback(
    (focusKey: string) => {
      if (tv.isTv) tvFocusRegistry.recordFocus(focusKey, HOME_TV_SCOPE);
    },
    [tv.isTv],
  );

  const feed = useHomeFeed(scope, activeMood.tag);
  const recent = feed.stats.data?.recent ?? EMPTY_RECENT;
  const radarTracks = feed.radar.data ?? EMPTY_TRACKS;
  const radarUnseen = useReleaseRadarUnseen(scope, radarTracks);
  const playback = useHomePlayback(recent, user.id);

  const greeting = strings.home.greeting(
    strings.home[greetingKeyForHour(new Date().getHours())],
    homeDisplayName(user.display_name),
  );
  const moodTitle = strings.home.moodResults(strings.home.moods[moodKey]);
  const mixShelves = useMemo(() => playableHomeShelves(feed.mixes.data), [feed.mixes.data]);
  const becauseShelves = useMemo(
    () => playableHomeShelves(feed.because.data),
    [feed.because.data],
  );
  const chartShelves = useMemo(
    () => playableHomeShelves(feed.collections.data),
    [feed.collections.data],
  );
  const chartTracks = feed.charts.data ?? EMPTY_TRACKS;
  const releaseAlbums = feed.releases.data ?? EMPTY_ALBUMS;
  const publicPlaylists = feed.publicPlaylists.data ?? EMPTY_PLAYLISTS;
  const genres = feed.genres.data ?? EMPTY_GENRES;
  const moodTracks = feed.mood.data ?? EMPTY_TRACKS;

  const quickGridColumns = tv.isTv ? TV_QUICK_GRID_COLUMNS : QUICK_GRID_COLUMNS;
  const quickTileHeight = tv.isTv
    ? Math.max(tv.minFocusTargetHeight + spacing.md, Math.round(layout.artwork.md * 1.25))
    : layout.artwork.md;
  const tvPaddingHorizontal = tv.isTv ? tv.contentPaddingHorizontal : undefined;
  const tvRailGap = tv.isTv ? tv.gridGap : undefined;
  const tvCardSize = tv.isTv ? tv.cardSize : undefined;
  const tvGenreHeight = tv.isTv ? Math.round(layout.artwork.lg * 1.2) : undefined;
  const tvTitleStyle = tv.isTv ? tv.typography.bodyStrong : undefined;
  const tvSubtitleStyle = tv.isTv ? tv.typography.callout : undefined;
  const tvCaptionStyle = tv.isTv ? tv.typography.caption : undefined;

  const quickGridRecent = useMemo(
    () => homeRecentShelf(recent, HOME_QUICK_GRID_LIMIT),
    [recent],
  );
  const recentOccurrence = useMemo(
    () => ({ queueContext: { type: 'recent' as const, id: String(user.id) } }),
    [user.id],
  );
  const chartsContext = useMemo(
    () => homeQueueContext({ kind: 'charts', label: strings.home.charts }),
    [],
  );
  const moodContext = useMemo(
    () =>
      activeMood.tag === null
        ? null
        : homeQueueContext({ kind: 'mood', moodKey, label: moodTitle }),
    [activeMood.tag, moodKey, moodTitle],
  );
  const radarShelf: HomeShelf = useMemo(
    () => ({
      key: 'release-radar',
      title: strings.home.releaseRadar,
      subtitle: strings.home.radarSubtitle,
      cover: radarTracks.find((track) => track.cover)?.cover ?? '',
      tracks: [...radarTracks],
    }),
    [radarTracks],
  );

  const [searchFocusController] = useState(createFocusRingController);

  const renderQuickGridSkeleton = useCallback(
    (skeletonProps: HomeSectionSkeletonProps) => (
      <HomeQuickGridSkeleton
        {...skeletonProps}
        columns={quickGridColumns}
        tileHeight={quickTileHeight}
        paddingHorizontal={tvPaddingHorizontal}
        gap={tvRailGap}
      />
    ),
    [quickGridColumns, quickTileHeight, tvPaddingHorizontal, tvRailGap],
  );

  const renderRadarSkeleton = useCallback(
    (skeletonProps: HomeSectionSkeletonProps) => (
      <HomeRadarCardSkeleton {...skeletonProps} paddingHorizontal={tvPaddingHorizontal} />
    ),
    [tvPaddingHorizontal],
  );

  const openAlbumRoute = useCallback(
    (album: AlbumSummary) => {
      onOpenAlbum(homeAlbumRoute(album));
    },
    [onOpenAlbum],
  );

  const openPlaylistRoute = useCallback(
    (playlist: PlaylistSummary) => {
      onOpenPlaylist(homePlaylistRoute(playlist));
    },
    [onOpenPlaylist],
  );

  const openGenreRoute = useCallback(
    (genre: Genre) => {
      onOpenGenre(homeGenreRoute(genre));
    },
    [onOpenGenre],
  );

  const openMixRoute = useCallback(
    (shelf: HomeShelf) => {
      onOpenMix(homeMixRoute(shelf));
    },
    [onOpenMix],
  );

  const renderDiscovery = () => (
    <>
      <HomeSection
        id="recently-heard"
        title={strings.home.continueListening}
        {...feed.stats.state}
        empty={feed.stats.data?.recent.length === 0}
        skeleton={renderQuickGridSkeleton}
        paddingHorizontal={tvPaddingHorizontal}
        tvMode={tv.isTv}
        emptyIcon="headphones"
        emptyTitle={strings.home.continueEmptyTitle}
        emptyMessage={strings.home.continueEmptyMessage}
        emptyAction={
          <ActionButton
            testID="home-recently-heard-empty-search"
            variant="secondary"
            icon="magnify"
            label={strings.home.continueEmptyAction}
            onPress={onOpenSearch}
          />
        }
      >
        <HomeQuickGrid
          id="recently-heard"
          data={quickGridRecent}
          columns={quickGridColumns}
          paddingHorizontal={tvPaddingHorizontal}
          gap={tvRailGap}
          keyExtractor={(play, index) => `${play.id}:${index}`}
          renderItem={(play, index) => {
            const tileTestID = `home-track-recent-${testIdSegment(play.id)}-${index}`;
            return (
              <MemoHomeRecentCard
                play={play}
                testID={tileTestID}
                occurrence={recentOccurrence}
                busy={playback.recentPlaybackIndex === index}
                disabled={playback.recentPlaybackIndex !== null}
                tileHeight={quickTileHeight}
                titleStyle={tvTitleStyle}
                subtitleStyle={tvCaptionStyle}
                onFocus={() => recordHomeFocus(tileTestID)}
                onPlay={() => playback.playRecent(index)}
              />
            );
          }}
        />
      </HomeSection>

      <FriendsListeningSection
        scope={scope}
        onOpenParty={(code) => rootNavigation.navigate('Party', { code })}
      />

      <PersonalMixesHomeSection
        scope={scope}
        cardSize={tvCardSize}
        paddingHorizontal={tvPaddingHorizontal}
        gap={tvRailGap}
        tvMode={tv.isTv}
        onCardFocus={recordHomeFocus}
        onOpenMix={openMixRoute}
      />

      <HomeSection
        id="mixes"
        title={strings.home.mixes}
        {...feed.mixes.state}
        skeletonVariant="card"
        skeletonCardSize={tvCardSize}
        paddingHorizontal={tvPaddingHorizontal}
        tvMode={tv.isTv}
        empty={feed.mixes.data !== undefined && mixShelves.length === 0}
      >
        <HomeShelfRail
          id="mixes"
          testIdPrefix="home-shelf-card-mixes"
          shelves={mixShelves}
          action="open"
          cardSize={tvCardSize}
          paddingHorizontal={tvPaddingHorizontal}
          gap={tvRailGap}
          titleStyle={tvTitleStyle}
          subtitleStyle={tvSubtitleStyle}
          onCardFocus={recordHomeFocus}
          onPress={openMixRoute}
        />
      </HomeSection>

      <HomeSection
        id="release-radar"
        title={strings.home.releaseRadar}
        {...feed.radar.state}
        empty={feed.radar.data?.length === 0}
        skeleton={renderRadarSkeleton}
        paddingHorizontal={tvPaddingHorizontal}
        tvMode={tv.isTv}
        emptyIcon="radar"
        emptyTitle={strings.home.radarEmptyTitle}
        emptyMessage={strings.home.radarEmpty}
      >
        <MemoHomeRadarCard
          shelf={radarShelf}
          testID="home-shelf-card-release-radar"
          marginHorizontal={tvPaddingHorizontal}
          subtitleStyle={tvSubtitleStyle}
          countStyle={tvCaptionStyle}
          onFocus={() => recordHomeFocus('home-shelf-card-release-radar')}
          statusBadge={
            radarUnseen.unseenCount > 0
              ? strings.home.radarNewCount(radarUnseen.unseenCount)
              : undefined
          }
          onPress={onOpenRadar}
        />
        {radarUnseen.error ? (
          <AppText
            testID="home-release-radar-seen-error"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            variant="callout"
            color="warning"
            style={
              tvPaddingHorizontal === undefined
                ? styles.gutter
                : { paddingHorizontal: tvPaddingHorizontal }
            }
          >
            {radarUnseen.error}
          </AppText>
        ) : null}
      </HomeSection>

      <HomeSection
        id="because-you-listened"
        title={strings.home.becauseYouListened}
        {...feed.because.state}
        skeletonVariant="card"
        skeletonCardSize={tvCardSize}
        paddingHorizontal={tvPaddingHorizontal}
        tvMode={tv.isTv}
        empty={feed.because.data !== undefined && becauseShelves.length === 0}
      >
        <HomeShelfRail
          id="because-you-listened"
          testIdPrefix="home-shelf-card-because"
          shelves={becauseShelves}
          action="play"
          cardSize={tvCardSize}
          paddingHorizontal={tvPaddingHorizontal}
          gap={tvRailGap}
          titleStyle={tvTitleStyle}
          subtitleStyle={tvSubtitleStyle}
          onCardFocus={recordHomeFocus}
          onPress={(shelf) =>
            playback.playContext(shelf.tracks, 0, homeQueueContext({ kind: 'because', shelf }))
          }
        />
      </HomeSection>

      <HomeSection
        id="chart-collections"
        title={strings.home.chartCollections}
        {...feed.collections.state}
        skeletonVariant="card"
        skeletonCardSize={tvCardSize}
        paddingHorizontal={tvPaddingHorizontal}
        tvMode={tv.isTv}
        empty={feed.collections.data !== undefined && chartShelves.length === 0}
      >
        <HomeShelfRail
          id="chart-collections"
          testIdPrefix="home-shelf-card-chart"
          shelves={chartShelves}
          action="play"
          cardSize={tvCardSize}
          paddingHorizontal={tvPaddingHorizontal}
          gap={tvRailGap}
          titleStyle={tvTitleStyle}
          subtitleStyle={tvSubtitleStyle}
          onCardFocus={recordHomeFocus}
          onPress={(shelf) =>
            playback.playContext(
              shelf.tracks,
              0,
              homeQueueContext({ kind: 'chart-collection', shelf }),
            )
          }
        />
      </HomeSection>

      <HomeSection
        id="charts"
        title={strings.home.charts}
        {...feed.charts.state}
        skeletonVariant="track"
        paddingHorizontal={tvPaddingHorizontal}
        tvMode={tv.isTv}
        empty={feed.charts.data?.length === 0}
      >
        <HomeTrackRail
          id="charts"
          testIdPrefix="home-track-charts"
          tracks={chartTracks}
          context={chartsContext}
          paddingHorizontal={tvPaddingHorizontal}
          gap={tvRailGap}
          onPlay={(index) => playback.playTrackContext(chartTracks, index, chartsContext)}
          onActions={playback.showActions}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
        />
      </HomeSection>

      <HomeSection
        id="new-releases"
        title={strings.home.newReleases}
        {...feed.releases.state}
        skeletonVariant="card"
        skeletonCardSize={tvCardSize}
        paddingHorizontal={tvPaddingHorizontal}
        tvMode={tv.isTv}
        empty={feed.releases.data?.length === 0}
      >
        <HorizontalShelf
          id="new-releases"
          data={releaseAlbums}
          paddingHorizontal={tvPaddingHorizontal}
          gap={tvRailGap}
          keyExtractor={(album) => album.id}
          renderItem={(album) => {
            const albumTestId = `home-album-${testIdSegment(album.id)}`;
            return (
              <MemoHomeAlbumCard
                album={album}
                testID={albumTestId}
                cardSize={tvCardSize}
                titleStyle={tvTitleStyle}
                subtitleStyle={tvSubtitleStyle}
                onFocus={() => recordHomeFocus(albumTestId)}
                onPress={() => openAlbumRoute(album)}
              />
            );
          }}
        />
      </HomeSection>

      <HomeSection
        id="community-playlists"
        title={strings.home.communityPlaylists}
        {...feed.publicPlaylists.state}
        skeletonVariant="playlist"
        paddingHorizontal={tvPaddingHorizontal}
        tvMode={tv.isTv}
        empty={feed.publicPlaylists.data?.length === 0}
      >
        <HorizontalShelf
          id="community-playlists"
          data={publicPlaylists}
          paddingHorizontal={tvPaddingHorizontal}
          gap={tvRailGap}
          keyExtractor={(playlist) => String(playlist.id)}
          renderItem={(playlist) => (
            <CatalogPlaylistCard
              playlist={playlist}
              coverUrl={
                playlist.cover_url === null
                  ? null
                  : resolveServerUrl(playlist.cover_url, apiBase)
              }
              testID={`home-community-playlist-${testIdSegment(playlist.id)}`}
              onPress={() => openPlaylistRoute(playlist)}
            />
          )}
        />
      </HomeSection>

      <HomeSection
        id="genres"
        title={strings.home.genres}
        {...feed.genres.state}
        skeletonVariant="genre"
        skeletonCardSize={tvCardSize}
        skeletonCardHeight={tvGenreHeight}
        paddingHorizontal={tvPaddingHorizontal}
        tvMode={tv.isTv}
        empty={feed.genres.data?.length === 0}
      >
        <HorizontalShelf
          id="genres"
          data={genres}
          paddingHorizontal={tvPaddingHorizontal}
          gap={tvRailGap}
          keyExtractor={(genre) => genre.id}
          renderItem={(genre) => {
            const genreTestId = `home-genre-${testIdSegment(genre.id)}`;
            return (
              <MemoHomeGenreCard
                genre={genre}
                testID={genreTestId}
                cardWidth={tvCardSize}
                cardHeight={tvGenreHeight}
                titleStyle={tvTitleStyle}
                onFocus={() => recordHomeFocus(genreTestId)}
                onPress={() => openGenreRoute(genre)}
              />
            );
          }}
        />
      </HomeSection>
    </>
  );

  const renderMood = () => {
    if (moodContext === null) return null;
    return (
      <HomeSection
        id="mood"
        title={moodTitle}
        {...feed.mood.state}
        skeletonVariant="track"
        paddingHorizontal={tvPaddingHorizontal}
        tvMode={tv.isTv}
        empty={feed.mood.data?.length === 0}
      >
        <HomeTrackRail
          id={`mood-${moodKey}`}
          testIdPrefix="home-track-mood"
          tracks={moodTracks}
          context={moodContext}
          paddingHorizontal={tvPaddingHorizontal}
          gap={tvRailGap}
          onPlay={(index) => playback.playTrackContext(moodTracks, index, moodContext)}
          onActions={playback.showActions}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
        />
      </HomeSection>
    );
  };

  const contentContainerStyle = useMemo(
    () => [
      styles.content,
      tv.isTv ? { gap: tv.sectionGap } : null,
      { paddingBottom: bottomInset },
    ],
    [bottomInset, tv.isTv, tv.sectionGap],
  );

  return (
    <TvFocusScope scope={HOME_TV_SCOPE}>
      <View testID="home-screen" style={styles.container}>
        <ScrollView
          testID="home-scroll"
          refreshControl={
            <RefreshControl
              refreshing={feed.refreshing}
              onRefresh={feed.refresh}
              accessibilityLabel={strings.home.sectionRefreshing}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surfaceElevated}
            />
          }
          contentContainerStyle={contentContainerStyle}
        >
          <View style={styles.intro}>
            <ScreenHeader
              title={greeting}
              titleTestID="home-greeting"
              subtitle={strings.home.subtitle}
              style={
                tvPaddingHorizontal === undefined
                  ? styles.header
                  : [styles.header, { paddingHorizontal: tvPaddingHorizontal }]
              }
              action={
                <Pressable
                  testID="home-search-action"
                  accessibilityRole="button"
                  accessibilityLabel={strings.navigation.search}
                  focusable
                  onFocus={() => {
                    searchFocusController.setFocused(true);
                    recordHomeFocus('home-search-action');
                  }}
                  onBlur={() => searchFocusController.setFocused(false)}
                  onPress={onOpenSearch}
                  style={({ pressed }) => [styles.searchAction, pressed ? styles.pressed : null]}
                >
                  <AppIcon name="magnify" color={colors.textPrimary} size={24} />
                  <FocusRingOverlay
                    controller={searchFocusController}
                    borderRadius={radii.pill}
                  />
                </Pressable>
              }
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={
                tvPaddingHorizontal === undefined
                  ? styles.chips
                  : [styles.chips, { paddingHorizontal: tvPaddingHorizontal }]
              }
              accessibilityRole="tablist"
            >
              {HOME_MOODS.map((mood) => {
                const chipTestId = `home-mood-${mood.key}`;
                return (
                  <FilterChip
                    key={mood.key}
                    testID={chipTestId}
                    accessibilityRole="tab"
                    label={strings.home.moods[mood.key]}
                    selected={mood.key === moodKey}
                    hasTVPreferredFocus={
                      tv.isTv && isFocused && requestedFocusKey === chipTestId
                        ? true
                        : undefined
                    }
                    onFocus={() => {
                      setRequestedFocusKey((current) =>
                        current === chipTestId ? null : current,
                      );
                      recordHomeFocus(chipTestId);
                    }}
                    onPress={() => setMoodKey(mood.key)}
                  />
                );
              })}
            </ScrollView>
          </View>

          {activeMood.tag === null ? renderDiscovery() : renderMood()}
        </ScrollView>
      </View>
    </TvFocusScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: layout.sectionGap, paddingTop: spacing.md },
  intro: { gap: layout.stackGap },
  header: { alignItems: 'flex-start', paddingHorizontal: layout.pagePadding },
  gutter: { paddingHorizontal: layout.pagePadding },
  searchAction: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.fill,
  },
  chips: { gap: spacing.xs, paddingHorizontal: layout.pagePadding },
  pressed: { opacity: opacity.pressed },
});
