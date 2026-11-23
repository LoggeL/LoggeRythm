import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { triggerHaptic, type HapticKind } from '../../hooks/useHaptics';
import { colors, metrics, opacity, radii } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import {
  createFocusRingController,
  FocusRingOverlay,
  type TvFocusProps,
} from '../ui/PressableScale';

export interface PlayerToggleButtonProps extends TvFocusProps {
  icon: AppIconName;
  /** The mode is on: accent glyph plus a dot under it, reported as `checked`. */
  checked: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  /** The toggle's own command is in flight: spinner, presses blocked. */
  busy?: boolean;
  /** Optional subtle Android haptic kind on press. */
  haptic?: HapticKind | false;
  testID?: string;
}

/**
 * Icon-only on/off control of the transport row (shuffle, repeat). Unlike
 * IconButton it reports `checked` — these are modes, not selections — and
 * marks the active mode with a dot so the state does not rely on colour alone.
 */
export function PlayerToggleButton({
  icon,
  checked,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  busy,
  haptic = false,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused = false,
  focusedStyle,
  testID,
}: PlayerToggleButtonProps) {
  const unavailable = busy === true;
  const focusController = createFocusRingController();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={
        busy === undefined ? { checked } : { checked, busy, disabled: unavailable }
      }
      disabled={unavailable}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={(event) => {
        focusController.setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        focusController.setFocused(false);
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
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      {unavailable ? (
        <ActivityIndicator accessible={false} color={colors.accentSoft} size="small" />
      ) : (
        <AppIcon
          name={icon}
          color={checked ? colors.accentSoft : colors.textSecondary}
          size={24}
        />
      )}
      <View accessible={false} style={[styles.dot, checked ? styles.dotOn : null]} />
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

const DOT = 4;

const styles = StyleSheet.create({
  button: {
    minWidth: metrics.minimumTouchTarget,
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  dot: {
    position: 'absolute',
    bottom: DOT,
    width: DOT,
    height: DOT,
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
  },
  dotOn: { backgroundColor: colors.accentSoft },
  pressed: { opacity: opacity.pressed },
});
