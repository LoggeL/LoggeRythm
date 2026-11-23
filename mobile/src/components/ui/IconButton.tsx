import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { triggerHaptic, type HapticKind } from '../../hooks/useHaptics';
import { getReducedMotionSnapshot } from '../../hooks/useReducedMotion';
import { colors, metrics, opacity, radii } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import {
  createFocusRingController,
  FocusRingOverlay,
  type TvFocusProps,
} from './PressableScale';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'plain' | 'tonal' | 'filled';

export interface IconButtonProps extends TvFocusProps {
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
  /** Optional subtle Android haptic kind on press. */
  haptic?: HapticKind | false;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const glyphSize: Record<IconButtonSize, number> = { sm: 20, md: 24, lg: 28 };

/**
 * IconButton is the one round, icon-only control (web `.action-icon`). It
 * always occupies a 48dp target regardless of glyph size, requires an
 * accessibility label, exposes `selected`/`disabled`/`busy` state, applies
 * native Android circular ripple + pressed feedback, and supports Android TV
 * D-Pad focus rings.
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
  haptic = false,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused = false,
  focusedStyle,
  testID,
  style,
}: IconButtonProps) {
  const unavailable = disabled || busy;
  const focusController = createFocusRingController();
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
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      android_ripple={{
        color: variant === 'filled' ? 'rgba(11,12,16,0.14)' : colors.fillStrong,
        borderless: true,
        radius: metrics.minimumTouchTarget / 2,
      }}
      onFocus={(event) => {
        focusController.setFocused?.(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        focusController.setFocused?.(false);
        onBlur?.(event);
      }}
      onPress={
        haptic === false
          ? onPress
          : () => {
              triggerHaptic(haptic);
              onPress();
            }
      }
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        style,
        pressed
          ? getReducedMotionSnapshot()
            ? styles.pressedReduced
            : styles.pressed
          : null,
        unavailable ? styles.disabled : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator accessible={false} color={foreground} size="small" />
      ) : (
        <AppIcon name={icon} color={foreground} size={glyphSize[size]} />
      )}
      <FocusRingOverlay
        controller={focusController}
        borderRadius={radii.pill}
        controlledFocused={focused}
        disabled={unavailable}
        focusedStyle={focusedStyle}
      />
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
  pressedReduced: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
