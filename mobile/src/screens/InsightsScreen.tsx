import React, { useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  InsightsStatEntry,
  StatsInsightsRange,
  Track,
  UserStatsInsights,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  ActionButton,
  AppText,
  Artwork,
  EmptyState,
  ErrorState,
  FilterChip,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  Surface,
} from '../components/ui';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries, musicRepository } from '../data';
import { useBottomInset } from '../hooks/useBottomInset';
import { useHaptics } from '../hooks/useHaptics';
import { wave2Strings } from '../localization/wave2Strings';
import { reportPlayerError } from '../player/errors';
import { playTrackRow } from '../player/controller';
import { colors, layout, metrics, opacity, radii, spacing } from '../theme';
import { TvFocusScope } from '../tv';
import type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';

export const INSIGHTS_RANGES: readonly StatsInsightsRange[] = [
  '7d',
  '30d',
  '90d',
  'year',
  'all',
] as const;

export function formatInsightsDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return wave2Strings.insights.formatDuration(hours, minutes);
}

export interface InsightsScreenProps {
  onOpenArtist: (params: ArtistRouteParams) => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
}

export interface InsightsScreenViewProps {
  range: StatsInsightsRange;
  insights: UserStatsInsights | undefined;
  isPending: boolean;
  isError: boolean;
  refreshing: boolean;
  bottomInset: number;
  shareError: string | null;
  onSelectRange: (range: StatsInsightsRange) => void;
  onRefresh: () => void;
  onShare: () => void;
  onPlayTrack: (entry: InsightsStatEntry) => void;
  onOpenArtist: (entry: InsightsStatEntry) => void;
  onOpenAlbum: (entry: InsightsStatEntry) => void;
}

function BarDistribution({
  testID,
  values,
  labels,
}: {
  testID: string;
  values: readonly number[];
  labels?: readonly string[];
}) {
  const maxVal = Math.max(1, ...values);
  return (
    <View testID={testID} style={styles.chartWrap}>
      <View style={styles.chartBars}>
        {values.map((count, index) => {
          const ratio = Math.max(0.06, count / maxVal);
          const peak = count > 0 && count === maxVal;
          return (
            <View key={index} style={styles.chartCol}>
              <View
                style={[
                  styles.chartBar,
                  {
                    height: Math.round(ratio * 72),
                    backgroundColor: count === 0 ? colors.fillStrong : peak ? colors.accent : colors.accentSoft,
                  },
                ]}
              />
              {labels !== undefined && labels[index] !== undefined ? (
                <AppText variant="micro" color="muted" numberOfLines={1}>
                  {labels[index]}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function StatRankList({
  testID,
  title,
  entries,
  onPress,
}: {
  testID: string;
  title: string;
  entries: readonly InsightsStatEntry[];
  onPress: (entry: InsightsStatEntry) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <View testID={testID} style={styles.section}>
      <SectionHeader title={title} padded={false} />
      <Surface style={styles.rankCard}>
        {entries.slice(0, 8).map((entry, idx) => (
          <Pressable
            key={`${entry.key}-${idx}`}
            testID={`${testID}-item-${idx}`}
            accessibilityRole="button"
            focusable
            onPress={() => onPress(entry)}
            style={({ pressed }) => [styles.rankRow, pressed ? styles.pressed : null]}
          >
            <AppText variant="label" color="accent" style={styles.rankIndex}>
              {idx + 1}
            </AppText>
            <Artwork uri={entry.cover} size={44} icon="music-note" />
            <View style={styles.rankCopy}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {entry.label}
              </AppText>
              {entry.sublabel.trim().length > 0 ? (
                <AppText variant="caption" color="secondary" numberOfLines={1}>
                  {entry.sublabel}
                </AppText>
              ) : null}
            </View>
            <AppText variant="caption" color="secondary">
              {entry.count}
            </AppText>
          </Pressable>
        ))}
      </Surface>
    </View>
  );
}

/** Pure presentation for the Wrapped / Listening Insights view. */
export function InsightsScreenView({
  range,
  insights,
  isPending,
  isError,
  refreshing,
  bottomInset,
  shareError,
  onSelectRange,
  onRefresh,
  onShare,
  onPlayTrack,
  onOpenArtist,
  onOpenAlbum,
}: InsightsScreenViewProps) {
  const hourLabels = Array.from({ length: 24 }, (_, h) => (h % 6 === 0 ? `${h}h` : ''));

  return (
    <ScrollView
      testID="insights-screen"
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.surfaceElevated}
        />
      }
    >
      <ScreenHeader
        testID="insights-header"
        title={wave2Strings.insights.title}
      />

      <View testID="insights-ranges" style={styles.chipRow}>
        {INSIGHTS_RANGES.map((item) => (
          <FilterChip
            key={item}
            testID={`insights-range-${item}`}
            label={wave2Strings.insights.ranges[item]}
            selected={range === item}
            onPress={() => onSelectRange(item)}
          />
        ))}
      </View>

      {isPending && insights === undefined ? (
        <View testID="insights-loading" style={styles.skeletons}>
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={140} />
          <Skeleton width="100%" height={180} />
        </View>
      ) : isError && insights === undefined ? (
        <ErrorState
          testID="insights-error"
          retryTestID="insights-retry"
          message={wave2Strings.insights.loadFailed}
          onRetry={onRefresh}
        />
      ) : insights === undefined || insights.play_count === 0 ? (
        <EmptyState
          testID="insights-empty"
          icon="chart-bar"
          title={wave2Strings.insights.emptyTitle}
          message={wave2Strings.insights.emptyBody}
        />
      ) : (
        <>
          <View testID="insights-kpis" style={styles.kpiGrid}>
            <Surface padded style={styles.kpiCard}>
              <AppText variant="overline" color="muted">
                {wave2Strings.insights.listeningTime}
              </AppText>
              <AppText testID="insights-listening-time" variant="title" color="accent">
                {formatInsightsDuration(insights.listening_sec)}
              </AppText>
            </Surface>
            <Surface padded style={styles.kpiCard}>
              <AppText variant="overline" color="muted">
                {wave2Strings.insights.plays}
              </AppText>
              <AppText testID="insights-play-count" variant="title">
                {String(insights.play_count)}
              </AppText>
            </Surface>
            <Surface padded style={styles.kpiCard}>
              <AppText variant="overline" color="muted">
                {wave2Strings.insights.currentStreak}
              </AppText>
              <AppText testID="insights-streak" variant="title" color="accent">
                {wave2Strings.insights.streakDays(insights.current_streak_days)}
              </AppText>
              <AppText variant="micro" color="secondary">
                {wave2Strings.insights.longestStreak}:{' '}
                {wave2Strings.insights.streakDays(insights.longest_streak_days)}
              </AppText>
            </Surface>
            <Surface padded style={styles.kpiCard}>
              <AppText variant="overline" color="muted">
                {wave2Strings.insights.newArtists}
              </AppText>
              <AppText variant="title">{insights.new_artists_count}</AppText>
              <AppText variant="micro" color="secondary">
                {insights.unique_tracks} · {insights.unique_artists}
              </AppText>
            </Surface>
          </View>

          <ActionButton
            testID="insights-share"
            icon="share-variant"
            label={wave2Strings.insights.shareButton}
            variant="primary"
            onPress={onShare}
          />
          {shareError !== null ? (
            <AppText testID="insights-share-error" accessibilityRole="alert" variant="caption" color="danger">
              {shareError}
            </AppText>
          ) : null}

          <View style={styles.section}>
            <SectionHeader title={wave2Strings.insights.hourlyTitle} padded={false} />
            <Surface padded>
              <BarDistribution
                testID="insights-hourly-chart"
                values={insights.hourly_distribution}
                labels={hourLabels}
              />
            </Surface>
          </View>

          <View style={styles.section}>
            <SectionHeader title={wave2Strings.insights.weekdayTitle} padded={false} />
            <Surface padded>
              <BarDistribution
                testID="insights-weekday-chart"
                values={insights.weekday_distribution}
                labels={wave2Strings.insights.weekdays}
              />
            </Surface>
          </View>

          <StatRankList
            testID="insights-top-tracks"
            title={wave2Strings.insights.topTracks}
            entries={insights.top_tracks}
            onPress={onPlayTrack}
          />

          <StatRankList
            testID="insights-top-artists"
            title={wave2Strings.insights.topArtists}
            entries={insights.top_artists}
            onPress={onOpenArtist}
          />

          <StatRankList
            testID="insights-top-albums"
            title={wave2Strings.insights.topAlbums}
            entries={insights.top_albums}
            onPress={onOpenAlbum}
          />

          {insights.recent_plays.length > 0 ? (
            <View testID="insights-recent-plays" style={styles.section}>
              <SectionHeader title={wave2Strings.insights.recentPlays} padded={false} />
              <Surface style={styles.rankCard}>
                {insights.recent_plays.slice(0, 12).map((play, idx) => (
                  <View key={`${play.id}-${play.played_at}-${idx}`} style={styles.rankRow}>
                    <Artwork uri={play.cover} size={40} icon="music-note" />
                    <View style={styles.rankCopy}>
                      <AppText variant="bodyStrong" numberOfLines={1}>
                        {play.title}
                      </AppText>
                      <AppText variant="caption" color="secondary" numberOfLines={1}>
                        {play.artist}
                      </AppText>
                    </View>
                  </View>
                ))}
              </Surface>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

/** Personal Wrapped / Listening Insights screen backed by GET /api/me/stats/insights. */
export default function InsightsScreen({ onOpenArtist, onOpenAlbum }: InsightsScreenProps) {
  const { user } = useAuth();
  if (user === null) throw new Error('InsightsScreen requires an authenticated user');
  const haptics = useHaptics();
  const bottomInset = useBottomInset({ hasTabBar: false });
  const scope = musicCacheScope(getCurrentApiBase(), user.id);
  const [range, setRange] = useState<StatsInsightsRange>('30d');
  const [shareError, setShareError] = useState<string | null>(null);

  const query = useQuery(musicQueries.statsInsights(scope, range));

  const handleShare = () => {
    const data = query.data;
    if (data === undefined) return;
    setShareError(null);
    haptics.trigger('tap');
    const message = wave2Strings.insights.shareMessage(
      wave2Strings.insights.ranges[range],
      formatInsightsDuration(data.listening_sec),
      data.play_count,
      data.top_artists[0]?.label ?? '',
    );
    void Share.share({ message }).catch((cause: unknown) => {
      console.error('[LoggeRythm] Failed to share listening insights:', cause);
      setShareError(wave2Strings.insights.shareFailed);
    });
  };

  const handlePlayTrack = (entry: InsightsStatEntry) => {
    const id = String(entry.key);
    void musicRepository
      .getTrack(id)
      .then((track: Track) =>
        playTrackRow([track], 0, {
          context: { type: 'collection', id: `insights:${range}`, label: wave2Strings.insights.title },
        }),
      )
      .catch((cause: unknown) => {
        reportPlayerError(wave2Strings.insights.loadFailed, cause);
      });
  };

  return (
    <TvFocusScope scope="insights">
      <InsightsScreenView
        range={range}
        insights={query.data}
        isPending={query.isPending}
        isError={query.isError}
        refreshing={query.isFetching && !query.isPending}
        bottomInset={bottomInset}
        shareError={shareError}
        onSelectRange={(next) => {
          haptics.trigger('tap');
          setRange(next);
        }}
        onRefresh={() => void query.refetch()}
        onShare={handleShare}
        onPlayTrack={handlePlayTrack}
        onOpenArtist={(entry) =>
          onOpenArtist({ artistId: String(entry.key), name: entry.label })
        }
        onOpenAlbum={(entry) =>
          onOpenAlbum({ albumId: String(entry.key), title: entry.label })
        }
      />
    </TvFocusScope>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.md,
    gap: layout.sectionGap,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  skeletons: {
    gap: spacing.md,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  kpiCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xxs,
  },
  section: {
    gap: spacing.sm,
  },
  chartWrap: {
    width: '100%',
    paddingTop: spacing.xs,
  },
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 3,
    minHeight: 92,
  },
  chartCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  chartBar: {
    width: '100%',
    minWidth: 4,
    borderRadius: radii.xs,
  },
  rankCard: {
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  rankRow: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  rankIndex: {
    width: 22,
    textAlign: 'center',
  },
  rankCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
