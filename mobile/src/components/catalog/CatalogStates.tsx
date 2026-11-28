import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { isRateLimitStatus, rateLimitRetryAfterSeconds } from '../../api/error';
import {
  resolveRemoteVisualState,
  type RemoteNotice,
} from '../../data/remoteState';
import { catalogStrings } from '../../screens/catalogStrings';
import { colors, layout, radii, spacing } from '../../theme';
import {
  AppText,
  CardRailSkeleton,
  EmptyState,
  ErrorState,
  RetryButton,
  SectionHeader,
  TrackRowSkeleton,
} from '../ui';
import type { AppIconName } from '../AppIcon';
import { CatalogBlockSkeleton, CatalogPageSkeleton } from './CatalogSkeletons';
import type { CatalogQueryVisualState } from './catalogQueryState';

export type { CatalogQueryVisualState } from './catalogQueryState';

/**
 * The shape of the content a boundary stands in for while it loads:
 * `rail` album cards, `tracks` track shelf cards (with action row), `artists`
 * round cards, `playlists` wide playlist cards, `genres` landscape genre tiles,
 * `rows` track rows, `text` a paragraph, `pill` one button.
 */
export type CatalogSkeletonShape =
  | 'rail'
  | 'tracks'
  | 'artists'
  | 'playlists'
  | 'genres'
  | 'rows'
  | 'text'
  | 'pill';

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

interface CatalogLoadingProps {
  testID: string;
  label: string;
  shape: CatalogSkeletonShape;
  padded: boolean;
}

/** One loading presentation per content shape, always a labelled progressbar. */
function CatalogLoading({ testID, label, shape, padded }: CatalogLoadingProps) {
  const flush = padded ? undefined : styles.flush;
  if (shape === 'rows') {
    return (
      <TrackRowSkeleton testID={testID} accessibilityLabel={label} count={4} style={flush} />
    );
  }
  if (shape === 'text' || shape === 'pill') {
    return (
      <CatalogBlockSkeleton
        testID={testID}
        accessibilityLabel={label}
        shape={shape}
        padded={padded}
      />
    );
  }
  const variant =
    shape === 'tracks'
      ? 'track'
      : shape === 'playlists'
        ? 'playlist'
        : shape === 'genres'
          ? 'genre'
          : 'card';
  return (
    <CardRailSkeleton
      testID={testID}
      accessibilityLabel={label}
      round={shape === 'artists'}
      variant={variant}
      style={flush}
    />
  );
}

interface CatalogBlockingProps {
  id: string;
  body: 'offline' | 'hard-error';
  error: unknown;
  errorLabel: string;
  retryLabel: string;
  retryBusy: boolean;
  onRetry: () => void;
  page: boolean;
  padded: boolean;
}

function catalogRateLimitMessage(error: unknown, cached: boolean): string | null {
  if (!isRateLimitStatus(error)) return null;
  const waitSec = rateLimitRetryAfterSeconds(error);
  if (cached) {
    return waitSec !== null
      ? catalogStrings.common.cachedRateLimitedWait(waitSec)
      : catalogStrings.common.cachedRateLimited;
  }
  return waitSec !== null
    ? catalogStrings.common.rateLimitedWait(waitSec)
    : catalogStrings.common.rateLimited;
}

/** The one blocking failure presentation: offline or error, always retryable. */
function CatalogBlocking({
  id,
  body,
  error,
  errorLabel,
  retryLabel,
  retryBusy,
  onRetry,
  page,
  padded,
}: CatalogBlockingProps) {
  const offline = body === 'offline';
  const rateLimitMessage = offline ? null : catalogRateLimitMessage(error, false);
  return (
    <ErrorState
      testID={`${id}-${offline ? 'offline' : 'error'}`}
      retryTestID={`${id}-retry`}
      kind={offline ? 'offline' : 'error'}
      layout={page ? 'page' : 'inline'}
      message={offline ? catalogStrings.common.offline : (rateLimitMessage ?? errorLabel)}
      onRetry={onRetry}
      retryBusy={retryBusy}
      retryLabel={retryBusy ? catalogStrings.common.retrying : catalogStrings.common.retry}
      retryAccessibilityLabel={retryLabel}
      style={!page && padded ? styles.inset : undefined}
    />
  );
}

interface CatalogNoticeProps {
  id: string;
  notice: RemoteNotice;
  error: unknown;
  retryLabel: string;
  retryBusy: boolean;
  onRetry: () => void;
  padded: boolean;
  /** false where a pull-to-refresh control already reports the refresh. */
  refreshIndicator: boolean;
}

/** The non-blocking line above cached content. At most one is ever shown. */
function CatalogNotice({
  id,
  notice,
  error,
  retryLabel,
  retryBusy,
  onRetry,
  padded,
  refreshIndicator,
}: CatalogNoticeProps) {
  const inset = padded ? styles.inset : undefined;
  if (notice === 'cached-offline' || notice === 'cached-refresh-error') {
    const offline = notice === 'cached-offline';
    const rateLimitMessage = offline ? null : catalogRateLimitMessage(error, true);
    return (
      <View
        testID={`${id}-${offline ? 'cached-offline' : 'cached-error'}`}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.notice, inset]}
      >
        <AppText variant="callout" color="warning">
          {offline
            ? catalogStrings.common.cachedOffline
            : (rateLimitMessage ?? catalogStrings.common.cachedRefreshFailed)}
        </AppText>
        <RetryButton
          testID={`${id}-retry`}
          label={retryBusy ? catalogStrings.common.retrying : catalogStrings.common.retry}
          accessibilityLabel={retryLabel}
          busy={retryBusy}
          onRetry={onRetry}
        />
      </View>
    );
  }
  if (notice === 'refreshing') {
    if (!refreshIndicator) return null;
    return (
      <View
        testID={`${id}-refreshing`}
        accessibilityRole="progressbar"
        accessibilityLabel={catalogStrings.common.refreshing}
        accessibilityLiveRegion="polite"
        style={[styles.refreshing, inset]}
      >
        <ActivityIndicator accessible={false} color={colors.accent} size="small" />
        <AppText variant="caption" color="muted">{catalogStrings.common.refreshing}</AppText>
      </View>
    );
  }
  if (notice === 'stale') {
    return (
      <AppText
        testID={`${id}-stale`}
        accessibilityLiveRegion="polite"
        variant="caption"
        color="muted"
        style={inset}
      >
        {catalogStrings.common.stale}
      </AppText>
    );
  }
  return null;
}

interface CatalogPageGateProps extends CatalogQueryVisualState {
  id: string;
  loadingLabel: string;
  onRetry: () => void;
  /** Shapes the first-load skeleton: `artist` has a round hero, `compact` matches GenreScreen. */
  variant?: 'collection' | 'artist' | 'compact';
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
  variant = 'collection',
}: CatalogPageGateProps) {
  const state = { hasData, isPending, isFetching, isStale, fetchStatus, error };
  const visual = visualState(state, false);
  if (visual.body === 'loading') {
    return (
      <CatalogPageSkeleton
        testID={`${id}-loading`}
        accessibilityLabel={loadingLabel}
        round={variant === 'artist'}
        compact={variant === 'compact'}
      />
    );
  }
  if (visual.body === 'offline' || visual.body === 'hard-error') {
    return (
      <CatalogBlocking
        id={id}
        body={visual.body}
        error={error}
        errorLabel={catalogStrings.common.loadFailed}
        retryLabel={catalogStrings.common.retry}
        retryBusy={fetchStatus === 'fetching'}
        onRetry={onRetry}
        page
        padded={false}
      />
    );
  }
  return null;
}

interface CatalogContentStatusProps extends CatalogQueryVisualState {
  id: string;
  onRetry: () => void;
  retryLabel?: string;
  /** Applies the page gutter. Disable inside an already padded container. */
  padded?: boolean;
  /**
   * Show the inline "refreshing" line. Pass false on pages whose list owns a
   * pull-to-refresh control, so a background refresh does not shift content.
   */
  refreshIndicator?: boolean;
}

/** The notice line of a page that already shows cached content. */
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
  padded = true,
  refreshIndicator = true,
}: CatalogContentStatusProps) {
  const state = { hasData, isPending, isFetching, isStale, fetchStatus, error };
  const visual = visualState(state, false);
  return (
    <CatalogNotice
      id={id}
      notice={visual.notice}
      error={error}
      retryLabel={retryLabel}
      retryBusy={fetchStatus === 'fetching'}
      onRetry={onRetry}
      padded={padded}
      refreshIndicator={refreshIndicator}
    />
  );
}

interface CatalogBoundaryBodyProps extends CatalogQueryVisualState {
  id: string;
  empty: boolean;
  loadingLabel: string;
  emptyLabel: string;
  emptyIcon?: AppIconName;
  emptyAction?: React.ReactNode;
  errorLabel: string;
  retryLabel: string;
  skeleton: CatalogSkeletonShape;
  padded: boolean;
  /** Show the inline "refreshing" line below the body. */
  refreshIndicator: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}

/** Body + notice of one remote collection: the shared core of every boundary. */
function CatalogBoundaryBody({
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
  emptyIcon,
  emptyAction,
  errorLabel,
  retryLabel,
  skeleton,
  padded,
  refreshIndicator,
  onRetry,
  children,
}: CatalogBoundaryBodyProps) {
  const state = { hasData, isPending, isFetching, isStale, fetchStatus, error };
  const visual = visualState(state, empty);
  const retryBusy = fetchStatus === 'fetching';
  return (
    <>
      {visual.body === 'loading' ? (
        <CatalogLoading
          testID={`${id}-loading`}
          label={loadingLabel}
          shape={skeleton}
          padded={padded}
        />
      ) : null}
      {visual.body === 'offline' || visual.body === 'hard-error' ? (
        <CatalogBlocking
          id={id}
          body={visual.body}
          error={error}
          errorLabel={errorLabel}
          retryLabel={retryLabel}
          retryBusy={retryBusy}
          onRetry={onRetry}
          page={false}
          padded={padded}
        />
      ) : null}
      {visual.body === 'empty' ? (
        <EmptyState
          testID={`${id}-empty`}
          title={emptyLabel}
          icon={emptyIcon}
          action={emptyAction}
        />
      ) : null}
      {visual.body === 'content' ? children : null}
      <CatalogNotice
        id={id}
        notice={visual.notice}
        error={error}
        retryLabel={retryLabel}
        retryBusy={retryBusy}
        onRetry={onRetry}
        padded={padded}
        refreshIndicator={refreshIndicator}
      />
    </>
  );
}

interface CatalogBoundaryOptions {
  /** Placeholder shape while loading. Defaults to a card rail. */
  skeleton?: CatalogSkeletonShape;
  /** Glyph and next step of the empty state. */
  emptyIcon?: AppIconName;
  emptyAction?: React.ReactNode;
  /** Applies the page gutter to states. Disable inside an already padded container. */
  padded?: boolean;
}

interface CatalogQueryBoundaryProps extends CatalogQueryVisualState, CatalogBoundaryOptions {
  /**
   * Show the inline "refreshing" line below the content. Pass false where a
   * pull-to-refresh control already reports the refresh, so a background
   * refetch does not grow the boundary and shift what follows it.
   */
  refreshIndicator?: boolean;
  id: string;
  empty: boolean;
  loadingLabel: string;
  emptyLabel: string;
  errorLabel?: string;
  retryLabel?: string;
  onRetry: () => void;
  children: React.ReactNode;
  /** Layout of the boundary itself, e.g. `flex: 1` inside a row. */
  style?: StyleProp<ViewStyle>;
}

/** Query boundary without a heading, for embedded controls and result panes. */
export function CatalogQueryBoundary({
  id,
  errorLabel = catalogStrings.common.loadFailed,
  retryLabel = catalogStrings.common.retry,
  skeleton = 'rows',
  padded = true,
  refreshIndicator = true,
  children,
  style,
  ...query
}: CatalogQueryBoundaryProps) {
  return (
    <View testID={id} style={[styles.boundary, style]}>
      <CatalogBoundaryBody
        id={id}
        errorLabel={errorLabel}
        retryLabel={retryLabel}
        skeleton={skeleton}
        padded={padded}
        refreshIndicator={refreshIndicator}
        {...query}
      >
        {children}
      </CatalogBoundaryBody>
    </View>
  );
}

interface CatalogSectionProps extends CatalogQueryVisualState, CatalogBoundaryOptions {
  id: string;
  title: string;
  empty: boolean;
  /** Overrides the generic "nothing available for <title>" empty copy. */
  emptyLabel?: string;
  onRetry: () => void;
  children: React.ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
}

/**
 * A titled section of a screen with the full remote-state contract. A
 * background refresh is a quiet marker in the heading's trailing slot, never
 * an extra line, so refetching does not move the section or what follows it.
 */
export function CatalogSection({
  id,
  title,
  emptyLabel = catalogStrings.common.sectionEmpty(title),
  skeleton = 'rail',
  padded = true,
  children,
  onLayout,
  ...query
}: CatalogSectionProps) {
  const sectionId = `catalog-section-${id}`;
  const { hasData, isPending, isFetching, isStale, fetchStatus, error, empty } = query;
  const refreshing =
    visualState({ hasData, isPending, isFetching, isStale, fetchStatus, error }, empty)
      .notice === 'refreshing';
  return (
    <View testID={sectionId} style={styles.section} onLayout={onLayout}>
      <SectionHeader
        title={title}
        padded={padded}
        trailing={
          refreshing ? (
            <View
              testID={`${sectionId}-refreshing`}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={`${title}. ${catalogStrings.common.refreshing}`}
              accessibilityLiveRegion="polite"
              style={styles.marker}
            >
              <ActivityIndicator accessible={false} color={colors.textMuted} size="small" />
            </View>
          ) : undefined
        }
      />
      <CatalogBoundaryBody
        id={sectionId}
        loadingLabel={catalogStrings.common.sectionLoading(title)}
        emptyLabel={emptyLabel}
        errorLabel={catalogStrings.common.loadFailed}
        retryLabel={catalogStrings.common.retrySection(title)}
        skeleton={skeleton}
        padded={padded}
        refreshIndicator={false}
        {...query}
      >
        {children}
      </CatalogBoundaryBody>
    </View>
  );
}

/** A failed user action (playback, follow) on a page that otherwise works. */
export function CatalogRuntimeError({
  id,
  message,
  padded = true,
}: {
  id: string;
  message: string | null;
  padded?: boolean;
}) {
  if (message === null) return null;
  return (
    <ErrorState
      testID={`${id}-runtime-error`}
      message={message}
      style={padded ? styles.inset : undefined}
    />
  );
}

const styles = StyleSheet.create({
  section: { gap: layout.headerGap },
  boundary: { gap: spacing.xs },
  inset: { marginHorizontal: layout.pagePadding },
  flush: { paddingHorizontal: 0 },
  notice: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.panel,
    backgroundColor: colors.warningSubtle,
  },
  refreshing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // Fits inside the heading's line box, so the header keeps its height.
  marker: {
    width: spacing.xl,
    height: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
