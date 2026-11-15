import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  resolveRemoteVisualState,
  type RemoteFetchStatus,
} from '../data/remoteState';
import { strings } from '../localization';
import { catalogStrings } from '../screens/catalogStrings';
import { colors, layout, radii, spacing } from '../theme';
import { AppText, EmptyState, ErrorState, RetryButton, Skeleton } from './ui';

export interface TrackActionsPlaylistPickerProps {
  /** A successful response exists, including a successful empty response. */
  hasData: boolean;
  empty: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: RemoteFetchStatus;
  error: unknown;
  actionsDisabled: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}

const SKELETON_ROWS = [0, 1, 2];

/** Placeholder shaped like the destination rows it stands in for. */
function PlaylistRowsSkeleton() {
  return (
    <View
      testID="track-action-playlists-loading"
      accessibilityRole="progressbar"
      accessibilityLabel={strings.trackActions.loadingPlaylists}
      accessibilityLiveRegion="polite"
    >
      {SKELETON_ROWS.map((row) => (
        <View key={row} style={styles.skeletonRow}>
          <Skeleton width={layout.artwork.sm} height={layout.artwork.sm} />
          <View style={styles.skeletonCopy}>
            <Skeleton width={row % 2 === 0 ? '62%' : '48%'} height={14} />
            <Skeleton width="30%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Query-owned remote state for the add-to-playlist destination picker. */
export function TrackActionsPlaylistPicker({
  hasData,
  empty,
  isPending,
  isFetching,
  isStale,
  fetchStatus,
  error,
  actionsDisabled,
  onRetry,
  children,
}: TrackActionsPlaylistPickerProps) {
  const visual = resolveRemoteVisualState({
    hasData,
    empty,
    pending: isPending,
    fetching: isFetching,
    stale: isStale,
    fetchStatus,
    error,
  });
  const retryBusy = fetchStatus === 'fetching';

  // RetryButton has no separate disabled state: while another sheet command
  // runs it reports busy, which blocks a duplicate request the same way.
  const retryBlocked = actionsDisabled || retryBusy;

  let body: React.ReactNode;
  if (visual.body === 'loading') {
    body = <PlaylistRowsSkeleton />;
  } else if (visual.body === 'offline' || visual.body === 'hard-error') {
    const offline = visual.body === 'offline';
    body = (
      <ErrorState
        testID={`track-action-playlists-${offline ? 'offline' : 'error'}`}
        retryTestID="track-action-playlists-retry"
        kind={offline ? 'offline' : 'error'}
        message={offline ? catalogStrings.common.offline : catalogStrings.common.loadFailed}
        onRetry={onRetry}
        retryBusy={retryBlocked}
        style={styles.inset}
      />
    );
  } else if (visual.body === 'empty') {
    body = (
      <EmptyState
        testID="track-action-playlists-empty"
        icon="playlist-plus"
        title={strings.trackActions.noPlaylists}
      />
    );
  } else {
    body = children;
  }

  let notice: React.ReactNode = null;
  if (visual.notice === 'cached-offline' || visual.notice === 'cached-refresh-error') {
    const offline = visual.notice === 'cached-offline';
    notice = (
      <View
        testID={`track-action-playlists-${offline ? 'cached-offline' : 'cached-error'}`}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.notice}
      >
        <AppText variant="callout" color="warning">
          {offline
            ? catalogStrings.common.cachedOffline
            : catalogStrings.common.cachedRefreshFailed}
        </AppText>
        <RetryButton
          testID="track-action-playlists-retry"
          busy={retryBlocked}
          onRetry={onRetry}
        />
      </View>
    );
  } else if (visual.notice === 'refreshing') {
    notice = (
      <View
        testID="track-action-playlists-refreshing"
        accessibilityRole="progressbar"
        accessibilityLabel={catalogStrings.common.refreshing}
        accessibilityLiveRegion="polite"
        style={styles.refreshing}
      >
        <ActivityIndicator accessible={false} color={colors.accentSoft} size="small" />
        <AppText variant="callout" color="secondary">{catalogStrings.common.refreshing}</AppText>
      </View>
    );
  } else if (visual.notice === 'stale') {
    notice = (
      <AppText
        testID="track-action-playlists-stale"
        accessibilityLiveRegion="polite"
        variant="callout"
        color="secondary"
        style={styles.inset}
      >
        {catalogStrings.common.stale}
      </AppText>
    );
  }

  return (
    <View testID="track-action-playlists-query" style={styles.container}>
      {body}
      {notice}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexShrink: 1, gap: spacing.xs },
  inset: { marginHorizontal: spacing.sm },
  skeletonRow: {
    height: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  skeletonCopy: { flex: 1, gap: spacing.xs },
  notice: {
    gap: spacing.xs,
    marginHorizontal: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radii.md,
    backgroundColor: colors.warningSubtle,
  },
  refreshing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
});
