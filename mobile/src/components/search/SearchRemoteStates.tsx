import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RemoteVisualState } from '../../data/remoteState';
import { colors, metrics } from '../../theme';

interface SearchLoadingStatusProps {
  testID: string;
  label: string;
}

export function SearchLoadingStatus({ testID, label }: SearchLoadingStatusProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={styles.loading}
    >
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.status}>{label}</Text>
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
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion={liveRegion}
      style={styles.errorBox}
    >
      <Text style={styles.error}>{message}</Text>
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
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface SearchPoliteStatusProps {
  testID: string;
  message: string;
}

export function SearchPoliteStatus({ testID, message }: SearchPoliteStatusProps) {
  return (
    <Text testID={testID} accessibilityLiveRegion="polite" style={styles.statusText}>
      {message}
    </Text>
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

  return (
    <>
      {state.body === 'loading' ? (
        <SearchLoadingStatus testID={`${id}-loading`} label={loadingLabel} />
      ) : null}
      {state.body === 'offline'
        ? retry(`${id}-offline`, offlineLabel, 'assertive')
        : null}
      {state.body === 'hard-error'
        ? retry(`${id}-error`, errorLabel, 'assertive')
        : null}
      {state.body === 'empty' ? (
        <SearchPoliteStatus testID={`${id}-empty`} message={emptyLabel} />
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
        <SearchPoliteStatus testID={`${id}-stale`} message={staleLabel} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 18,
  },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  statusText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: 16 },
  errorBox: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surfaceElevated,
  },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  action: {
    minHeight: metrics.minimumTouchTarget,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 24,
    backgroundColor: colors.accent,
  },
  actionText: { color: colors.onAccent, fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.54 },
  pressed: { opacity: 0.72 },
});
