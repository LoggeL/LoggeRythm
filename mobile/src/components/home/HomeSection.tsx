import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  resolveRemoteVisualState,
  type RemoteFetchStatus,
} from '../../data/remoteState';
import { strings } from '../../localization';
import { colors, layout, radii, spacing } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import {
  AppText,
  CardRailSkeleton,
  EmptyState,
  ErrorState,
  RetryButton,
  SectionHeader,
  type CardRailSkeletonVariant,
} from '../ui';

/** The remote state of one Home section, straight from its query. */
export interface HomeSectionState {
  /** A successful response exists, including a successful empty one. */
  hasData: boolean;
  pending: boolean;
  fetching: boolean;
  fetchStatus: RemoteFetchStatus;
  stale: boolean;
  error: unknown;
  onRetry: () => void;
}

/** What a section-shaped loading placeholder receives from HomeSection. */
export interface HomeSectionSkeletonProps {
  testID: string;
  accessibilityLabel: string;
}

export interface HomeSectionProps extends HomeSectionState {
  id: string;
  title: string;
  subtitle?: string;
  /** The successful response has nothing to show. */
  empty: boolean;
  /** Placeholder shaped like the content. Defaults to a card rail. */
  skeleton?: (props: HomeSectionSkeletonProps) => React.ReactElement;
  /** CardRailSkeleton shape variant matching the actual shelf cards (prevents jumps). */
  skeletonVariant?: CardRailSkeletonVariant;
  /** Optional card size override for CardRailSkeleton (e.g. TV card sizing). */
  skeletonCardSize?: number;
  /** Optional genre/landscape card height override for CardRailSkeleton. */
  skeletonCardHeight?: number;
  /** Optional horizontal padding override for 16:9 TV layout. */
  paddingHorizontal?: number;
  /** On Android TV, decorative status markers stay non-accessible so Fabric never makes them D-Pad focusable. */
  tvMode?: boolean;
  /** Empty-state copy; defaults to the generic "nothing for <title>" line. */
  emptyTitle?: string;
  emptyMessage?: string;
  emptyIcon?: AppIconName;
  /** The next step out of the empty state, usually one ActionButton. */
  emptyAction?: React.ReactNode;
  children: React.ReactNode;
}

function railSkeleton(
  props: HomeSectionSkeletonProps,
  variant?: CardRailSkeletonVariant,
  size?: number,
  cardHeight?: number,
  paddingHorizontal?: number,
) {
  return (
    <CardRailSkeleton
      {...props}
      {...(variant !== undefined ? { variant } : {})}
      {...(size !== undefined ? { size } : {})}
      {...(cardHeight !== undefined ? { cardHeight } : {})}
      {...(paddingHorizontal !== undefined ? { style: { paddingHorizontal } } : {})}
    />
  );
}

/**
 * One titled block of the Home feed. It owns the whole remote-state contract
 * (`resolveRemoteVisualState`): a content-shaped skeleton, an offline or hard
 * error with the shared retry, a successful empty state with a next step, and
 * the cached-content notices. Refreshing and stale are quiet markers in the
 * header's trailing slot, so a background refetch never moves the feed.
 */
export function HomeSection({
  id,
  title,
  subtitle,
  hasData,
  pending,
  fetching,
  fetchStatus,
  stale,
  error,
  empty,
  onRetry,
  skeleton,
  skeletonVariant,
  skeletonCardSize,
  skeletonCardHeight,
  paddingHorizontal,
  tvMode = false,
  emptyTitle,
  emptyMessage,
  emptyIcon,
  emptyAction,
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
  const retryLabel = strings.home.retrySection(title);
  const retryTestID = `home-section-${id}-retry`;
  const gutterStyle =
    paddingHorizontal === undefined ? styles.gutter : { marginHorizontal: paddingHorizontal };
  const emptyStyle =
    paddingHorizontal === undefined
      ? styles.empty
      : [styles.empty, { marginHorizontal: paddingHorizontal }];
  const cachedNoticeStyle =
    paddingHorizontal === undefined
      ? styles.cachedNotice
      : [styles.cachedNotice, { paddingHorizontal }];
  const headerStyle =
    paddingHorizontal === undefined ? undefined : { paddingHorizontal };

  const marker =
    visual.notice === 'refreshing' ? (
      <View
        testID={`home-section-${id}-refreshing`}
        accessible={!tvMode}
        focusable={false}
        importantForAccessibility={tvMode ? 'no-hide-descendants' : undefined}
        accessibilityRole="progressbar"
        accessibilityLabel={`${title}. ${strings.home.sectionRefreshing}`}
        accessibilityLiveRegion="polite"
        style={styles.marker}
      >
        <ActivityIndicator accessible={false} color={colors.textMuted} size="small" />
      </View>
    ) : visual.notice === 'stale' ? (
      <View
        testID={`home-section-${id}-stale`}
        accessible={!tvMode}
        focusable={false}
        importantForAccessibility={tvMode ? 'no-hide-descendants' : undefined}
        accessibilityLabel={`${title}. ${strings.home.sectionStale}`}
        accessibilityLiveRegion="polite"
        style={styles.marker}
      >
        <AppIcon name="history" color={colors.textMuted} size={20} />
      </View>
    ) : undefined;

  const cachedNotice =
    visual.notice === 'cached-offline'
      ? { testID: `home-section-${id}-cached-offline`, text: strings.home.cachedOffline, icon: 'wifi-off' as const }
      : visual.notice === 'cached-refresh-error'
        ? {
            testID: `home-section-${id}-cached-error`,
            text: strings.home.cachedRefreshFailed,
            icon: 'alert-circle-outline' as const,
          }
        : null;

  const loadingProps: HomeSectionSkeletonProps = {
    testID: `home-section-${id}-loading`,
    accessibilityLabel: strings.home.sectionLoading(title),
  };

  return (
    <View testID={`home-section-${id}`} style={styles.section}>
      <SectionHeader title={title} subtitle={subtitle} trailing={marker} style={headerStyle} />
      {visual.body === 'loading'
        ? skeleton !== undefined
          ? skeleton(loadingProps)
          : railSkeleton(
              loadingProps,
              skeletonVariant,
              skeletonCardSize,
              skeletonCardHeight,
              paddingHorizontal,
            )
        : null}
      {visual.body === 'offline' ? (
        <ErrorState
          kind="offline"
          testID={`home-section-${id}-offline`}
          message={strings.home.sectionOffline}
          onRetry={onRetry}
          retryBusy={retryBusy}
          retryAccessibilityLabel={retryLabel}
          retryTestID={retryTestID}
          style={gutterStyle}
        />
      ) : null}
      {visual.body === 'hard-error' ? (
        <ErrorState
          testID={`home-section-${id}-error`}
          message={strings.home.sectionLoadFailed}
          onRetry={onRetry}
          retryBusy={retryBusy}
          retryAccessibilityLabel={retryLabel}
          retryTestID={retryTestID}
          style={gutterStyle}
        />
      ) : null}
      {visual.body === 'empty' ? (
        <EmptyState
          testID={`home-section-${id}-empty`}
          title={emptyTitle ?? strings.home.sectionEmpty(title)}
          message={emptyMessage}
          icon={emptyIcon}
          action={emptyAction}
          style={emptyStyle}
        />
      ) : null}
      {visual.body === 'content' ? children : null}
      {cachedNotice ? (
        <View
          testID={cachedNotice.testID}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={cachedNoticeStyle}
        >
          <View style={styles.cachedCopy}>
            <AppIcon name={cachedNotice.icon} color={colors.warning} size={20} />
            <AppText variant="callout" color="warning" style={styles.cachedText}>
              {cachedNotice.text}
            </AppText>
          </View>
          <RetryButton
            testID={retryTestID}
            onRetry={onRetry}
            busy={retryBusy}
            accessibilityLabel={retryLabel}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: layout.headerGap },
  gutter: { marginHorizontal: layout.pagePadding },
  empty: {
    marginHorizontal: layout.pagePadding,
    borderRadius: radii.panel,
    backgroundColor: colors.surface,
  },
  marker: {
    width: spacing.xl,
    height: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cachedNotice: { gap: spacing.xs, paddingHorizontal: layout.pagePadding },
  cachedCopy: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cachedText: { flex: 1 },
});
