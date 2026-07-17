import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type {
  TrackPlaybackPhase,
  TrackPresentationState,
} from '../player/trackPresentation';
import { colors } from '../theme';
import AppIcon from './AppIcon';

export interface TrackStateIndicatorCopy {
  playing: string;
  paused: string;
  buffering: string;
  active: string;
  downloaded: string;
  serverCached: string;
  rollingDeviceCache: (seconds: number) => string;
}

export interface TrackStateIndicatorProps {
  presentation: TrackPresentationState;
  copy: TrackStateIndicatorCopy;
  testID?: string;
}

function phaseLabel(
  phase: TrackPlaybackPhase,
  copy: TrackStateIndicatorCopy,
): string | null {
  switch (phase) {
    case 'playing':
      return copy.playing;
    case 'paused':
      return copy.paused;
    case 'buffering':
      return copy.buffering;
    case 'active':
      return copy.active;
    case 'inactive':
      return null;
  }
}

/**
 * Shared evidence-only marker. Unknown or absent explicit downloads render
 * nothing, and rolling LRU data is never styled or announced as a download.
 */
export default function TrackStateIndicator({
  presentation,
  copy,
  testID = 'track-state',
}: TrackStateIndicatorProps) {
  const phase = phaseLabel(presentation.playback, copy);
  const downloaded =
    presentation.explicitDownload.kind === 'downloaded' ? copy.downloaded : null;
  const server =
    presentation.serverCache === 'cached' ? copy.serverCached : null;
  const rollingSeconds =
    presentation.active
    && presentation.rollingDeviceCache?.kind === 'rolling-lru'
    && Number.isFinite(presentation.rollingDeviceCache.seconds)
    && presentation.rollingDeviceCache.seconds > 0
      ? presentation.rollingDeviceCache.seconds
      : null;
  const rolling =
    rollingSeconds === null ? null : copy.rollingDeviceCache(rollingSeconds);
  const buffering = presentation.playback === 'buffering';
  const labels = [buffering ? phase : null, downloaded, server, rolling].filter(
    (label): label is string => label !== null && label.trim().length > 0,
  );

  if (labels.length === 0) return null;

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={labels.join('. ')}
      accessibilityState={{ selected: presentation.active, busy: buffering }}
      style={styles.container}
    >
      {buffering ? (
        <View testID={`${testID}-phase`} accessible={false} style={styles.iconFact}>
          <ActivityIndicator
            testID={`${testID}-buffering-spinner`}
            accessible={false}
            color={colors.accent}
            size="small"
          />
        </View>
      ) : null}
      {downloaded !== null ? (
        <View
          testID={`${testID}-downloaded`}
          accessible={false}
          style={styles.iconFact}
        >
          <AppIcon name="download-circle" color={colors.success} size={15} />
        </View>
      ) : null}
      {server !== null ? (
        <View
          testID={`${testID}-server-cache`}
          accessible={false}
          style={styles.iconFact}
        >
          <AppIcon name="cloud-check-outline" color={colors.textSecondary} size={15} />
        </View>
      ) : null}
      {rolling !== null ? (
        <View
          testID={`${testID}-rolling-cache`}
          accessible={false}
          style={styles.rollingFact}
        >
          <AppIcon name="cached" color={colors.warning} size={13} />
          <Text accessible={false} style={styles.rollingText}>
            {Math.round(rollingSeconds as number)}s
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 3,
    marginLeft: 4,
  },
  iconFact: {
    width: 21,
    height: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    backgroundColor: colors.surfaceElevated,
  },
  rollingFact: {
    height: 21,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    borderRadius: 7,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 4,
  },
  rollingText: { color: colors.warning, fontSize: 9, fontWeight: '700' },
});
