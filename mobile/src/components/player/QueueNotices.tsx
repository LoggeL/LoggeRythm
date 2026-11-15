import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { RemoteVisualState } from '../../data/remoteState';
import { strings } from '../../localization';
import type { QueueSnapshotNotice } from '../../screens/queueSnapshotState';
import { colors, layout, radii, spacing } from '../../theme';
import { AppText, RetryButton } from '../ui';

interface WarningNoticeProps {
  testID: string;
  message: string;
  retryTestID: string;
  retryLabel: string;
  retryBusy: boolean;
  onRetry: () => void;
}

/** Non-blocking warning above still-valid rows, with the shared retry control. */
function WarningNotice({
  testID,
  message,
  retryTestID,
  retryLabel,
  retryBusy,
  onRetry,
}: WarningNoticeProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.warning}
    >
      <AppText variant="callout" color="warning">{message}</AppText>
      <RetryButton
        testID={retryTestID}
        accessibilityLabel={retryLabel}
        busy={retryBusy}
        onRetry={onRetry}
      />
    </View>
  );
}

function ProgressLine({ testID, label }: { testID: string; label: string }) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={styles.progress}
    >
      <ActivityIndicator accessible={false} color={colors.accentSoft} size="small" />
      <AppText variant="caption" color="secondary" numberOfLines={1} style={styles.progressText}>
        {label}
      </AppText>
    </View>
  );
}

function StatusLine({ testID, label }: { testID: string; label: string }) {
  return (
    <AppText
      testID={testID}
      accessibilityLiveRegion="polite"
      variant="caption"
      color="secondary"
      style={styles.status}
    >
      {label}
    </AppText>
  );
}

export interface QueueSnapshotNoticeViewProps {
  notice: QueueSnapshotNotice;
  retryBusy: boolean;
  onRetry: () => void;
}

/** Inline state of the native queue read while the last-good rows stay visible. */
export function QueueSnapshotNoticeView({
  notice,
  retryBusy,
  onRetry,
}: QueueSnapshotNoticeViewProps) {
  if (notice === 'cached-refresh-error') {
    return (
      <WarningNotice
        testID="queue-snapshot-cached-error"
        message={strings.queue.loadFailed}
        retryTestID="queue-snapshot-retry"
        retryLabel={strings.common.retry}
        retryBusy={retryBusy}
        onRetry={onRetry}
      />
    );
  }
  if (notice === 'refreshing') {
    return <ProgressLine testID="queue-snapshot-refreshing" label={strings.queue.loading} />;
  }
  return null;
}

export interface QueueMetadataNoticeViewProps {
  /** null while the cached-track query is not enabled. */
  state: RemoteVisualState | null;
  retryBusy: boolean;
  onRetry: () => void;
}

/**
 * State of the supplementary "cached on server" metadata. It never blocks
 * the queue: a failure is a warning with retry, everything else one line.
 */
export function QueueMetadataNoticeView({
  state,
  retryBusy,
  onRetry,
}: QueueMetadataNoticeViewProps) {
  if (state === null) return null;
  const section = strings.search.metadataTitle;
  const warning = (testID: string, message: string) => (
    <WarningNotice
      testID={testID}
      message={message}
      retryTestID="queue-metadata-retry"
      retryLabel={strings.search.retrySection(section)}
      retryBusy={retryBusy}
      onRetry={onRetry}
    />
  );

  if (state.body === 'loading') {
    return (
      <ProgressLine
        testID="queue-metadata-loading"
        label={strings.search.remoteLoading(section)}
      />
    );
  }
  if (state.body === 'offline') {
    return warning('queue-metadata-offline', strings.search.remoteOffline(section));
  }
  if (state.body === 'hard-error') {
    return warning('queue-metadata-error', strings.search.remoteLoadFailed(section));
  }
  switch (state.notice) {
    case 'cached-offline':
      return warning('queue-metadata-cached-offline', strings.search.remoteCachedOffline(section));
    case 'cached-refresh-error':
      return warning(
        'queue-metadata-cached-error',
        strings.search.remoteCachedRefreshFailed(section),
      );
    case 'refreshing':
      return (
        <StatusLine
          testID="queue-metadata-refreshing"
          label={strings.search.remoteRefreshing(section)}
        />
      );
    case 'stale':
      return <StatusLine testID="queue-metadata-stale" label={strings.search.remoteStale(section)} />;
    case null:
      return null;
  }
}

const styles = StyleSheet.create({
  warning: {
    gap: spacing.xs,
    marginHorizontal: layout.pagePadding,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSubtle,
  },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: layout.pagePadding,
    paddingBottom: spacing.xs,
  },
  progressText: { flexShrink: 1 },
  status: { paddingHorizontal: layout.pagePadding, paddingBottom: spacing.xs },
});
