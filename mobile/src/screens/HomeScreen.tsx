import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { HomeShelf, Track } from '../api/types';
import { resolveServerUrl } from '../api/url';
import { CatalogPlaylistCard } from '../components/catalog/CatalogCards';
import AppIcon from '../components/AppIcon';
import {
  HomeAlbumCard,
  HomeGenreCard,
  HomeRecentCard,
  HomeShelfCard,
  HomeTrackCard,
} from '../components/home/HomeCards';
import { HomeSection, HorizontalShelf } from '../components/home/HorizontalShelf';
import { showTrackActions } from '../components/trackActions';
import { getCurrentApiBase } from '../config';
import {
  countUnseenReleaseRadarTracks,
  musicCacheScope,
  musicQueries,
  readReleaseRadarSeenTrackIds,
  releaseRadarSeenStorageKey,
  releaseRadarTrackIds,
} from '../data';
import { useAuth } from '../auth/AuthContext';
import { strings } from '../localization';
import { playTracks } from '../player/controller';
import { reportPlayerError } from '../player/errors';
import type { QueueContext } from '../player/queueContract';
import { colors, metrics } from '../theme';
import {
  HOME_MOODS,
  assertHomeRouteCallbacks,
  greetingKeyForHour,
  homeAlbumRoute,
  homeDisplayName,
  homeGenreRoute,
  homeMixRoute,
  homePlaylistRoute,
  homeQueueContext,
  homeRecentShelf,
  testIdSegment,
  type HomeMoodKey,
  type HomeRouteCallbacks,
} from './homeModel';
import { catalogFailureMessage } from './catalogFeedback';
import { startRecentlyHeardPlayback } from './homePlayback';

export type HomeScreenProps = HomeRouteCallbacks;
export type {
  HomeAlbumRouteParams,
  HomeArtistRouteParams,
  HomeGenreRouteParams,
  HomeMixRouteParams,
  HomePlaylistRouteParams,
} from './homeModel';

function errorOf(error: unknown): Error | null {
  if (error === null || error === undefined) return null;
  return error instanceof Error ? error : new Error(String(error));
}

function playableShelves(shelves: HomeShelf[] | undefined): HomeShelf[] {
  return (shelves ?? []).filter((shelf) => shelf.tracks.length > 0);
}

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
  const [moodKey, setMoodKey] = useState<HomeMoodKey>('top');
  const [recentPlaybackIndex, setRecentPlaybackIndex] = useState<number | null>(null);
  const [seenRadarTrackIds, setSeenRadarTrackIds] = useState<readonly string[]>([]);
  const [loadedRadarSeenKey, setLoadedRadarSeenKey] = useState<string | null>(null);
  const [radarSeenError, setRadarSeenError] = useState<string | null>(null);
  const recentPlaybackInFlight = useRef(false);
  const activeMood = HOME_MOODS.find((mood) => mood.key === moodKey);
  if (activeMood === undefined) throw new Error(`Unsupported home mood ${moodKey}`);
  const topSelected = activeMood.tag === null;
  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const radarSeenKey = releaseRadarSeenStorageKey(scope);
  const queryClient = useQueryClient();

  const stats = useQuery({ ...musicQueries.stats(scope), enabled: topSelected });
  const mixes = useQuery({ ...musicQueries.homeMixes(scope), enabled: topSelected });
  const radar = useQuery({ ...musicQueries.releaseRadar(scope), enabled: topSelected });
  const because = useQuery({ ...musicQueries.becauseYouListened(scope), enabled: topSelected });
  const collections = useQuery({ ...musicQueries.homeChartCollections(), enabled: topSelected });
  const charts = useQuery({ ...musicQueries.charts(), enabled: topSelected });
  const releases = useQuery({ ...musicQueries.newReleases(), enabled: topSelected });
  const publicPlaylists = useQuery({
    ...musicQueries.publicPlaylists(scope),
    enabled: topSelected,
  });
  const genres = useQuery({ ...musicQueries.genres(), enabled: topSelected });
  const mood = useQuery({
    ...musicQueries.mood(activeMood.tag ?? 'inactive'),
    enabled: activeMood.tag !== null,
  });

  const greetingKey = greetingKeyForHour(new Date().getHours());
  const greeting = strings.home.greeting(strings.home[greetingKey], homeDisplayName(user.display_name));
  const moodLabel = strings.home.moods[moodKey];
  const mixShelves = playableShelves(mixes.data);
  const becauseShelves = playableShelves(because.data);
  const chartShelves = playableShelves(collections.data);
  const radarTracks = radar.data ?? [];
  const radarIds = releaseRadarTrackIds(radarTracks);
  const unseenRadarCount =
    loadedRadarSeenKey === radarSeenKey
      ? countUnseenReleaseRadarTracks(radarIds, seenRadarTrackIds)
      : 0;
  const radarShelf: HomeShelf = {
    key: 'release-radar',
    title: strings.home.releaseRadar,
    subtitle: strings.home.radarSubtitle,
    cover: radarTracks.find((track) => track.cover)?.cover ?? '',
    tracks: radarTracks,
  };
  const recent = stats.data?.recent ?? [];
  const recentShelf = homeRecentShelf(recent);
  const activeQueries = topSelected
    ? [stats, mixes, radar, because, collections, charts, releases, publicPlaylists, genres]
    : [mood];
  const refreshing = activeQueries.some((query) => query.isFetching && !query.isPending);

  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    void readReleaseRadarSeenTrackIds(AsyncStorage, scope)
      .then((ids) => {
        if (!active) return;
        setSeenRadarTrackIds(ids);
        setLoadedRadarSeenKey(radarSeenKey);
        setRadarSeenError(null);
      })
      .catch((error) => {
        if (!active) return;
        setSeenRadarTrackIds([]);
        setLoadedRadarSeenKey(null);
        setRadarSeenError(catalogFailureMessage('radar-seen-state', error));
      });
    return () => { active = false; };
  }, [isFocused, radarSeenKey, scope]);

  const refresh = () => {
    void Promise.allSettled(activeQueries.map((query) => query.refetch()));
  };

  const playContext = (tracks: Track[], index: number, context: QueueContext) => {
    if (tracks.length === 0 || index < 0 || index >= tracks.length) {
      throw new Error(`Invalid home playback context (${tracks.length} tracks, index ${index})`);
    }
    void playTracks(tracks, index, { context }).catch((error) =>
      reportPlayerError(strings.home.playFailed, error),
    );
  };

  const playRecent = (index: number) => {
    if (recentPlaybackInFlight.current) return;
    recentPlaybackInFlight.current = true;
    setRecentPlaybackIndex(index);
    void startRecentlyHeardPlayback({
      recent,
      startIndex: index,
      contextId: user.id,
      contextLabel: strings.queue.recentContext,
      resolveTrack: (id) => queryClient.fetchQuery(musicQueries.track(id)),
      startPlayback: playTracks,
    })
      .catch((error) => reportPlayerError(strings.home.playFailed, error))
      .finally(() => {
        recentPlaybackInFlight.current = false;
        setRecentPlaybackIndex(null);
      });
  };

  const chips = useMemo(
    () => HOME_MOODS.map((entry) => ({ ...entry, label: strings.home.moods[entry.key] })),
    [],
  );

  return (
    <View testID="home-screen" style={styles.container}>
      <ScrollView
        testID="home-scroll"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            accessibilityLabel={strings.home.sectionRefreshing}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={styles.content}
      >
        <View style={styles.hero}>
          <View style={styles.heroHeader}>
            <Text testID="home-greeting" accessibilityRole="header" style={styles.greeting}>{greeting}</Text>
            <Pressable
              testID="home-search-action"
              accessibilityRole="button"
              accessibilityLabel={strings.navigation.search}
              onPress={onOpenSearch}
              style={({ pressed }) => [styles.searchAction, pressed && styles.pressed]}
            >
              <AppIcon name="magnify" color={colors.accentSoft} size={22} />
            </Pressable>
          </View>
          <Text style={styles.heroSubtitle}>{strings.home.subtitle}</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          accessibilityRole="tablist"
        >
          {chips.map((chip) => {
            const selected = chip.key === moodKey;
            return (
              <Pressable
                key={chip.key}
                testID={`home-mood-${chip.key}`}
                accessibilityRole="tab"
                accessibilityLabel={chip.label}
                accessibilityState={{ selected }}
                onPress={() => setMoodKey(chip.key)}
                style={({ pressed }) => [
                  styles.chip,
                  selected && styles.chipSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{chip.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {!topSelected ? (
          <HomeSection
            id="mood"
            title={strings.home.moodResults(moodLabel)}
            hasData={mood.data !== undefined}
            pending={mood.isPending}
            fetching={mood.isFetching}
            fetchStatus={mood.fetchStatus}
            stale={mood.isStale}
            error={errorOf(mood.error)}
            empty={mood.data?.length === 0}
            onRetry={() => void mood.refetch()}
          >
            <HorizontalShelf
              id={`mood-${activeMood.key}`}
              data={mood.data ?? []}
              keyExtractor={(track, index) => `${track.id}:${index}`}
              renderItem={(track, index) => {
                const context = homeQueueContext({
                  kind: 'mood',
                  moodKey: activeMood.key,
                  label: strings.home.moodResults(moodLabel),
                });
                return (
                  <HomeTrackCard
                    track={track}
                    testID={`home-track-mood-${testIdSegment(track.id)}-${index}`}
                    occurrence={{ queueContext: context, originalContextOrder: index }}
                    onPress={() => playContext(mood.data ?? [], index, context)}
                    onLongPress={() => showTrackActions(track, (message) => reportPlayerError(strings.home.playFailed, new Error(message)))}
                    onOpenAlbum={onOpenAlbum}
                    onOpenArtist={onOpenArtist}
                  />
                );
              }}
            />
          </HomeSection>
        ) : (
          <>
            <HomeSection
              id="recently-heard"
              title={strings.home.recentlyHeard}
              hasData={stats.data !== undefined}
              pending={stats.isPending}
              fetching={stats.isFetching}
              fetchStatus={stats.fetchStatus}
              stale={stats.isStale}
              error={errorOf(stats.error)}
              empty={stats.data?.recent.length === 0}
              onRetry={() => void stats.refetch()}
            >
              <HorizontalShelf
                id="recently-heard"
                data={recentShelf}
                keyExtractor={(play, index) => `${play.id}:${index}`}
                renderItem={(play, index) => {
                  const testID = `home-track-recent-${testIdSegment(play.id)}-${index}`;
                  return (
                    <HomeRecentCard
                      play={play}
                      testID={testID}
                      occurrence={{
                        queueContext: { type: 'recent', id: String(user.id) },
                        originalContextOrder: index,
                      }}
                      busy={recentPlaybackIndex === index}
                      disabled={recentPlaybackIndex !== null}
                      onPlay={() => playRecent(index)}
                      onOpenAlbum={onOpenAlbum}
                      onOpenArtist={onOpenArtist}
                    />
                  );
                }}
              />
            </HomeSection>

            <HomeSection
              id="mixes"
              title={strings.home.mixes}
              hasData={mixes.data !== undefined}
              pending={mixes.isPending}
              fetching={mixes.isFetching}
              fetchStatus={mixes.fetchStatus}
              stale={mixes.isStale}
              error={errorOf(mixes.error)}
              empty={mixes.data !== undefined && mixShelves.length === 0}
              onRetry={() => void mixes.refetch()}
            >
              <HorizontalShelf
                id="mixes"
                data={mixShelves}
                keyExtractor={(shelf) => shelf.key}
                renderItem={(shelf) => (
                  <HomeShelfCard
                    shelf={shelf}
                    testID={`home-shelf-card-mixes-${testIdSegment(shelf.key)}`}
                    action="open"
                    onPress={() => onOpenMix(homeMixRoute(shelf))}
                  />
                )}
              />
            </HomeSection>

            <HomeSection
              id="release-radar"
              title={strings.home.releaseRadar}
              hasData={radar.data !== undefined}
              pending={radar.isPending}
              fetching={radar.isFetching}
              fetchStatus={radar.fetchStatus}
              stale={radar.isStale}
              error={errorOf(radar.error)}
              empty={radar.data?.length === 0}
              onRetry={() => void radar.refetch()}
            >
              <HorizontalShelf
                id="release-radar"
                data={[radarShelf]}
                keyExtractor={(shelf) => shelf.key}
                renderItem={(shelf) => (
                  <HomeShelfCard
                    shelf={shelf}
                    testID="home-shelf-card-release-radar"
                    action="open"
                    highlighted={unseenRadarCount > 0}
                    statusBadge={
                      unseenRadarCount > 0
                        ? strings.home.radarNewCount(unseenRadarCount)
                        : undefined
                    }
                    onPress={onOpenRadar}
                  />
                )}
              />
              {radarSeenError ? (
                <Text
                  testID="home-release-radar-seen-error"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={styles.storageWarning}
                >
                  {radarSeenError}
                </Text>
              ) : null}
            </HomeSection>

            <HomeSection
              id="because-you-listened"
              title={strings.home.becauseYouListened}
              hasData={because.data !== undefined}
              pending={because.isPending}
              fetching={because.isFetching}
              fetchStatus={because.fetchStatus}
              stale={because.isStale}
              error={errorOf(because.error)}
              empty={because.data !== undefined && becauseShelves.length === 0}
              onRetry={() => void because.refetch()}
            >
              <HorizontalShelf
                id="because-you-listened"
                data={becauseShelves}
                keyExtractor={(shelf) => shelf.key}
                renderItem={(shelf) => (
                  <HomeShelfCard
                    shelf={shelf}
                    testID={`home-shelf-card-because-${testIdSegment(shelf.key)}`}
                    onPress={() =>
                      playContext(
                        shelf.tracks,
                        0,
                        homeQueueContext({ kind: 'because', shelf }),
                      )
                    }
                  />
                )}
              />
            </HomeSection>

            <HomeSection
              id="chart-collections"
              title={strings.home.chartCollections}
              hasData={collections.data !== undefined}
              pending={collections.isPending}
              fetching={collections.isFetching}
              fetchStatus={collections.fetchStatus}
              stale={collections.isStale}
              error={errorOf(collections.error)}
              empty={collections.data !== undefined && chartShelves.length === 0}
              onRetry={() => void collections.refetch()}
            >
              <HorizontalShelf
                id="chart-collections"
                data={chartShelves}
                keyExtractor={(shelf) => shelf.key}
                renderItem={(shelf) => (
                  <HomeShelfCard
                    shelf={shelf}
                    testID={`home-shelf-card-chart-${testIdSegment(shelf.key)}`}
                    onPress={() =>
                      playContext(
                        shelf.tracks,
                        0,
                        homeQueueContext({ kind: 'chart-collection', shelf }),
                      )
                    }
                  />
                )}
              />
            </HomeSection>

            <HomeSection
              id="charts"
              title={strings.home.charts}
              hasData={charts.data !== undefined}
              pending={charts.isPending}
              fetching={charts.isFetching}
              fetchStatus={charts.fetchStatus}
              stale={charts.isStale}
              error={errorOf(charts.error)}
              empty={charts.data?.length === 0}
              onRetry={() => void charts.refetch()}
            >
              <HorizontalShelf
                id="charts"
                data={charts.data ?? []}
                keyExtractor={(track, index) => `${track.id}:${index}`}
                renderItem={(track, index) => {
                  const context = homeQueueContext({
                    kind: 'charts',
                    label: strings.home.charts,
                  });
                  return (
                    <HomeTrackCard
                      track={track}
                      testID={`home-track-charts-${testIdSegment(track.id)}-${index}`}
                      occurrence={{ queueContext: context, originalContextOrder: index }}
                      onPress={() => playContext(charts.data ?? [], index, context)}
                      onLongPress={() => showTrackActions(track, (message) => reportPlayerError(strings.home.playFailed, new Error(message)))}
                      onOpenAlbum={onOpenAlbum}
                      onOpenArtist={onOpenArtist}
                    />
                  );
                }}
              />
            </HomeSection>

            <HomeSection
              id="new-releases"
              title={strings.home.newReleases}
              hasData={releases.data !== undefined}
              pending={releases.isPending}
              fetching={releases.isFetching}
              fetchStatus={releases.fetchStatus}
              stale={releases.isStale}
              error={errorOf(releases.error)}
              empty={releases.data?.length === 0}
              onRetry={() => void releases.refetch()}
            >
              <HorizontalShelf
                id="new-releases"
                data={releases.data ?? []}
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
              hasData={publicPlaylists.data !== undefined}
              pending={publicPlaylists.isPending}
              fetching={publicPlaylists.isFetching}
              fetchStatus={publicPlaylists.fetchStatus}
              stale={publicPlaylists.isStale}
              error={errorOf(publicPlaylists.error)}
              empty={publicPlaylists.data?.length === 0}
              onRetry={() => void publicPlaylists.refetch()}
            >
              <HorizontalShelf
                id="community-playlists"
                data={publicPlaylists.data ?? []}
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
              hasData={genres.data !== undefined}
              pending={genres.isPending}
              fetching={genres.isFetching}
              fetchStatus={genres.fetchStatus}
              stale={genres.isStale}
              error={errorOf(genres.error)}
              empty={genres.data?.length === 0}
              onRetry={() => void genres.refetch()}
            >
              <HorizontalShelf
                id="genres"
                data={genres.data ?? []}
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
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: 28, paddingTop: 22, paddingBottom: 144 },
  storageWarning: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 16,
  },
  hero: { gap: 5, paddingHorizontal: 16 },
  heroHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  greeting: { flex: 1, color: colors.textPrimary, fontSize: 30, lineHeight: 36, fontWeight: '900' },
  searchAction: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: metrics.minimumTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  heroSubtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 21 },
  chips: { gap: 8, paddingHorizontal: 16 },
  chip: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 17,
    borderRadius: 24,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  chipTextSelected: { color: colors.onAccent },
  pressed: { opacity: 0.72 },
});
