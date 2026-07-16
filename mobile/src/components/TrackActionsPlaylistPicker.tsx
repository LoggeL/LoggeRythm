import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  resolveRemoteVisualState,
  type RemoteFetchStatus,
} from '../data/remoteState';
import { strings } from '../localization';
import { catalogStrings } from '../screens/catalogStrings';
import { colors, metrics } from '../theme';

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

interface RetryProps {
  busy: boolean;
  disabled: boolean;
  onRetry: () => void;
}

function Retry({ busy, disabled, onRetry }: RetryProps) {
  return (
    <Pressable
      testID="track-action-playlists-retry"
      accessibilityRole="button"
      accessibilityLabel={catalogStrings.common.retry}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onRetry}
      style={({ pressed }) => [
        styles.retry,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={styles.retryText}>
        {busy ? catalogStrings.common.retrying : catalogStrings.common.retry}
      </Text>
    </Pressable>
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
  const retryDisabled = actionsDisabled || retryBusy;

  let body: React.ReactNode;
  if (visual.body === 'loading') {
    body = (
      <View
        testID="track-action-playlists-loading"
        accessibilityRole="progressbar"
        accessibilityLabel={strings.trackActions.loadingPlaylists}
        accessibilityLiveRegion="polite"
        style={styles.loading}
      >
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.status}>{strings.trackActions.loadingPlaylists}</Text>
      </View>
    );
  } else if (visual.body === 'offline' || visual.body === 'hard-error') {
    const offline = visual.body === 'offline';
    body = (
      <View
        testID={`track-action-playlists-${offline ? 'offline' : 'error'}`}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        style={styles.failure}
      >
        <Text style={styles.error}>
          {offline ? catalogStrings.common.offline : catalogStrings.common.loadFailed}
        </Text>
        <Retry busy={retryBusy} disabled={retryDisabled} onRetry={onRetry} />
      </View>
    );
  } else if (visual.body === 'empty') {
    body = (
      <Text
        testID="track-action-playlists-empty"
        accessibilityLiveRegion="polite"
        style={styles.empty}
      >
        {strings.trackActions.noPlaylists}
      </Text>
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
        <Text style={styles.warning}>
          {offline
            ? catalogStrings.common.cachedOffline
            : catalogStrings.common.cachedRefreshFailed}
        </Text>
        <Retry busy={retryBusy} disabled={retryDisabled} onRetry={onRetry} />
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
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.status}>{catalogStrings.common.refreshing}</Text>
      </View>
    );
  } else if (visual.notice === 'stale') {
    notice = (
      <Text
        testID="track-action-playlists-stale"
        accessibilityLiveRegion="polite"
        style={styles.status}
      >
        {catalogStrings.common.stale}
      </Text>
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
  container: { gap: 10 },
  loading: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 10 },
  failure: {
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
  },
  notice: {
    gap: 9,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
  },
  refreshing: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  empty: { color: colors.textSecondary, textAlign: 'center', paddingVertical: 26 },
  retry: {
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  retryText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.74, backgroundColor: colors.surfacePressed },
});
