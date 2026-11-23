import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type {
  TrackPlaybackPhase,
  TrackPresentationState,
} from '../player/trackPresentation';
import { colors, radii, spacing, typography } from '../theme';
import { isTvMode } from '../tv';
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

export interface EqualizerBarsProps {
  /** Number of bars (1..16). Defaults to 4. */
  bars?: number;
  /** Container height in dp. Defaults to 16. */
  height?: number;
  /** Bar colour. Defaults to `colors.accentSoft`. */
  color?: string;
  /** Animates via native driver while true; renders static settled bars when false or under reduced motion. */
  isPlaying?: boolean;
  testID?: string;
}

const GLYPH_SIZE = typography.callout.fontSize;
const FACT_SIZE = typography.callout.lineHeight;
const EQUALIZER_BAR_WIDTH = 2.5;
const EQUALIZER_BAR_GAP = 2;

const BAR_PROFILES = [
  { settled: 0.28, low: 0.22, high: 0.96, duration: 360 },
  { settled: 0.56, low: 0.26, high: 0.82, duration: 440 },
  { settled: 0.36, low: 0.2, high: 1.0, duration: 310 },
  { settled: 0.64, low: 0.24, high: 0.72, duration: 480 },
] as const;

function barProfile(index: number) {
  return BAR_PROFILES[index % BAR_PROFILES.length];
}

interface AnimatedEqualizerProps {
  bars: number;
  height: number;
  color: string;
  testID?: string;
}

/**
 * Native-driver animated equalizer bars mounted ONLY while actively playing
 * and reduced motion is off. Bottom-aligned via linear `translateY` + `scaleY`
 * transforms so every frame stays off the JS thread.
 */
const AnimatedEqualizer = React.memo(function AnimatedEqualizer({
  bars,
  height,
  color,
  testID,
}: AnimatedEqualizerProps) {
  const [values] = useState(() =>
    Array.from({ length: bars }, (_, index) => new Animated.Value(barProfile(index).low)),
  );

  const barTransforms = useMemo(
    () =>
      values.map((value) => ({
        scaleY: value,
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [height / 2, 0],
        }),
      })),
    [height, values],
  );

  useEffect(() => {
    const loops = values.map((value, index) => {
      const profile = barProfile(index);
      value.setValue(profile.low);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: profile.high,
            duration: profile.duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: profile.low,
            duration: Math.round(profile.duration * 0.9),
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return loop;
    });
    return () => {
      loops.forEach((loop) => loop.stop());
    };
  }, [values]);

  return (
    <View
      testID={testID}
      accessible={false}
      focusable={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.equalizer, { height }]}
    >
      {barTransforms.map((transform, index) => (
        <Animated.View
          key={index}
          style={[
            styles.equalizerBar,
            {
              height,
              backgroundColor: color,
              transform: [
                { translateY: transform.translateY },
                { scaleY: transform.scaleY },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
});

/**
 * Live playback equalizer indicator (matching `web/src/components/EqualizerBars.tsx`).
 * Renders static settled bars when paused or when OS reduced motion is enabled
 * (0 Animated loops / 0 Animated views), and native-driver bars when playing.
 */
export function EqualizerBars({
  bars = 4,
  height = 16,
  color = colors.accentSoft,
  isPlaying = true,
  testID,
}: EqualizerBarsProps) {
  if (!Number.isInteger(bars) || bars < 1 || bars > 16) {
    throw new RangeError('EqualizerBars requires between 1 and 16 bars.');
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError('EqualizerBars requires a positive finite height.');
  }
  const reducedMotion = useReducedMotion();

  if (isPlaying && !reducedMotion) {
    return (
      <AnimatedEqualizer
        bars={bars}
        height={height}
        color={color}
        testID={testID}
      />
    );
  }

  return (
    <View
      testID={testID}
      accessible={false}
      focusable={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.equalizer, { height }]}
    >
      {Array.from({ length: bars }, (_, index) => {
        const ratio = barProfile(index).settled;
        return (
          <View
            key={index}
            style={[
              styles.equalizerBar,
              {
                height: Math.max(3, Math.round(height * ratio)),
                backgroundColor: color,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/** Memoized wrapper for list rows so static/playing transitions never thrash flat lists. */
export const MemoEqualizerBars = React.memo(EqualizerBars);

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

  // RN 0.86 ReactViewManager.setAccessible(true) forces view.isFocusable = true
  // even when focusable={false}, which turns status icons into dead D-Pad stops
  // on Android TV. Disable accessible on TV while preserving phone TalkBack.
  const tvMode = isTvMode();

  return (
    <View
      testID={testID}
      accessible={!tvMode}
      focusable={false}
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
  equalizer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: EQUALIZER_BAR_GAP,
    marginLeft: spacing.xs,
    overflow: 'hidden',
  },
  equalizerBar: {
    width: EQUALIZER_BAR_WIDTH,
    borderRadius: radii.xs,
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
