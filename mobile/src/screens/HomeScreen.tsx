import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { HomeShelf } from '../api/types';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import AppIcon from '../components/AppIcon';
import { CatalogPlaylistCard } from '../components/catalog/CatalogCards';
import { HomeAlbumCard, HomeGenreCard } from '../components/home/HomeCards';
import {
  HomeQuickGrid,
  HomeQuickGridSkeleton,
  HomeRecentCard,
} from '../components/home/HomeQuickGrid';
import { HomeRadarCard, HomeRadarCardSkeleton } from '../components/home/HomeRadarCard';
import { HomeShelfRail, HomeTrackRail } from '../components/home/HomeRails';
import { HomeSection } from '../components/home/HomeSection';
import { HorizontalShelf } from '../components/home/HorizontalShelf';
import { ActionButton, AppText, FilterChip, ScreenHeader } from '../components/ui';
import { getCurrentApiBase } from '../config';
import { musicCacheScope } from '../data';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { colors, layout, metrics, opacity, radii, spacing } from '../theme';
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

  const [moodKey, setMoodKey] = useState<HomeMoodKey>('top');
  const activeMood = HOME_MOODS.find((mood) => mood.key === moodKey);
  if (activeMood === undefined) throw new Error(`Unsupported home mood ${moodKey}`);
  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const bottomInset = useBottomInset();

  const feed = useHomeFeed(scope, activeMood.tag);
  const recent = feed.stats.data?.recent ?? [];
  const radarTracks = feed.radar.data ?? [];
  const radarUnseen = useReleaseRadarUnseen(scope, radarTracks);
  const playback = useHomePlayback(recent, user.id);

  const greeting = strings.home.greeting(
    strings.home[greetingKeyForHour(new Date().getHours())],
    homeDisplayName(user.display_name),
  );
  const moodTitle = strings.home.moodResults(strings.home.moods[moodKey]);
  const mixShelves = playableHomeShelves(feed.mixes.data);
  const becauseShelves = playableHomeShelves(feed.because.data);
  const chartShelves = playableHomeShelves(feed.collections.data);
  const radarShelf: HomeShelf = {
    key: 'release-radar',
    title: strings.home.releaseRadar,
    subtitle: strings.home.radarSubtitle,
    cover: radarTracks.find((track) => track.cover)?.cover ?? '',
    tracks: radarTracks,
  };

  const renderDiscovery = () => {
    const chartTracks = feed.charts.data ?? [];
    const chartsContext = homeQueueContext({ kind: 'charts', label: strings.home.charts });
    return (
      <>
        <HomeSection
          id="recently-heard"
          title={strings.home.continueListening}
          {...feed.stats.state}
          empty={feed.stats.data?.recent.length === 0}
          skeleton={HomeQuickGridSkeleton}
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
            data={homeRecentShelf(recent, HOME_QUICK_GRID_LIMIT)}
            keyExtractor={(play, index) => `${play.id}:${index}`}
            renderItem={(play, index) => (
              <HomeRecentCard
                play={play}
                testID={`home-track-recent-${testIdSegment(play.id)}-${index}`}
                occurrence={{
                  queueContext: { type: 'recent', id: String(user.id) },
                  originalContextOrder: index,
                }}
                busy={playback.recentPlaybackIndex === index}
                disabled={playback.recentPlaybackIndex !== null}
                onPlay={() => playback.playRecent(index)}
                onOpenAlbum={onOpenAlbum}
                onOpenArtist={onOpenArtist}
              />
            )}
          />
        </HomeSection>

        <HomeSection
          id="mixes"
          title={strings.home.mixes}
          {...feed.mixes.state}
          empty={feed.mixes.data !== undefined && mixShelves.length === 0}
        >
          <HomeShelfRail
            id="mixes"
            testIdPrefix="home-shelf-card-mixes"
            shelves={mixShelves}
            action="open"
            onPress={(shelf) => onOpenMix(homeMixRoute(shelf))}
          />
        </HomeSection>

        <HomeSection
          id="release-radar"
          title={strings.home.releaseRadar}
          {...feed.radar.state}
          empty={feed.radar.data?.length === 0}
          skeleton={HomeRadarCardSkeleton}
          emptyIcon="radar"
          emptyTitle={strings.home.radarEmptyTitle}
          emptyMessage={strings.home.radarEmpty}
        >
          <HomeRadarCard
            shelf={radarShelf}
            testID="home-shelf-card-release-radar"
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
              style={styles.gutter}
            >
              {radarUnseen.error}
            </AppText>
          ) : null}
        </HomeSection>

        <HomeSection
          id="because-you-listened"
          title={strings.home.becauseYouListened}
          {...feed.because.state}
          empty={feed.because.data !== undefined && becauseShelves.length === 0}
        >
          <HomeShelfRail
            id="because-you-listened"
            testIdPrefix="home-shelf-card-because"
            shelves={becauseShelves}
            action="play"
            onPress={(shelf) =>
              playback.playContext(shelf.tracks, 0, homeQueueContext({ kind: 'because', shelf }))
            }
          />
        </HomeSection>

        <HomeSection
          id="chart-collections"
          title={strings.home.chartCollections}
          {...feed.collections.state}
          empty={feed.collections.data !== undefined && chartShelves.length === 0}
        >
          <HomeShelfRail
            id="chart-collections"
            testIdPrefix="home-shelf-card-chart"
            shelves={chartShelves}
            action="play"
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
          empty={feed.charts.data?.length === 0}
        >
          <HomeTrackRail
            id="charts"
            testIdPrefix="home-track-charts"
            tracks={chartTracks}
            context={chartsContext}
            onPlay={(index) => playback.playContext(chartTracks, index, chartsContext)}
            onActions={playback.showActions}
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
          />
        </HomeSection>

        <HomeSection
          id="new-releases"
          title={strings.home.newReleases}
          {...feed.releases.state}
          empty={feed.releases.data?.length === 0}
        >
          <HorizontalShelf
            id="new-releases"
            data={feed.releases.data ?? []}
            keyExtractor={(album) => album.id}
            renderItem={(album) => (
              <HomeAlbumCard
                album={album}
                testID={`home-album-${testIdSegment(album.id)}`}
                onPress={() => onOpenAlbum(homeAlbumRoute(album))}
              />
            )}
          />
        </HomeSection>

        <HomeSection
          id="community-playlists"
          title={strings.home.communityPlaylists}
          {...feed.publicPlaylists.state}
          empty={feed.publicPlaylists.data?.length === 0}
        >
          <HorizontalShelf
            id="community-playlists"
            data={feed.publicPlaylists.data ?? []}
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
                onPress={() => onOpenPlaylist(homePlaylistRoute(playlist))}
              />
            )}
          />
        </HomeSection>

        <HomeSection
          id="genres"
          title={strings.home.genres}
          {...feed.genres.state}
          empty={feed.genres.data?.length === 0}
        >
          <HorizontalShelf
            id="genres"
            data={feed.genres.data ?? []}
            keyExtractor={(genre) => genre.id}
            renderItem={(genre) => (
              <HomeGenreCard
                genre={genre}
                testID={`home-genre-${testIdSegment(genre.id)}`}
                onPress={() => onOpenGenre(homeGenreRoute(genre))}
              />
            )}
          />
        </HomeSection>
      </>
    );
  };

  const renderMood = () => {
    const tracks = feed.mood.data ?? [];
    const context = homeQueueContext({ kind: 'mood', moodKey, label: moodTitle });
    return (
      <HomeSection
        id="mood"
        title={moodTitle}
        {...feed.mood.state}
        empty={feed.mood.data?.length === 0}
      >
        <HomeTrackRail
          id={`mood-${moodKey}`}
          testIdPrefix="home-track-mood"
          tracks={tracks}
          context={context}
          onPlay={(index) => playback.playContext(tracks, index, context)}
          onActions={playback.showActions}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
        />
      </HomeSection>
    );
  };

  return (
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
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      >
        <View style={styles.intro}>
          <ScreenHeader
            title={greeting}
            titleTestID="home-greeting"
            subtitle={strings.home.subtitle}
            style={styles.header}
            action={
              <Pressable
                testID="home-search-action"
                accessibilityRole="button"
                accessibilityLabel={strings.navigation.search}
                onPress={onOpenSearch}
                style={({ pressed }) => [styles.searchAction, pressed ? styles.pressed : null]}
              >
                <AppIcon name="magnify" color={colors.textPrimary} size={24} />
              </Pressable>
            }
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            accessibilityRole="tablist"
          >
            {HOME_MOODS.map((mood) => (
              <FilterChip
                key={mood.key}
                testID={`home-mood-${mood.key}`}
                accessibilityRole="tab"
                label={strings.home.moods[mood.key]}
                selected={mood.key === moodKey}
                onPress={() => setMoodKey(mood.key)}
              />
            ))}
          </ScrollView>
        </View>

        {activeMood.tag === null ? renderDiscovery() : renderMood()}
      </ScrollView>
    </View>
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
