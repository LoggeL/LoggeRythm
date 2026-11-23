import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { triggerHaptic, type HapticKind } from '../../hooks/useHaptics';
import { getReducedMotionSnapshot } from '../../hooks/useReducedMotion';
import { colors, metrics, opacity, radii, spacing, typography } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import {
  createFocusRingController,
  FocusRingOverlay,
  type TvFocusProps,
} from './PressableScale';

export type ActionButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

export interface ActionButtonProps extends TvFocusProps {
  label: string;
  onPress: () => void;
  icon?: AppIconName;
  /**
   * primary = light pill on dark (the main action of a view), accent = violet
   * pill (playback-adjacent actions), secondary = translucent pill with
   * hairline, ghost = text only, danger = destructive.
   */
  variant?: ActionButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  /** Stretches to the parent's width instead of hugging the label. */
  fullWidth?: boolean;
  /** Optional subtle Android haptic kind; pass `false` to disable. Defaults to `'tap'`. */
  haptic?: HapticKind | false;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const foregrounds: Record<ActionButtonVariant, string> = {
  primary: colors.onLight,
  accent: colors.onAccent,
  secondary: colors.textPrimary,
  ghost: colors.textPrimary,
  danger: colors.danger,
};

const rippleColors: Record<ActionButtonVariant, string> = {
  primary: 'rgba(11,12,16,0.14)',
  accent: 'rgba(255,255,255,0.2)',
  secondary: colors.fillStrong,
  ghost: colors.fillStrong,
  danger: 'rgba(255,122,138,0.18)',
};

/**
 * ActionButton is the labelled pill button (web `.action-primary` /
 * `.action-secondary`). It is 48dp tall, shows an optional leading icon,
 * swaps the icon for a spinner while `busy`, reports disabled/busy to
 * assistive tech, applies native Android ripple + pressed feedback, and
 * supports Android TV D-Pad focus rings.
 */
export function ActionButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
  busy = false,
  fullWidth = false,
  haptic = 'tap',
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused = false,
  focusedStyle,
  testID,
  style,
  accessibilityLabel,
  accessibilityHint,
}: ActionButtonProps) {
  const unavailable = disabled || busy;
  const foreground = foregrounds[variant];
  const focusController = createFocusRingController();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy }}
      disabled={unavailable}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      android_ripple={{ color: rippleColors[variant], borderless: false }}
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
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        fullWidth ? styles.fullWidth : null,
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
      ) : icon ? (
        <AppIcon name={icon} color={foreground} size={20} />
      ) : null}
      <Text numberOfLines={1} style={[styles.label, { color: foreground }]}>{label}</Text>
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
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.textPrimary, borderColor: 'transparent' },
  accent: { backgroundColor: colors.accent, borderColor: 'transparent' },
  secondary: { backgroundColor: colors.fill, borderColor: colors.hairline },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: colors.dangerSubtle, borderColor: 'transparent' },
  fullWidth: { alignSelf: 'stretch' },
  label: { ...typography.label, flexShrink: 1, textAlign: 'center' },
  pressed: { opacity: opacity.pressed, transform: [{ scale: 0.98 }] },
  pressedReduced: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
