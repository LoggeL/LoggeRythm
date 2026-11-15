import React from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { RemoteNotice } from '../data/remoteState';
import { colors, spacing } from '../theme';
import { AppText, RetryButton } from './ui';

export interface RemoteNoticeCopy {
  cachedOffline: string;
  cachedRefreshFailed: string;
  refreshing: string;
  stale: string;
}

export interface RemoteNoticeViewProps {
  /** The `notice` half of a `RemoteVisualState`; null renders nothing. */
  notice: RemoteNotice;
  /** Yields `${prefix}-cached-offline`, `-cached-error`, `-refreshing`, `-stale`. */
  testIDPrefix: string;
  /** testID of the retry control; defaults to `${prefix}-${kind}-retry`. */
  retryTestID?: (kind: 'cached-offline' | 'cached-error') => string;
  copy: RemoteNoticeCopy;
  /** Screen-reader name of the retry control; names what is reloaded. */
  retryAccessibilityLabel: string;
  busy: boolean;
  onRetry: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * RemoteNoticeView is the one-line status shown next to last-good content:
 * cached-while-offline and failed-refresh warnings (polite alerts with the
 * shared RetryButton), the refresh progress line, and the stale hint. The
 * four notices are mutually exclusive, exactly as `resolveRemoteVisualState`
 * produces them.
 */
export function RemoteNoticeView({
  notice,
  testIDPrefix,
  retryTestID = (kind) => `${testIDPrefix}-${kind}-retry`,
  copy,
  retryAccessibilityLabel,
  busy,
  onRetry,
  style,
}: RemoteNoticeViewProps) {
  if (notice === null) return null;
  if (notice === 'refreshing') {
    return (
      <View
        testID={`${testIDPrefix}-refreshing`}
        accessibilityRole="progressbar"
        accessibilityLabel={copy.refreshing}
        accessibilityLiveRegion="polite"
        style={[styles.row, style]}
      >
        <ActivityIndicator accessible={false} color={colors.accentSoft} size="small" />
        <AppText variant="caption" color="secondary" style={styles.copy}>{copy.refreshing}</AppText>
      </View>
    );
  }
  if (notice === 'stale') {
    return (
      <AppText
        testID={`${testIDPrefix}-stale`}
        variant="caption"
        color="secondary"
        accessibilityLiveRegion="polite"
        style={style}
      >
        {copy.stale}
      </AppText>
    );
  }
  const kind = notice === 'cached-offline' ? 'cached-offline' : 'cached-error';
  return (
    <View
      testID={`${testIDPrefix}-${kind}`}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.warning, style]}
    >
      <AppText variant="callout" color="warning">
        {kind === 'cached-offline' ? copy.cachedOffline : copy.cachedRefreshFailed}
      </AppText>
      <RetryButton
        testID={retryTestID(kind)}
        accessibilityLabel={retryAccessibilityLabel}
        busy={busy}
        onRetry={onRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  copy: { flex: 1 },
  warning: { gap: spacing.xs },
});
