import React, { useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RadioQueryStation,
  RadioSection,
  RadioStationCard,
} from '../components/radio/RadioCards';
import AppIcon from '../components/AppIcon';
import { DEFAULT_API_BASE, normalizeApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
import type { RemoteFetchStatus } from '../data/remoteState';
import { useAuth } from '../auth/AuthContext';
import { strings } from '../localization';
import { playTracks, startRadio } from '../player/controller';
import { colors, metrics } from '../theme';
import {
  RADIO_MOODS,
  orderedUniqueRadioTracks,
  personalStationIds,
  radioContentState,
} from './radioModel';

function combinedFetchStatus(
  queries: readonly { fetchStatus: RemoteFetchStatus }[],
): RemoteFetchStatus {
  if (queries.some((query) => query.fetchStatus === 'paused')) return 'paused';
  if (queries.some((query) => query.fetchStatus === 'fetching')) return 'fetching';
  return 'idle';
}

export default function RadioScreen() {
  const { user } = useAuth();
  if (user === null) throw new Error('RadioScreen requires an authenticated user');

  const queryClient = useQueryClient();
  const scope = musicCacheScope(normalizeApiBase(DEFAULT_API_BASE), user.id);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const stats = useQuery(musicQueries.stats(scope));
  const genres = useQuery(musicQueries.genres());
  const personalIds = useMemo(() => personalStationIds(stats.data?.recent ?? []), [stats.data?.recent]);
  const personalTracks = useQueries({
    queries: personalIds.map((id) => musicQueries.track(id)),
  });
  const moodTracks = useQueries({
    queries: RADIO_MOODS.map((mood) => musicQueries.mood(mood.tag)),
  });

  const resolvedPersonal = personalIds.flatMap((id, index) => {
    const track = personalTracks[index]?.data;
    return track === undefined ? [] : [{ id, track }];
  });
  const personalQueries = [stats, ...personalTracks];
  const personalError = stats.error
    ?? personalTracks.find((query) => query.error !== null)?.error
    ?? null;
  const personalHasData = stats.data !== undefined
    && (personalIds.length === 0 || resolvedPersonal.length > 0);
  const personalState = radioContentState({
    hasData: personalHasData,
    empty: personalHasData && resolvedPersonal.length === 0,
    pending: personalQueries.some((query) => query.isPending),
    fetching: personalQueries.some((query) => query.isFetching),
    stale: personalQueries.some((query) => query.isStale),
    fetchStatus: combinedFetchStatus(personalQueries),
    error: personalError,
  });
  const genreState = radioContentState({
    hasData: genres.data !== undefined,
    empty: genres.data !== undefined && genres.data.length === 0,
    pending: genres.isPending,
    fetching: genres.isFetching,
    stale: genres.isStale,
    fetchStatus: genres.fetchStatus,
    error: genres.error,
  });
  const everyQuery = [stats, genres, ...personalTracks, ...moodTracks];
  const refreshing = everyQuery.some((query) => query.isFetching && !query.isPending);
  const blocked = startingKey !== null;

  const refresh = () => {
    void Promise.allSettled(everyQuery.map((query) => query.refetch()));
  };

  const runStation = async (key: string, title: string, action: () => Promise<void>) => {
    if (startingKey !== null) return;
    setStartingKey(key);
    setStartError(null);
    try {
      await action();
      AccessibilityInfo.announceForAccessibility(strings.radio.started(title));
    } catch (error) {
      setStartError(
        error instanceof Error && error.message === strings.radio.stationEmpty
          ? `${strings.radio.startFailed(title)}: ${strings.radio.stationEmpty}`
          : strings.radio.startFailed(title),
      );
    } finally {
      setStartingKey(null);
    }
  };

  const startMood = (index: number) => {
    const mood = RADIO_MOODS[index];
    const title = strings.radio.moods[mood.tag].title;
    void runStation(`mood:${mood.tag}`, title, async () => {
      const tracks = orderedUniqueRadioTracks(moodTracks[index]?.data ?? []);
      if (tracks.length === 0) throw new Error(strings.radio.stationEmpty);
      await playTracks(tracks, 0, {
        radio: true,
        context: { type: 'radio', id: `mood:${mood.tag}`, label: title },
      });
    });
  };

  const startGenre = (id: string, name: string) => {
    const title = strings.radio.genreRadio(name);
    void runStation(`genre:${id}`, title, async () => {
      const detail = await queryClient.fetchQuery(musicQueries.genre(id));
      const tracks = orderedUniqueRadioTracks(detail.tracks);
      if (tracks.length === 0) throw new Error(strings.radio.stationEmpty);
      await playTracks(tracks, 0, {
        radio: true,
        context: { type: 'radio', id: `genre:${id}`, label: title },
      });
    });
  };

  return (
    <View testID="radio-screen" style={styles.container}>
      <ScrollView
        testID="radio-scroll"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            accessibilityLabel={strings.radio.refreshing}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={styles.content}
      >
        <View testID="radio-hero" style={styles.hero}>
          <View accessible={false} style={styles.heroIcon}>
            <AppIcon name="radio" color={colors.accentSoft} size={30} />
          </View>
          <View style={styles.heroText}>
            <Text accessibilityRole="header" style={styles.heroTitle}>{strings.radio.title}</Text>
            <Text style={styles.heroSubtitle}>{strings.radio.subtitle}</Text>
          </View>
        </View>

        {startError ? (
          <View testID="radio-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.errorBanner}>
            <Text style={styles.errorText}>{startError}</Text>
            <Pressable
              testID="radio-error-dismiss"
              accessibilityRole="button"
              accessibilityLabel={strings.radio.dismissError}
              onPress={() => setStartError(null)}
              style={styles.dismissButton}
            >
              <AppIcon name="close" color={colors.textSecondary} size={20} />
            </Pressable>
          </View>
        ) : null}

        <RadioSection
          id="personal"
          title={strings.radio.personalTitle}
          subtitle={strings.radio.personalSubtitle}
          state={personalState}
          loadingText={strings.radio.personalLoading}
          emptyText={strings.radio.personalEmpty}
          busy={personalQueries.some((query) => query.isFetching)}
          onRetry={() => {
            void Promise.allSettled(personalQueries.map((query) => query.refetch()));
          }}
        >
          <ScrollView
            testID="radio-personal-list"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {resolvedPersonal.map(({ id, track }) => {
              const key = `personal:${id}`;
              return (
                <RadioStationCard
                  key={id}
                  testID={`radio-personal-${id}`}
                  title={track.title}
                  subtitle={track.artist}
                  cover={track.cover}
                  variant="personal"
                  busy={startingKey === key}
                  blocked={blocked && startingKey !== key}
                  onPress={() => void runStation(key, track.title, () => startRadio(track))}
                />
              );
            })}
          </ScrollView>
        </RadioSection>

        <View testID="radio-section-moods" style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{strings.radio.moodsTitle}</Text>
          <ScrollView
            testID="radio-mood-list"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {RADIO_MOODS.map((mood, index) => {
              const query = moodTracks[index];
              const copy = strings.radio.moods[mood.tag];
              const tracks = orderedUniqueRadioTracks(query.data ?? []);
              const key = `mood:${mood.tag}`;
              const state = radioContentState({
                hasData: query.data !== undefined,
                empty: query.data !== undefined && tracks.length === 0,
                pending: query.isPending,
                fetching: query.isFetching,
                stale: query.isStale,
                fetchStatus: query.fetchStatus,
                error: query.error,
              });
              return (
                <RadioQueryStation
                  key={mood.tag}
                  testID={`radio-mood-${mood.tag}`}
                  title={copy.title}
                  subtitle={copy.subtitle}
                  cover={tracks.find((track) => track.cover)?.cover ?? ''}
                  state={state}
                  queryBusy={query.isFetching}
                  stationBusy={startingKey === key}
                  blocked={blocked && startingKey !== key}
                  loadingText={strings.radio.moodLoading(copy.title)}
                  emptyText={strings.radio.stationEmpty}
                  onRetry={() => void query.refetch()}
                  onPress={() => startMood(index)}
                />
              );
            })}
          </ScrollView>
        </View>

        <RadioSection
          id="genres"
          title={strings.radio.genresTitle}
          state={genreState}
          loadingText={strings.radio.genresLoading}
          emptyText={strings.radio.genresEmpty}
          busy={genres.isFetching}
          onRetry={() => void genres.refetch()}
        >
          <ScrollView
            testID="radio-genre-list"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {(genres.data ?? []).map((genre) => {
              const key = `genre:${genre.id}`;
              const title = strings.radio.genreRadio(genre.name);
              return (
                <RadioStationCard
                  key={genre.id}
                  testID={`radio-genre-${genre.id}`}
                  title={title}
                  subtitle={genre.name}
                  cover={genre.picture}
                  variant="genre"
                  busy={startingKey === key}
                  blocked={blocked && startingKey !== key}
                  onPress={() => startGenre(genre.id, genre.name)}
                />
              );
            })}
          </ScrollView>
        </RadioSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: 30, padding: 16, paddingBottom: 140 },
  hero: { minHeight: 142, flexDirection: 'row', alignItems: 'center', gap: 16, padding: 22, borderRadius: 18, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
  heroIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  heroGlyph: { color: colors.onAccent, fontSize: 30 },
  heroText: { flex: 1, gap: 4 },
  heroTitle: { color: colors.textPrimary, fontSize: 32, fontWeight: '900' },
  heroSubtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surfaceElevated },
  errorText: { flex: 1, color: colors.danger, fontSize: 13, lineHeight: 19 },
  dismissButton: { width: metrics.minimumTouchTarget, height: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  dismissText: { color: colors.textPrimary, fontSize: 23 },
  section: { gap: 12 },
  sectionTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  rail: { gap: 12, paddingRight: 8 },
});
