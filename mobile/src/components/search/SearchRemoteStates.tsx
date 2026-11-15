import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { RemoteVisualState } from '../../data/remoteState';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, EmptyState } from '../ui';

interface SearchLoadingStatusProps {
  testID: string;
  label: string;
}

/**
 * Inline progress line for short refreshes of content that is already on
 * screen. A first load of a list or rail uses a skeleton instead (see
 * `SearchRemoteBoundary.loadingFallback`).
 */
export function SearchLoadingStatus({ testID, label }: SearchLoadingStatusProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={styles.loading}
    >
      <ActivityIndicator color={colors.accent} size="small" />
      <AppText variant="caption" color="secondary" style={styles.loadingLabel}>{label}</AppText>
    </View>
  );
}

interface SearchErrorNoticeProps {
  testID: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
  liveRegion?: 'assertive' | 'polite';
}

/**
 * One failure notice: an alert with the localized message and, when the
 * failure is retryable, a retry pill. Assertive notices (nothing to show)
 * are tinted red, polite ones (cached content stays visible) are neutral.
 */
export function SearchErrorNotice({
  testID,
  message,
  actionLabel,
  onAction,
  actionBusy = false,
  liveRegion = 'assertive',
}: SearchErrorNoticeProps) {
  if ((actionLabel === undefined) !== (onAction === undefined)) {
    throw new Error('Search error actions require both a label and callback');
  }
  const blocking = liveRegion === 'assertive';
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion={liveRegion}
      style={[styles.notice, blocking ? styles.noticeBlocking : styles.noticeCached]}
    >
      <View style={styles.noticeCopy}>
        <AppIcon
          name={blocking ? 'alert-circle-outline' : 'cloud-off-outline'}
          color={blocking ? colors.danger : colors.textSecondary}
          size={20}
        />
        <AppText
          variant="callout"
          color={blocking ? 'danger' : 'secondary'}
          style={styles.noticeMessage}
        >
          {message}
        </AppText>
      </View>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable
          testID={`${testID}-action`}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ busy: actionBusy, disabled: actionBusy }}
          disabled={actionBusy}
          onPress={onAction}
          style={({ pressed }) => [
            styles.action,
            actionBusy && styles.disabled,
            pressed && !actionBusy && styles.pressed,
          ]}
        >
          {actionBusy ? (
            <ActivityIndicator accessible={false} color={colors.textPrimary} size="small" />
          ) : (
            <AppIcon name="refresh" color={colors.textPrimary} size={20} />
          )}
          <AppText variant="label" numberOfLines={2} style={styles.actionLabel}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

interface SearchPoliteStatusProps {
  testID: string;
  message: string;
  compact?: boolean;
}

export function SearchPoliteStatus({
  testID,
  message,
  compact = false,
}: SearchPoliteStatusProps) {
  if (compact) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={message}
        accessibilityLiveRegion="polite"
        style={styles.compactStatus}
      >
        <AppIcon name="database-check-outline" color={colors.textMuted} size={14} />
      </View>
    );
  }
  return (
    <AppText
      testID={testID}
      accessibilityLiveRegion="polite"
      variant="callout"
      color="secondary"
      style={styles.statusText}
    >
      {message}
    </AppText>
  );
}

interface SearchRemoteBoundaryProps {
  id: string;
  state: RemoteVisualState;
  loadingLabel: string;
  emptyLabel: string;
  offlineLabel: string;
  errorLabel: string;
  cachedOfflineLabel: string;
  cachedErrorLabel: string;
  refreshingLabel: string;
  staleLabel: string;
  retryLabel: string;
  retryBusy: boolean;
  onRetry: () => void;
  /**
   * Content-shaped placeholder for the first load. It must put `testID` and
   * `accessibilityLabel` on its labelled progressbar group. Without it the
   * boundary shows the inline progress line.
   */
  loadingFallback?: (props: { testID: string; accessibilityLabel: string }) => React.ReactNode;
  children: React.ReactNode;
}

/**
 * Present exactly one body and at most one non-blocking notice for a remote
 * query. Successful empty data remains a real body while a refresh fails.
 */
export function SearchRemoteBoundary({
  id,
  state,
  loadingLabel,
  emptyLabel,
  offlineLabel,
  errorLabel,
  cachedOfflineLabel,
  cachedErrorLabel,
  refreshingLabel,
  staleLabel,
  retryLabel,
  retryBusy,
  onRetry,
  loadingFallback,
  children,
}: SearchRemoteBoundaryProps) {
  const retry = (testID: string, message: string, liveRegion: 'assertive' | 'polite') => (
    <SearchErrorNotice
      testID={testID}
      message={message}
      actionLabel={retryLabel}
      actionBusy={retryBusy}
      onAction={onRetry}
      liveRegion={liveRegion}
    />
  );
  const loading = () =>
    loadingFallback === undefined ? (
      <SearchLoadingStatus testID={`${id}-loading`} label={loadingLabel} />
    ) : (
      loadingFallback({ testID: `${id}-loading`, accessibilityLabel: loadingLabel })
    );

  return (
    <>
      {state.body === 'loading' ? loading() : null}
      {state.body === 'offline'
        ? retry(`${id}-offline`, offlineLabel, 'assertive')
        : null}
      {state.body === 'hard-error'
        ? retry(`${id}-error`, errorLabel, 'assertive')
        : null}
      {state.body === 'empty' ? (
        <EmptyState testID={`${id}-empty`} title={emptyLabel} />
      ) : null}
      {state.body === 'content' ? children : null}

      {state.notice === 'cached-offline'
        ? retry(`${id}-cached-offline`, cachedOfflineLabel, 'polite')
        : null}
      {state.notice === 'cached-refresh-error'
        ? retry(`${id}-cached-error`, cachedErrorLabel, 'polite')
        : null}
      {state.notice === 'refreshing' ? (
        <SearchLoadingStatus testID={`${id}-refreshing`} label={refreshingLabel} />
      ) : null}
      {state.notice === 'stale' ? (
        <SearchPoliteStatus testID={`${id}-stale`} message={staleLabel} compact />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: layout.pagePadding,
  },
  loadingLabel: { flexShrink: 1 },
  statusText: { paddingHorizontal: layout.pagePadding },
  compactStatus: {
    width: spacing.xl,
    height: spacing.xl,
    marginHorizontal: layout.pagePadding,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.fill,
  },
  notice: {
    marginHorizontal: layout.pagePadding,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  noticeBlocking: { backgroundColor: colors.dangerSubtle },
  noticeCached: { backgroundColor: colors.surface },
  noticeCopy: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  noticeMessage: { flex: 1 },
  action: {
    minHeight: metrics.minimumTouchTarget,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.fill,
  },
  actionLabel: { flexShrink: 1 },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: opacity.pressed },
});
