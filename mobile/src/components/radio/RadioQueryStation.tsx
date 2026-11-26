import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { RemoteVisualState } from '../../data/remoteState';
import { strings } from '../../localization';
import { colors, layout, radii, spacing } from '../../theme';
import { RemoteNoticeView } from '../RemoteNoticeView';
import { EmptyState, ErrorState, Skeleton } from '../ui';
import { RADIO_WIDE_HEIGHT, RADIO_WIDE_WIDTH } from './radioLayout';
import { radioNoticeCopy } from './RadioSection';
import { RadioStationCard } from './RadioStationCard';

export interface RadioQueryStationProps {
  testID: string;
  title: string;
  subtitle?: string;
  cover: string;
  state: RemoteVisualState;
  queryBusy: boolean;
  stationBusy: boolean;
  blocked: boolean;
  onAir?: boolean;
  onAirPlaying?: boolean;
  loadingText: string;
  emptyText: string;
  onPress: () => void;
  onRetry: () => void;
}

/**
 * A mood station owns its query body/notice separately from its playback
 * action state: the slot keeps one fixed footprint while it shows a
 * skeleton, an error with its own retry, an empty note or the playable card.
 */
export function RadioQueryStation({
  testID,
  title,
  subtitle,
  cover,
  state,
  queryBusy,
  stationBusy,
  blocked,
  onAir = false,
  onAirPlaying = true,
  loadingText,
  emptyText,
  onPress,
  onRetry,
}: RadioQueryStationProps) {
  const retryLabel = strings.radio.retryStation(title);
  const failure = state.body === 'offline' ? 'offline' : state.body === 'hard-error' ? 'error' : null;
  return (
    <View testID={`${testID}-query`} style={styles.slot}>
      {state.body === 'loading' ? (
        <View
          testID={`${testID}-loading`}
          accessibilityRole="progressbar"
          accessibilityLabel={loadingText}
          accessibilityLiveRegion="polite"
          style={styles.skeleton}
        >
          <Skeleton width={layout.artwork.lg} height={layout.artwork.lg} radius="card" />
          <View style={styles.skeletonCopy}>
            <Skeleton width="40%" height={10} />
            <Skeleton width="80%" height={14} />
            <Skeleton width="65%" height={12} />
          </View>
        </View>
      ) : null}
      {failure !== null ? (
        <ErrorState
          testID={`${testID}-${failure}`}
          retryTestID={`${testID}-${failure}-retry`}
          kind={failure}
          title={title}
          message={failure === 'offline' ? strings.radio.sectionOffline : strings.radio.loadFailed}
          onRetry={onRetry}
          retryBusy={queryBusy}
          retryAccessibilityLabel={retryLabel}
          style={styles.state}
        />
      ) : null}
      {state.body === 'empty' ? (
        <EmptyState
          testID={`${testID}-empty`}
          icon="radio"
          title={title}
          message={emptyText}
          style={[styles.state, styles.empty]}
        />
      ) : null}
      {state.body === 'content' ? (
        <RadioStationCard
          testID={testID}
          title={title}
          subtitle={subtitle}
          cover={cover}
          variant="mood"
          busy={stationBusy}
          blocked={blocked}
          onAir={onAir}
          onAirPlaying={onAirPlaying}
          onPress={onPress}
        />
      ) : null}
      <RemoteNoticeView
        notice={state.notice}
        testIDPrefix={testID}
        copy={radioNoticeCopy()}
        retryAccessibilityLabel={retryLabel}
        busy={queryBusy}
        onRetry={onRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { width: RADIO_WIDE_WIDTH, gap: spacing.xs },
  skeleton: {
    minHeight: RADIO_WIDE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  skeletonCopy: { flex: 1, gap: spacing.xs },
  state: { minHeight: RADIO_WIDE_HEIGHT },
  empty: {
    justifyContent: 'center',
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
});
