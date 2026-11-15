import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type {
  TrackPlaybackPhase,
  TrackPresentationState,
} from '../player/trackPresentation';
import { colors, radii, spacing, typography } from '../theme';
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

const GLYPH_SIZE = typography.callout.fontSize;
const FACT_SIZE = typography.callout.lineHeight;

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
          <AppIcon name="download-circle" color={colors.success} size={GLYPH_SIZE} />
        </View>
      ) : null}
      {server !== null ? (
        <View
          testID={`${testID}-server-cache`}
          accessible={false}
          style={styles.iconFact}
        >
          <AppIcon name="cloud-check-outline" color={colors.textSecondary} size={GLYPH_SIZE} />
        </View>
      ) : null}
      {rolling !== null ? (
        <View
          testID={`${testID}-rolling-cache`}
          accessible={false}
          style={styles.rollingFact}
        >
          <AppIcon name="cached" color={colors.warning} size={GLYPH_SIZE} />
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
    gap: spacing.xxs,
    marginLeft: spacing.xxs,
  },
  iconFact: {
    width: FACT_SIZE,
    height: FACT_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
  },
  rollingFact: {
    height: FACT_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs / 2,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
    paddingHorizontal: spacing.xxs,
  },
  rollingText: { ...typography.micro, color: colors.warning },
});
