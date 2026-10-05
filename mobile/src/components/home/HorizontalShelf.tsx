import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  resolveRemoteVisualState,
  type RemoteFetchStatus,
} from '../../data/remoteState';
import { strings } from '../../localization';
import { colors, metrics, radii, spacing, typography } from '../../theme';

interface HomeSectionProps {
  id: string;
  title: string;
  hasData: boolean;
  pending: boolean;
  fetching: boolean;
  fetchStatus: RemoteFetchStatus;
  stale: boolean;
  error: unknown;
  empty: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}

function retryButton(id: string, title: string, busy: boolean, onRetry: () => void) {
  return (
    <Pressable
      testID={`home-section-${id}-retry`}
      accessibilityRole="button"
      accessibilityLabel={strings.home.retrySection(title)}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onRetry}
      style={({ pressed }) => [styles.retry, pressed && styles.pressed, busy && styles.disabled]}
    >
      <Text style={styles.retryText}>{strings.common.retry}</Text>
    </Pressable>
  );
}

export function HomeSection({
  id,
  title,
  hasData,
  pending,
  fetching,
  fetchStatus,
  stale,
  error,
  empty,
  onRetry,
  children,
}: HomeSectionProps) {
  const visual = resolveRemoteVisualState({
    hasData,
    empty,
    pending,
    fetching,
    stale,
    fetchStatus,
    error,
  });
  const retryBusy = fetchStatus === 'fetching';
  return (
    <View testID={`home-section-${id}`} style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
      {visual.body === 'loading' ? (
        <Text
          testID={`home-section-${id}-loading`}
          accessibilityRole="progressbar"
          accessibilityLabel={strings.home.sectionLoading(title)}
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {strings.home.sectionLoading(title)}
        </Text>
      ) : null}
      {visual.body === 'offline' ? (
        <View
          testID={`home-section-${id}-offline`}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorBox}
        >
          <Text style={styles.error}>{strings.home.sectionOffline}</Text>
          {retryButton(id, title, retryBusy, onRetry)}
        </View>
      ) : null}
      {visual.body === 'hard-error' ? (
        <View
          testID={`home-section-${id}-error`}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorBox}
        >
          <Text style={styles.error}>{strings.home.sectionLoadFailed}</Text>
          {retryButton(id, title, retryBusy, onRetry)}
        </View>
      ) : null}
      {visual.body === 'empty' ? (
        <Text
          testID={`home-section-${id}-empty`}
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {strings.home.sectionEmpty(title)}
        </Text>
      ) : null}
      {visual.body === 'content' ? children : null}
      {visual.notice === 'cached-offline' ? (
        <View
          testID={`home-section-${id}-cached-offline`}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.cachedNotice}
        >
          <Text style={styles.staleError}>{strings.home.cachedOffline}</Text>
          {retryButton(id, title, retryBusy, onRetry)}
        </View>
      ) : null}
      {visual.notice === 'cached-refresh-error' ? (
        <View
          testID={`home-section-${id}-cached-error`}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.cachedNotice}
        >
          <Text style={styles.staleError}>
            {strings.home.cachedRefreshFailed}
          </Text>
          {retryButton(id, title, retryBusy, onRetry)}
        </View>
      ) : null}
      {visual.notice === 'refreshing' ? (
        <Text
          testID={`home-section-${id}-refreshing`}
          accessibilityRole="progressbar"
          accessibilityLabel={`${title}. ${strings.home.sectionRefreshing}`}
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {strings.home.sectionRefreshing}
        </Text>
      ) : null}
      {visual.notice === 'stale' ? (
        <Text
          testID={`home-section-${id}-stale`}
          accessibilityLabel={`${title}. ${strings.home.sectionStale}`}
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {strings.home.sectionStale}
        </Text>
      ) : null}
    </View>
  );
}

interface HorizontalShelfProps<T> {
  id: string;
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactElement;
}

export function HorizontalShelf<T>({ id, data, keyExtractor, renderItem }: HorizontalShelfProps<T>) {
  return (
    <FlatList
      testID={`home-shelf-${id}`}
      horizontal
      data={[...data]}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => renderItem(item, index)}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
    />
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  heading: { ...typography.section, color: colors.textPrimary, paddingHorizontal: spacing.lg },
  rail: { gap: spacing.md, paddingHorizontal: spacing.lg },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: spacing.lg },
  staleError: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  cachedNotice: { gap: spacing.xs, paddingHorizontal: spacing.lg },
  errorBox: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSubtle,
    gap: 8,
  },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  retry: {
    minHeight: metrics.minimumTouchTarget,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  retryText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.74 },
  disabled: { opacity: 0.5 },
});
