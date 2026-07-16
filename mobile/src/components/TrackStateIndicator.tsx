import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type {
  TrackPlaybackPhase,
  TrackPresentationState,
} from '../player/trackPresentation';
import { colors } from '../theme';

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
  const labels = [phase, downloaded, server, rolling].filter(
    (label): label is string => label !== null && label.trim().length > 0,
  );

  if (labels.length === 0) return null;

  const buffering = presentation.playback === 'buffering';
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={labels.join('. ')}
      accessibilityState={{ selected: presentation.active, busy: buffering }}
      style={styles.container}
    >
      {phase !== null ? (
        <View testID={`${testID}-phase`} accessible={false} style={styles.fact}>
          {buffering ? (
            <ActivityIndicator
              testID={`${testID}-buffering-spinner`}
              accessible={false}
              color={colors.accent}
              size="small"
            />
          ) : null}
          <Text accessible={false} style={styles.phaseText}>{phase}</Text>
        </View>
      ) : null}
      {downloaded !== null ? (
        <Text
          testID={`${testID}-downloaded`}
          accessible={false}
          style={[styles.fact, styles.downloadedText]}
        >
          {downloaded}
        </Text>
      ) : null}
      {server !== null ? (
        <Text
          testID={`${testID}-server-cache`}
          accessible={false}
          style={[styles.fact, styles.serverText]}
        >
          {server}
        </Text>
      ) : null}
      {rolling !== null ? (
        <Text
          testID={`${testID}-rolling-cache`}
          accessible={false}
          style={[styles.fact, styles.rollingText]}
        >
          {rolling}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  phaseText: { color: colors.accentSoft, fontSize: 11, fontWeight: '700' },
  downloadedText: { color: colors.success, fontSize: 11, fontWeight: '700' },
  serverText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  rollingText: { color: colors.warning, fontSize: 11, fontWeight: '600' },
});
