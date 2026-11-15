import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { strings } from '../../localization';
import type { RadioContentState } from '../../screens/radioModel';
import { layout, spacing } from '../../theme';
import { RemoteNoticeView } from '../RemoteNoticeView';
import { EmptyState, ErrorState, SectionHeader, Skeleton } from '../ui';
import { RADIO_TILE_WIDTH } from './radioLayout';

export interface RadioSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  state: RadioContentState;
  loadingText: string;
  /** Shown for a successful empty result; phrase it as the next step. */
  emptyText: string;
  busy: boolean;
  onRetry: () => void;
  /** The station rail, rendered only for `content`. */
  children: ReactNode;
}

/** The localized notice lines shared by the radio sections and mood stations. */
export function radioNoticeCopy() {
  return {
    cachedOffline: strings.radio.cachedOffline,
    cachedRefreshFailed: strings.radio.cachedRefreshFailed,
    refreshing: strings.radio.refreshing,
    stale: strings.radio.stale,
  };
}

/** Placeholder rail shaped like the station tiles; the group is the labelled progressbar. */
function RadioRailSkeleton({ testID, label }: { testID: string; label: string }) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={styles.skeletonRail}
    >
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonTile}>
          <Skeleton width={RADIO_TILE_WIDTH} height={RADIO_TILE_WIDTH} radius="card" />
          <Skeleton width="45%" height={10} />
          <Skeleton width="85%" height={14} />
          <Skeleton width="60%" height={12} />
        </View>
      ))}
    </View>
  );
}

/**
 * RadioSection is one titled shelf of the radio screen. It maps the shared
 * remote visual state to exactly one body — tile skeletons, an offline or
 * failure ErrorState with retry, an EmptyState, or the rail passed as
 * children — plus the single notice line that may accompany cached content.
 */
export function RadioSection({
  id,
  title,
  subtitle,
  state,
  loadingText,
  emptyText,
  busy,
  onRetry,
  children,
}: RadioSectionProps) {
  const prefix = `radio-section-${id}`;
  const retryLabel = strings.radio.retryStation(title);
  return (
    <View testID={prefix} style={styles.section}>
      <SectionHeader title={title} subtitle={subtitle} />
      {state.body === 'loading' ? (
        <RadioRailSkeleton testID={`${prefix}-loading`} label={loadingText} />
      ) : null}
      {state.body === 'offline' || state.body === 'hard-error' ? (
        <ErrorState
          testID={`${prefix}-${state.body === 'offline' ? 'offline' : 'error'}`}
          retryTestID={`${prefix}-${state.body === 'offline' ? 'offline' : 'error'}-retry`}
          kind={state.body === 'offline' ? 'offline' : 'error'}
          message={state.body === 'offline' ? strings.radio.sectionOffline : strings.radio.loadFailed}
          onRetry={onRetry}
          retryBusy={busy}
          retryAccessibilityLabel={retryLabel}
          style={styles.gutter}
        />
      ) : null}
      {state.body === 'empty' ? (
        <EmptyState testID={`${prefix}-empty`} icon="radio" title={emptyText} style={styles.gutter} />
      ) : null}
      {state.body === 'content' ? children : null}
      <RemoteNoticeView
        notice={state.notice}
        testIDPrefix={prefix}
        copy={radioNoticeCopy()}
        retryAccessibilityLabel={retryLabel}
        busy={busy}
        onRetry={onRetry}
        style={styles.gutter}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: layout.headerGap },
  gutter: { marginHorizontal: layout.pagePadding },
  skeletonRail: {
    flexDirection: 'row',
    gap: layout.railGap,
    paddingHorizontal: layout.pagePadding,
    overflow: 'hidden',
  },
  skeletonTile: { width: RADIO_TILE_WIDTH, gap: spacing.xs },
});
