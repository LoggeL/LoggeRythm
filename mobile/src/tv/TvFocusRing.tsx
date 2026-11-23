import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { colors, elevation, radii } from '../theme';

export type TvFocusRingTone = 'brand' | 'accent' | 'light';

export const TV_FOCUS_RING_WIDTH = 3;
export const TV_DEFAULT_FOCUS_SCALE = 1.04;

const RING_COLORS: Readonly<Record<TvFocusRingTone, string>> = Object.freeze({
  brand: colors.brand,
  accent: colors.accentSoft,
  light: colors.textPrimary,
});

export function resolveTvFocusRingColor(tone: TvFocusRingTone = 'brand'): string {
  const color = RING_COLORS[tone];
  if (!color) {
    throw new Error(`Unsupported TvFocusRing tone: ${String(tone)}`);
  }
  return color;
}

export function resolveTvRingRadius(radius: keyof typeof radii | number = 'card'): number {
  if (typeof radius === 'number') {
    if (!Number.isFinite(radius) || radius < 0) {
      throw new RangeError(`Invalid TvFocusRing radius: ${String(radius)}`);
    }
    return radius;
  }
  const token = radii[radius];
  if (typeof token !== 'number') {
    throw new Error(`Unknown radii token for TvFocusRing: ${String(radius)}`);
  }
  return token;
}

export interface TvFocusRingProps {
  /** Whether the wrapped control currently holds D-Pad / keyboard focus. */
  focused: boolean;
  /** Theme radius token or numeric border radius matching the wrapped control. Defaults to `'card'`. */
  radius?: keyof typeof radii | number;
  /** High-contrast ring tone (`'brand'` lime, `'accent'` violet, `'light'` white). Defaults to `'brand'`. */
  tone?: TvFocusRingTone;
  /** Subtle focus scale when reduced motion is off. Defaults to `1.04`; pass `1` to disable scaling. */
  scale?: number;
  /** Apply subtle floating elevation while focused. Defaults to `true`. */
  elevate?: boolean;
  /** Apply translucent surface highlight inside the ring while focused. Defaults to `true`. */
  showHighlight?: boolean;
  /** Optional explicit reduced-motion override (defaults to `useReducedMotion()`). */
  reducedMotion?: boolean;
  style?: StyleProp<ViewStyle>;
  ringTestID?: string;
  children: React.ReactNode;
}

/**
 * High-contrast 10-foot focus frame rendered as a non-layout-shifting overlay.
 *
 * Uses an absolute `pointerEvents="none"` ring with a dark inner contrast keyline
 * so the focus border stays unmistakable at 3 meters against both dark surfaces
 * and bright album covers. Respects `useReducedMotion()` by disabling scale motion.
 */
export function TvFocusRing({
  focused,
  radius = 'card',
  tone = 'brand',
  scale = TV_DEFAULT_FOCUS_SCALE,
  elevate = true,
  showHighlight = true,
  reducedMotion,
  style,
  ringTestID,
  children,
}: TvFocusRingProps) {
  const osReducedMotion = useReducedMotion();
  const isReducedMotion = reducedMotion ?? osReducedMotion;
  const borderRadius = resolveTvRingRadius(radius);
  const borderColor = resolveTvFocusRingColor(tone);
  const applyScale = focused && !isReducedMotion && scale !== 1;

  return (
    <View
      collapsable={false}
      style={[
        styles.container,
        { borderRadius },
        focused && elevate ? elevation.floating : null,
        applyScale ? { transform: [{ scale }] } : null,
        style,
      ]}
    >
      {children}
      {focused ? (
        <View
          testID={ringTestID}
          accessible={false}
          importantForAccessibility="no"
          pointerEvents="none"
          style={[
            styles.ringOuter,
            {
              borderRadius,
              borderColor,
              backgroundColor: showHighlight ? colors.fill : 'transparent',
            },
          ]}
        >
          <View
            accessible={false}
            importantForAccessibility="no"
            pointerEvents="none"
            style={[
              styles.ringInnerContrast,
              {
                borderRadius: Math.max(borderRadius - TV_FOCUS_RING_WIDTH, 0),
              },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  ringOuter: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: TV_FOCUS_RING_WIDTH,
  },
  ringInnerContrast: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 1,
    borderColor: colors.backdrop,
  },
});
