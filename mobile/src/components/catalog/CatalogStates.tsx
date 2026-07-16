import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  resolveRemoteVisualState,
  type RemoteFetchStatus,
  type RemoteNotice,
} from '../../data/remoteState';
import { catalogStrings } from '../../screens/catalogStrings';
import { colors, metrics } from '../../theme';

export interface CatalogQueryVisualState {
  /** A successful response exists, including a successful empty response. */
  hasData: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: RemoteFetchStatus;
  error: unknown;
}

interface RetryButtonProps {
  id: string;
  accessibilityLabel: string;
  busy: boolean;
  onRetry: () => void;
}

function RetryButton({ id, accessibilityLabel, busy, onRetry }: RetryButtonProps) {
  return (
    <Pressable
      testID={`${id}-retry`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onRetry}
      style={({ pressed }) => [
        styles.retry,
        busy && styles.disabled,
        pressed && !busy && styles.pressed,
      ]}
    >
      <Text style={styles.retryText}>
        {busy ? catalogStrings.common.retrying : catalogStrings.common.retry}
      </Text>
    </Pressable>
  );
}

interface BlockingStateProps extends RetryButtonProps {
  kind: 'error' | 'offline';
  message: string;
  page: boolean;
}

function BlockingState({
  id,
  kind,
  message,
  page,
  accessibilityLabel,
  busy,
  onRetry,
}: BlockingStateProps) {
  return (
    <View style={page ? styles.pageState : undefined}>
      <View
        testID={`${id}-${kind}`}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        style={styles.errorBox}
      >
        <Text style={styles.errorText}>{message}</Text>
        <RetryButton
          id={id}
          accessibilityLabel={accessibilityLabel}
          busy={busy}
          onRetry={onRetry}
        />
      </View>
    </View>
  );
}

function visualState(state: CatalogQueryVisualState, empty: boolean) {
  return resolveRemoteVisualState({
    hasData: state.hasData,
    empty,
    pending: state.isPending,
    fetching: state.isFetching,
    stale: state.isStale,
    fetchStatus: state.fetchStatus,
    error: state.error,
  });
}

interface CatalogPageGateProps extends CatalogQueryVisualState {
  id: string;
  loadingLabel: string;
  onRetry: () => void;
}

/** Full-page state for a detail query. Cached data always wins over a blocking state. */
export function CatalogPageGate({
  id,
  hasData,
  isPending,
  isFetching,
  isStale,
  fetchStatus,
  error,
  loadingLabel,
  onRetry,
}: CatalogPageGateProps) {
  const state = { hasData, isPending, isFetching, isStale, fetchStatus, error };
  const visual = visualState(state, false);
  const retryBusy = fetchStatus === 'fetching';
  if (visual.body === 'loading') {
    return (
      <View
        testID={`${id}-loading`}
        accessibilityRole="progressbar"
        accessibilityLabel={loadingLabel}
        accessibilityLiveRegion="polite"
        style={styles.pageState}
      >
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.status}>{loadingLabel}</Text>
      </View>
    );
  }
  if (visual.body === 'offline') {
    return (
      <BlockingState
        id={id}
        kind="offline"
        message={catalogStrings.common.offline}
        accessibilityLabel={catalogStrings.common.retry}
        busy={retryBusy}
        onRetry={onRetry}
        page
      />
    );
  }
  if (visual.body === 'hard-error') {
    return (
      <BlockingState
        id={id}
        kind="error"
        message={catalogStrings.common.loadFailed}
        accessibilityLabel={catalogStrings.common.retry}
        busy={retryBusy}
        onRetry={onRetry}
        page
      />
    );
  }
  return null;
}

interface CatalogContentStatusProps extends CatalogQueryVisualState {
  id: string;
  onRetry: () => void;
  retryLabel?: string;
}

interface CatalogNoticeProps {
  id: string;
  notice: RemoteNotice;
  retryLabel: string;
  retryBusy: boolean;
  onRetry: () => void;
}

function CatalogNotice({
  id,
  notice,
  retryLabel,
  retryBusy,
  onRetry,
}: CatalogNoticeProps) {
  if (notice === 'cached-offline' || notice === 'cached-refresh-error') {
    const offline = notice === 'cached-offline';
    return (
      <View
        testID={`${id}-${offline ? 'cached-offline' : 'cached-error'}`}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.notice}
      >
        <Text style={styles.warning}>
          {offline
            ? catalogStrings.common.cachedOffline
            : catalogStrings.common.cachedRefreshFailed}
        </Text>
        <RetryButton
          id={id}
          accessibilityLabel={retryLabel}
          busy={retryBusy}
          onRetry={onRetry}
        />
      </View>
    );
  }
  if (notice === 'refreshing') {
    return (
      <View
        testID={`${id}-refreshing`}
        accessibilityRole="progressbar"
        accessibilityLabel={catalogStrings.common.refreshing}
        accessibilityLiveRegion="polite"
        style={styles.inlineLoading}
      >
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.status}>{catalogStrings.common.refreshing}</Text>
      </View>
    );
  }
  if (notice === 'stale') {
    return (
      <Text testID={`${id}-stale`} accessibilityLiveRegion="polite" style={styles.status}>
        {catalogStrings.common.stale}
      </Text>
    );
  }
  return null;
}

export function CatalogContentStatus({
  id,
  hasData,
  isPending,
  isFetching,
  isStale,
  fetchStatus,
  error,
  onRetry,
  retryLabel = catalogStrings.common.retry,
}: CatalogContentStatusProps) {
  const state = { hasData, isPending, isFetching, isStale, fetchStatus, error };
  const visual = visualState(state, false);
  return (
    <CatalogNotice
      id={id}
      notice={visual.notice}
      retryLabel={retryLabel}
      retryBusy={fetchStatus === 'fetching'}
      onRetry={onRetry}
    />
  );
}

interface CatalogQueryBoundaryProps extends CatalogQueryVisualState {
  id: string;
  empty: boolean;
  loadingLabel: string;
  emptyLabel: string;
  errorLabel?: string;
  retryLabel?: string;
  onRetry: () => void;
  children: React.ReactNode;
}

/** Query boundary without a heading, for embedded controls and result panes. */
export function CatalogQueryBoundary({
  id,
  hasData,
  empty,
  isPending,
  isFetching,
  isStale,
  fetchStatus,
  error,
  loadingLabel,
  emptyLabel,
  errorLabel = catalogStrings.common.loadFailed,
  retryLabel = catalogStrings.common.retry,
  onRetry,
  children,
}: CatalogQueryBoundaryProps) {
  const state = { hasData, isPending, isFetching, isStale, fetchStatus, error };
  const visual = visualState(state, empty);
  const retryBusy = fetchStatus === 'fetching';
  return (
    <View testID={id} style={styles.boundary}>
      {visual.body === 'loading' ? (
        <View
          testID={`${id}-loading`}
          accessibilityRole="progressbar"
          accessibilityLabel={loadingLabel}
          accessibilityLiveRegion="polite"
          style={styles.inlineLoading}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.status}>{loadingLabel}</Text>
        </View>
      ) : null}
      {visual.body === 'offline' ? (
        <BlockingState
          id={id}
          kind="offline"
          message={catalogStrings.common.offline}
          accessibilityLabel={retryLabel}
          busy={retryBusy}
          onRetry={onRetry}
          page={false}
        />
      ) : null}
      {visual.body === 'hard-error' ? (
        <BlockingState
          id={id}
          kind="error"
          message={errorLabel}
          accessibilityLabel={retryLabel}
          busy={retryBusy}
          onRetry={onRetry}
          page={false}
        />
      ) : null}
      {visual.body === 'empty' ? (
        <Text testID={`${id}-empty`} accessibilityLiveRegion="polite" style={styles.status}>
          {emptyLabel}
        </Text>
      ) : null}
      {visual.body === 'content' ? children : null}
      <CatalogNotice
        id={id}
        notice={visual.notice}
        retryLabel={retryLabel}
        retryBusy={retryBusy}
        onRetry={onRetry}
      />
    </View>
  );
}

interface CatalogSectionProps extends CatalogQueryVisualState {
  id: string;
  title: string;
  empty: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}

export function CatalogSection({
  id,
  title,
  hasData,
  empty,
  isPending,
  isFetching,
  isStale,
  fetchStatus,
  error,
  onRetry,
  children,
}: CatalogSectionProps) {
  const state = { hasData, isPending, isFetching, isStale, fetchStatus, error };
  const visual = visualState(state, empty);
  const sectionId = `catalog-section-${id}`;
  const retryLabel = catalogStrings.common.retrySection(title);
  return (
    <View testID={sectionId} style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
      {visual.body === 'loading' ? (
        <View
          testID={`${sectionId}-loading`}
          accessibilityRole="progressbar"
          accessibilityLabel={catalogStrings.common.sectionLoading(title)}
          accessibilityLiveRegion="polite"
          style={styles.inlineLoading}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.status}>{catalogStrings.common.sectionLoading(title)}</Text>
        </View>
      ) : null}
      {visual.body === 'offline' ? (
        <BlockingState
          id={sectionId}
          kind="offline"
          message={catalogStrings.common.offline}
          accessibilityLabel={retryLabel}
          busy={fetchStatus === 'fetching'}
          onRetry={onRetry}
          page={false}
        />
      ) : null}
      {visual.body === 'hard-error' ? (
        <BlockingState
          id={sectionId}
          kind="error"
          message={catalogStrings.common.loadFailed}
          accessibilityLabel={retryLabel}
          busy={fetchStatus === 'fetching'}
          onRetry={onRetry}
          page={false}
        />
      ) : null}
      {visual.body === 'empty' ? (
        <Text
          testID={`${sectionId}-empty`}
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {catalogStrings.common.sectionEmpty(title)}
        </Text>
      ) : null}
      {visual.body === 'content' ? children : null}
      <CatalogNotice
        id={sectionId}
        notice={visual.notice}
        retryLabel={retryLabel}
        retryBusy={fetchStatus === 'fetching'}
        onRetry={onRetry}
      />
    </View>
  );
}

export function CatalogRuntimeError({ id, message }: { id: string; message: string | null }) {
  if (message === null) return null;
  return (
    <Text
      testID={`${id}-runtime-error`}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={styles.runtimeError}
    >
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  pageState: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  section: { gap: 10 },
  boundary: { gap: 8 },
  heading: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    paddingHorizontal: 16,
  },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: 16 },
  notice: { gap: 8, paddingHorizontal: 16 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  errorBox: {
    alignSelf: 'stretch',
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 12,
    padding: 12,
    gap: 9,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  retry: {
    minHeight: metrics.minimumTouchTarget,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderRadius: 24,
    paddingHorizontal: 18,
    backgroundColor: colors.accent,
  },
  retryText: { color: colors.onAccent, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.54 },
  runtimeError: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
    marginHorizontal: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
  },
  pressed: { opacity: 0.76 },
});
