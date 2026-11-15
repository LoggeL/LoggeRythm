import React from 'react';
import { StyleSheet, View } from 'react-native';
import { resolveRemoteVisualState, type RemoteFetchStatus } from '../../data/remoteState';
import type { UserStats } from '../../domain/listeningStats';
import { strings } from '../../localization';
import { accountStrings } from '../../screens/accountStrings';
import { layout, spacing } from '../../theme';
import { RemoteNoticeView } from '../RemoteNoticeView';
import { EmptyState, ErrorState, IconButton, Skeleton } from '../ui';
import { ProfileGroup } from './ProfileGroup';
import { StatsPeriods } from './StatsPeriods';

export interface ListeningStatsPanelProps {
  data: UserStats | undefined;
  pending: boolean;
  fetching: boolean;
  fetchStatus: RemoteFetchStatus;
  stale: boolean;
  error: unknown;
  onRefresh: () => void;
}

/** Placeholder shaped like the two stat cards plus a few ranked rows. */
function StatsSkeleton() {
  return (
    <View
      testID="profile-stats-loading"
      accessibilityRole="progressbar"
      accessibilityLabel={strings.profile.statsLoading}
      accessibilityLiveRegion="polite"
      style={styles.skeleton}
    >
      <View style={styles.skeletonCards}>
        <Skeleton height={layout.artwork.lg} radius="card" style={styles.skeletonCard} />
        <Skeleton height={layout.artwork.lg} radius="card" style={styles.skeletonCard} />
      </View>
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <Skeleton width={layout.artwork.xs} height={layout.artwork.xs} />
          <View style={styles.skeletonCopy}>
            <Skeleton width={index === 1 ? '50%' : '70%'} height={14} />
            <Skeleton width="40%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * ListeningStatsPanel maps the stats query to exactly one body — skeleton,
 * offline or failure ErrorState with retry, EmptyState, or the period cards
 * — plus the single notice that may accompany cached data. The header
 * refresh button reports the in-flight request.
 */
export function ListeningStatsPanel({
  data,
  pending,
  fetching,
  fetchStatus,
  stale,
  error,
  onRefresh,
}: ListeningStatsPanelProps) {
  const empty = data !== undefined
    && data.total_plays === 0
    && data.total_plays_month === 0
    && data.top_tracks.length === 0
    && data.top_artists.length === 0
    && data.top_tracks_month.length === 0
    && data.top_artists_month.length === 0
    && data.recent.length === 0;
  const visual = resolveRemoteVisualState({
    hasData: data !== undefined,
    empty,
    pending,
    fetching,
    stale,
    fetchStatus,
    error,
  });
  const failure = visual.body === 'offline' ? 'offline' : visual.body === 'hard-error' ? 'error' : null;

  return (
    <ProfileGroup
      testID="profile-stats"
      icon="chart-bar"
      title={strings.profile.statsTitle}
      trailing={
        <IconButton
          testID="profile-stats-refresh"
          icon="refresh"
          size="sm"
          variant="tonal"
          busy={fetching}
          accessibilityLabel={strings.profile.refreshStats}
          onPress={onRefresh}
        />
      }
    >
      {visual.body === 'loading' ? <StatsSkeleton /> : null}
      {failure !== null ? (
        <ErrorState
          testID={`profile-stats-${failure}`}
          retryTestID="profile-stats-retry"
          kind={failure}
          message={failure === 'offline' ? strings.profile.statsOffline : strings.profile.statsLoadFailed}
          onRetry={onRefresh}
          retryBusy={fetching}
          retryAccessibilityLabel={strings.profile.refreshStats}
          style={styles.flat}
        />
      ) : null}
      <RemoteNoticeView
        notice={visual.notice}
        testIDPrefix="profile-stats"
        retryTestID={() => 'profile-stats-notice-retry'}
        copy={{
          cachedOffline: strings.profile.statsCachedOffline,
          cachedRefreshFailed: strings.profile.statsRefreshFailed,
          refreshing: strings.profile.statsRefreshing,
          stale: strings.profile.statsStale,
        }}
        retryAccessibilityLabel={strings.profile.refreshStats}
        busy={fetching}
        onRetry={onRefresh}
      />
      {visual.body === 'empty' ? (
        <EmptyState
          testID="profile-stats-empty"
          icon="chart-bar"
          title={strings.profile.statsEmpty}
          message={accountStrings.profile.statsEmptyHint}
        />
      ) : null}
      {visual.body === 'content' && data ? (
        <StatsPeriods testID="profile-stats-periods" data={data} />
      ) : null}
    </ProfileGroup>
  );
}

const styles = StyleSheet.create({
  // The group already is the surface; the nested ErrorState drops its own box.
  flat: { padding: 0, borderWidth: 0, backgroundColor: 'transparent' },
  skeleton: { gap: spacing.sm },
  skeletonCards: { flexDirection: 'row', gap: spacing.sm },
  skeletonCard: { flex: 1 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  skeletonCopy: { flex: 1, gap: spacing.xs },
});
