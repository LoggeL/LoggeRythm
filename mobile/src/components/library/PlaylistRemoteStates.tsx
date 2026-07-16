import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  resolveRemoteVisualState,
  type RemoteFetchStatus,
  type RemoteVisualState,
} from '../../data/remoteState';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, metrics } from '../../theme';

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

interface RetryButtonProps {
  id: string;
  busy: boolean;
  onRetry: () => void;
}

function RetryButton({ id, busy, onRetry }: RetryButtonProps) {
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={libraryStrings.common.retry}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onRetry}
      style={({ pressed }) => [
        styles.retry,
        busy && styles.disabled,
        pressed && !busy && styles.pressed,
      ]}
    >
      <Text style={styles.retryText}>{libraryStrings.common.retry}</Text>
    </Pressable>
  );
}

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
    return (
      <View
        testID="playlist-loading"
        accessibilityRole="progressbar"
        accessibilityLabel={libraryStrings.playlist.loading}
        accessibilityLiveRegion="polite"
        style={styles.pageState}
      >
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.status}>{libraryStrings.playlist.loading}</Text>
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
      <View
        testID={`playlist-${offline ? 'offline' : 'error'}`}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        style={styles.failure}
      >
        <Text style={styles.errorText}>
          {offline ? libraryStrings.common.offline : libraryStrings.common.loadFailed}
        </Text>
        <RetryButton id="playlist-retry" busy={retryBusy} onRetry={onRetry} />
      </View>
    </View>
  );
}

interface PlaylistQueryNoticeProps {
  visual: RemoteVisualState;
  retryBusy: boolean;
  onRetry: () => void;
}

/** Non-blocking state shown while last-good empty or populated data stays mounted. */
export function PlaylistQueryNotice({
  visual,
  retryBusy,
  onRetry,
}: PlaylistQueryNoticeProps) {
  if (visual.notice === 'cached-offline' || visual.notice === 'cached-refresh-error') {
    const offline = visual.notice === 'cached-offline';
    return (
      <View
        testID={`playlist-${offline ? 'cached-offline' : 'cached-error'}`}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.notice}
      >
        <Text style={styles.warning}>
          {offline
            ? libraryStrings.common.cachedOffline
            : libraryStrings.common.cachedRefreshFailed}
        </Text>
        <RetryButton
          id="playlist-notice-retry"
          busy={retryBusy}
          onRetry={onRetry}
        />
      </View>
    );
  }

  if (visual.notice === 'refreshing') {
    return (
      <View
        testID="playlist-refreshing"
        accessibilityRole="progressbar"
        accessibilityLabel={libraryStrings.common.refreshing}
        accessibilityLiveRegion="polite"
        style={styles.refreshing}
      >
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.status}>{libraryStrings.common.refreshing}</Text>
      </View>
    );
  }

  if (visual.notice === 'stale') {
    return (
      <Text testID="playlist-stale" accessibilityLiveRegion="polite" style={styles.status}>
        {libraryStrings.common.stale}
      </Text>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  pageState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    backgroundColor: colors.background,
  },
  failure: {
    alignSelf: 'stretch',
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  notice: {
    gap: 9,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
  },
  refreshing: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  retry: {
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    backgroundColor: colors.surfaceElevated,
  },
  retryText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.74, backgroundColor: colors.surfacePressed },
});
