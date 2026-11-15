import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { colors, elevation, metrics, opacity, radii, spacing } from '../../theme';

export type SurfaceLevel = 'flat' | 'card' | 'raised';

export interface SurfaceProps extends ViewProps {
  /** flat = screen background, card = surface + hairline, raised = elevated floating surface. */
  level?: SurfaceLevel;
  radius?: keyof typeof radii;
  /** Adds the standard inner padding (spacing.md). */
  padded?: boolean;
}

/**
 * Surface is the themed container for grouped content: it owns background,
 * hairline outline, corner radius and elevation so screens never restate
 * those values. Use `level="card"` for in-flow panels, `level="raised"` for
 * anything floating above content (menus, toasts, the mini player).
 */
export function Surface({
  level = 'card',
  radius = 'panel',
  padded = false,
  style,
  ...rest
}: SurfaceProps) {
  return (
    <View
      {...rest}
      style={[
        styles[level],
        { borderRadius: radii[radius] },
        padded ? styles.padded : null,
        style,
      ]}
    />
  );
}

export interface CardProps {
  children: React.ReactNode;
  /** Makes the whole card one button. Requires `accessibilityLabel`. */
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  level?: SurfaceLevel;
  radius?: keyof typeof radii;
  padded?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Card is a padded Surface that can optionally act as a single pressable
 * target with the standard pressed feedback (dim + slight scale). Without
 * `onPress` it renders a plain Surface; with it, the card is one button and
 * must be given an `accessibilityLabel`.
 */
export function Card({
  children,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  level = 'card',
  radius = 'panel',
  padded = true,
  testID,
  style,
}: CardProps) {
  if (onPress === undefined && onLongPress === undefined) {
    return (
      <Surface testID={testID} level={level} radius={radius} padded={padded} style={style}>
        {children}
      </Surface>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles[level],
        styles.pressable,
        { borderRadius: radii[radius] },
        padded ? styles.padded : null,
        style,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flat: { backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  raised: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...elevation.floating,
  },
  padded: { padding: spacing.md },
  pressable: { minHeight: metrics.minimumTouchTarget },
  pressed: { opacity: opacity.pressed, transform: [{ scale: 0.985 }] },
  disabled: { opacity: opacity.disabled },
});
