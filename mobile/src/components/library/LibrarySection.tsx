import React from 'react';
import { StyleSheet, View } from 'react-native';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, layout, radii, spacing } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import {
  AppText,
  EmptyState,
  ErrorState,
  SectionHeader,
  TrackRowSkeleton,
} from '../ui';
import { InlineNotice } from './InlineNotice';
import {
  resolveLibrarySectionVisualState,
  type LibrarySectionState,
} from './librarySectionState';

interface SharedSectionProps {
  id: string;
  title: string;
  state: LibrarySectionState;
  action?: React.ReactNode;
  /** Renders the trailing "show all" link, e.g. when only a preview is listed. */
  onShowAll?: () => void;
  children: React.ReactNode;
}

interface QuerySectionProps extends SharedSectionProps {
  state: Extract<LibrarySectionState, { kind: 'query' }>;
  emptyText: string;
  /** The next step shown under the empty title. */
  emptyHint?: string;
  emptyIcon?: AppIconName;
  emptyAction?: React.ReactNode;
  onRetry: () => void;
}

interface PolicySectionProps extends SharedSectionProps {
  state: Extract<LibrarySectionState, { kind: 'policy' }>;
  emptyText?: never;
  emptyHint?: never;
  emptyIcon?: never;
  emptyAction?: never;
  onRetry?: never;
}

export type LibrarySectionProps = QuerySectionProps | PolicySectionProps;

type WithoutChildren<T> = T extends unknown ? Omit<T, 'children'> : never;

/** State/title/action contract shared by the virtualized and legacy section owners. */
export type LibrarySectionPresentationProps = WithoutChildren<LibrarySectionProps>;

/** Skeleton rows per loading section: enough to hold the layout, few enough to scan. */
const LOADING_ROWS = 3;

/** Whether a section's item rows are safe to expose for its current remote state. */
export function librarySectionShowsContent(
  state: LibrarySectionState,
): boolean {
  return state.kind === 'policy' || resolveLibrarySectionVisualState(state).body === 'content';
}

function heading(props: LibrarySectionPresentationProps) {
  return (
    <SectionHeader
      title={props.title}
      trailing={props.action}
      onShowAll={props.onShowAll}
      showAllAccessibilityLabel={libraryStrings.library.showSection(props.title)}
      showAllTestID={`library-section-${props.id}-show-all`}
    />
  );
}

/**
 * Shared section heading/body-state presenter. SectionList uses this as its
 * header so row data remains virtualized without changing loading/error/empty
 * semantics.
 */
export function LibrarySectionHeader(props: LibrarySectionPresentationProps) {
  const { id, title } = props;
  const sectionId = `library-section-${id}`;

  if (props.state.kind === 'policy') {
    return (
      <View testID={sectionId} style={styles.heading}>
        {heading(props)}
      </View>
    );
  }

  const { onRetry, emptyText } = props;
  if (onRetry === undefined) {
    throw new Error('Remote Library sections require an onRetry callback');
  }
  if (emptyText === undefined) {
    throw new Error('Remote Library sections require an emptyText');
  }
  const visual = resolveLibrarySectionVisualState(props.state);
  const retryBusy = props.state.fetching;
  const failed = visual.body === 'offline' || visual.body === 'hard-error';
  return (
    <View testID={sectionId} style={styles.heading}>
      {heading(props)}

      {visual.body === 'loading' ? (
        <TrackRowSkeleton
          testID={`${sectionId}-loading`}
          accessibilityLabel={libraryStrings.library.loadingSection(title)}
          count={LOADING_ROWS}
        />
      ) : null}

      {failed ? (
        <ErrorState
          testID={`${sectionId}-${visual.body === 'offline' ? 'offline' : 'error'}`}
          kind={visual.body === 'offline' ? 'offline' : 'error'}
          message={
            visual.body === 'offline'
              ? libraryStrings.common.offline
              : libraryStrings.common.loadFailed
          }
          onRetry={onRetry}
          retryBusy={retryBusy}
          retryTestID={`${sectionId}-retry`}
          retryAccessibilityLabel={libraryStrings.library.retrySection(title)}
          style={styles.gutter}
        />
      ) : null}

      {visual.body === 'empty' ? (
        <EmptyState
          testID={`${sectionId}-empty`}
          title={emptyText}
          message={props.emptyHint}
          icon={props.emptyIcon}
          action={props.emptyAction}
        />
      ) : null}
    </View>
  );
}

/** Shared last-good/stale notice presenter placed after virtualized rows. */
export function LibrarySectionFooter(props: LibrarySectionPresentationProps) {
  if (props.state.kind === 'policy') return null;

  const { id, title } = props;
  const sectionId = `library-section-${id}`;
  const visual = resolveLibrarySectionVisualState(props.state);
  const retryBusy = props.state.fetching;
  const onRetry = props.onRetry;
  if (onRetry === undefined) {
    throw new Error('Remote Library sections require an onRetry callback');
  }

  if (visual.notice === null) return null;

  const cached = visual.notice === 'cached-offline' || visual.notice === 'cached-refresh-error';
  return (
    <View testID={`${sectionId}-footer`} style={styles.footer}>
      {cached ? (
        <InlineNotice
          testID={`${sectionId}-${visual.notice === 'cached-offline' ? 'cached-offline' : 'cached-error'}`}
          message={
            visual.notice === 'cached-offline'
              ? libraryStrings.common.cachedOffline
              : libraryStrings.common.cachedRefreshFailed
          }
          retry={{
            testID: `${sectionId}-retry`,
            accessibilityLabel: libraryStrings.library.retrySection(title),
            busy: retryBusy,
            onRetry,
          }}
        />
      ) : null}

      {visual.notice === 'refreshing' ? (
        <AppText
          testID={`${sectionId}-refreshing`}
          accessibilityRole="progressbar"
          accessibilityLabel={libraryStrings.common.refreshing}
          accessibilityLiveRegion="polite"
          variant="caption"
          color="muted"
        >
          {libraryStrings.common.refreshing}
        </AppText>
      ) : null}

      {visual.notice === 'stale' ? (
        <View
          testID={`${sectionId}-stale`}
          accessible
          accessibilityLabel={libraryStrings.common.stale}
          accessibilityLiveRegion="polite"
          style={styles.staleMarker}
        >
          <AppIcon name="database-check-outline" color={colors.textMuted} size={15} />
        </View>
      ) : null}
    </View>
  );
}

/** Shared state contract for every remote Library collection and static policy section. */
export function LibrarySection(props: LibrarySectionProps) {
  return (
    <View>
      {LibrarySectionHeader(props)}
      {librarySectionShowsContent(props.state) ? props.children : null}
      {LibrarySectionFooter(props)}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { gap: layout.headerGap, paddingBottom: spacing.xs },
  gutter: { marginHorizontal: layout.pagePadding },
  footer: { gap: spacing.xs, paddingTop: spacing.xs, paddingHorizontal: layout.pagePadding },
  staleMarker: {
    alignSelf: 'flex-start',
    padding: spacing.xxs,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
});
