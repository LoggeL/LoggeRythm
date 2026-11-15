import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, metrics, opacity, radii } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'plain' | 'tonal' | 'filled';

export interface IconButtonProps {
  icon: AppIconName;
  onPress: () => void;
  /** Required: an icon alone has no accessible name. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  onLongPress?: () => void;
  /** Glyph size: sm 20, md 24, lg 28. The touch target is always >= 48dp. */
  size?: IconButtonSize;
  /** plain = transparent, tonal = translucent fill, filled = light circle. */
  variant?: IconButtonVariant;
  /** Toggle state: tints the glyph accentSoft and reports `selected`. */
  selected?: boolean;
  /** Overrides the glyph colour (e.g. colors.danger). */
  color?: string;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const glyphSize: Record<IconButtonSize, number> = { sm: 20, md: 24, lg: 28 };

/**
 * IconButton is the one round, icon-only control (web `.action-icon`). It
 * always occupies a 48dp target regardless of glyph size, requires an
 * accessibility label, exposes `selected`/`disabled`/`busy` state and applies
 * the shared pressed feedback. Use it for header actions, row overflow menus
 * and transport controls instead of a hand-rolled Pressable + AppIcon.
 */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  onLongPress,
  size = 'md',
  variant = 'plain',
  selected,
  color,
  disabled = false,
  busy = false,
  testID,
  style,
}: IconButtonProps) {
  const unavailable = disabled || busy;
  const foreground =
    color ??
    (variant === 'filled'
      ? colors.onLight
      : selected
        ? colors.accentSoft
        : variant === 'tonal'
          ? colors.textPrimary
          : colors.textSecondary);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={
        selected === undefined ? { disabled: unavailable, busy } : { disabled: unavailable, busy, selected }
      }
      disabled={unavailable}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        style,
        pressed ? styles.pressed : null,
        unavailable ? styles.disabled : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator accessible={false} color={foreground} size="small" />
      ) : (
        <AppIcon name={icon} color={foreground} size={glyphSize[size]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plain: { backgroundColor: 'transparent' },
  tonal: { backgroundColor: colors.fill },
  filled: { backgroundColor: colors.textPrimary },
  pressed: { opacity: opacity.pressed, transform: [{ scale: 0.94 }] },
  disabled: { opacity: opacity.disabled },
});
