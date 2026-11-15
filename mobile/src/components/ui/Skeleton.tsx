import React, { useEffect, useState } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, layout, radii, spacing } from '../../theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: keyof typeof radii;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const PULSE_LOW = 0.45;
const PULSE_MS = 750;

/**
 * Skeleton is one pulsing placeholder block shown while content loads. It
 * animates opacity on the native driver and is hidden from assistive tech;
 * the surrounding group (TrackRowSkeleton, CardRailSkeleton or your own
 * wrapper) is the labelled `progressbar`. Compose blocks to mirror the real
 * layout instead of showing a centered spinner.
 */
export function Skeleton({ width = '100%', height = 16, radius = 'sm', testID, style }: SkeletonProps) {
  const [pulse] = useState(() => new Animated.Value(PULSE_LOW));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: PULSE_LOW, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      testID={testID}
      accessible={false}
      importantForAccessibility="no"
      style={[styles.block, { width, height, borderRadius: radii[radius], opacity: pulse }, style]}
    />
  );
}

export interface SkeletonGroupProps {
  /** Localized loading label announced for the whole group. */
  accessibilityLabel: string;
  /** Number of placeholder items. */
  count?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * TrackRowSkeleton stands in for a vertical list of track rows (artwork,
 * title line, artist line). The group is one polite `progressbar` carrying
 * the localized loading label.
 */
export function TrackRowSkeleton({ accessibilityLabel, count = 6, testID, style }: SkeletonGroupProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[styles.rows, style]}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.row}>
          <Skeleton width={layout.artwork.sm} height={layout.artwork.sm} />
          <View style={styles.rowCopy}>
            <Skeleton width={index % 2 === 0 ? '68%' : '52%'} height={14} />
            <Skeleton width={index % 2 === 0 ? '40%' : '46%'} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

export interface CardRailSkeletonProps extends SkeletonGroupProps {
  /** Card artwork edge. Defaults to layout.artwork.card. */
  size?: number;
  /** Round artwork for artist rails. */
  round?: boolean;
}

/**
 * CardRailSkeleton stands in for a horizontal shelf of cards (artwork plus
 * two text lines). It clips at the screen edge like the real rail and is
 * one polite `progressbar` carrying the localized loading label.
 */
export function CardRailSkeleton({
  accessibilityLabel,
  count = 4,
  size = layout.artwork.card,
  round = false,
  testID,
  style,
}: CardRailSkeletonProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[styles.rail, style]}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.card, { width: size }]}>
          <Skeleton width={size} height={size} radius={round ? 'pill' : 'card'} />
          <Skeleton width="80%" height={14} />
          <Skeleton width="55%" height={12} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surfaceElevated },
  rows: { paddingHorizontal: layout.pagePadding },
  row: {
    height: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowCopy: { flex: 1, gap: spacing.xs },
  rail: {
    flexDirection: 'row',
    gap: layout.railGap,
    paddingHorizontal: layout.pagePadding,
    overflow: 'hidden',
  },
  card: { gap: spacing.xs },
});
