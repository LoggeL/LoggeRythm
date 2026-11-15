import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  resolveRemoteVisualState,
  type RemoteFetchStatus,
  type RemoteVisualState,
} from '../../data/remoteState';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, layout, spacing } from '../../theme';
import { AppText, ErrorState, Skeleton } from '../ui';
import { InlineNotice } from './InlineNotice';

export interface PlaylistRemoteQueryState {
  /** A successful response exists, including a successful empty response. */
  hasData: boolean;
  empty: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: RemoteFetchStatus;
  error: unknown;
}

export function resolvePlaylistRemoteVisualState(
  state: PlaylistRemoteQueryState,
): RemoteVisualState {
  return resolveRemoteVisualState({
    hasData: state.hasData,
    empty: state.empty,
    pending: state.isPending,
    fetching: state.isFetching,
    stale: state.isStale,
    fetchStatus: state.fetchStatus,
    error: state.error,
  });
}

const SKELETON_ROWS = [0, 1, 2, 3, 4] as const;

interface PlaylistQueryGateProps {
  visual: RemoteVisualState;
  retryBusy: boolean;
  onRetry: () => void;
}

/** Blocking state used only when no successful collection response exists. */
export function PlaylistQueryGate({
  visual,
  retryBusy,
  onRetry,
}: PlaylistQueryGateProps) {
  if (visual.body === 'loading') {
    // Shaped like the loaded screen (hero, action row, track rows) so nothing
    // jumps when the playlist arrives.
    return (
      <View
        testID="playlist-loading"
        accessibilityRole="progressbar"
        accessibilityLabel={libraryStrings.playlist.loading}
        accessibilityLiveRegion="polite"
        style={styles.loading}
      >
        <View style={styles.loadingHero}>
          <Skeleton width={layout.artwork.hero} height={layout.artwork.hero} radius="card" />
          <Skeleton width="70%" height={spacing.xxl} />
          <Skeleton width="45%" height={spacing.md} />
        </View>
        {SKELETON_ROWS.map((row) => (
          <View key={row} style={styles.loadingRow}>
            <Skeleton width={layout.artwork.sm} height={layout.artwork.sm} />
            <View style={styles.loadingCopy}>
              <Skeleton width="62%" height={spacing.md} />
              <Skeleton width="38%" height={spacing.sm} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (visual.body !== 'offline' && visual.body !== 'hard-error') return null;
  const offline = visual.body === 'offline';
  return (
    <View
      // Keep the established umbrella failure ID for device QA while exposing
      // the more specific offline state to assistive and component tests.
      testID={offline ? 'playlist-error' : undefined}
      style={styles.pageState}
    >
      <ErrorState
        layout="page"
        kind={offline ? 'offline' : 'error'}
        testID={`playlist-${offline ? 'offline' : 'error'}`}
        message={offline ? libraryStrings.common.offline : libraryStrings.common.loadFailed}
        onRetry={onRetry}
        retryBusy={retryBusy}
        retryTestID="playlist-retry"
        retryAccessibilityLabel={libraryStrings.common.retry}
      />
    </View>
  );
}

interface PlaylistQueryNoticeProps {
  visual: RemoteVisualState;
  retryBusy: boolean;
  onRetry: () => void;
  /**
   * Show the inline "refreshing" row. Pass false where the list owns a
   * pull-to-refresh control, so a background refetch does not grow the header
   * and push the rows down.
   */
  refreshIndicator?: boolean;
}

/** Non-blocking state shown while last-good empty or populated data stays mounted. */
export function PlaylistQueryNotice({
  visual,
  retryBusy,
  onRetry,
  refreshIndicator = true,
}: PlaylistQueryNoticeProps) {
  if (visual.notice === 'cached-offline' || visual.notice === 'cached-refresh-error') {
    const offline = visual.notice === 'cached-offline';
    return (
      <InlineNotice
        testID={`playlist-${offline ? 'cached-offline' : 'cached-error'}`}
        message={
          offline
            ? libraryStrings.common.cachedOffline
            : libraryStrings.common.cachedRefreshFailed
        }
        retry={{
          testID: 'playlist-notice-retry',
          accessibilityLabel: libraryStrings.common.retry,
          busy: retryBusy,
          onRetry,
        }}
      />
    );
  }

  if (visual.notice === 'refreshing') {
    if (!refreshIndicator) return null;
    return (
      <View
        testID="playlist-refreshing"
        accessibilityRole="progressbar"
        accessibilityLabel={libraryStrings.common.refreshing}
        accessibilityLiveRegion="polite"
        style={styles.refreshing}
      >
        <ActivityIndicator color={colors.accent} size="small" />
        <AppText variant="caption" color="muted">{libraryStrings.common.refreshing}</AppText>
      </View>
    );
  }

  if (visual.notice === 'stale') {
    return (
      <AppText
        testID="playlist-stale"
        accessibilityLiveRegion="polite"
        variant="caption"
        color="muted"
        align="center"
      >
        {libraryStrings.common.stale}
      </AppText>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  pageState: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingHorizontal: layout.pagePadding,
    backgroundColor: colors.background,
  },
  loadingHero: { alignItems: 'center', gap: spacing.md, paddingBottom: spacing.xl },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  loadingCopy: { flex: 1, gap: spacing.xs },
  refreshing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
});
