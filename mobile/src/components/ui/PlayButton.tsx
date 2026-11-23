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
import { colors, elevation, metrics, opacity, radii } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import {
  createFocusRingController,
  FocusRingOverlay,
  type TvFocusProps,
} from './PressableScale';

export type PlayButtonSize = 'sm' | 'md' | 'lg';

export interface PlayButtonProps extends TvFocusProps {
  onPress: () => void;
  /** Localized action name, e.g. strings.common.play or "Play <album>". */
  accessibilityLabel: string;
  /** Shows the pause glyph. Ignored when `icon` is given. */
  playing?: boolean;
  /** Shows a spinner (buffering / starting) and blocks presses. */
  busy?: boolean;
  disabled?: boolean;
  /** Diameter: sm 48, md 56, lg 64. */
  size?: PlayButtonSize;
  /** Overrides the play/pause glyph (e.g. "shuffle"). */
  icon?: AppIconName;
  /** Subtle Android haptic kind on press; defaults to `'commit'`, pass `false` to disable. */
  haptic?: HapticKind | false;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const diameters: Record<PlayButtonSize, number> = {
  sm: metrics.minimumTouchTarget,
  md: 56,
  lg: 64,
};
const glyphs: Record<PlayButtonSize, number> = { sm: 26, md: 30, lg: 34 };

/**
 * PlayButton is the one loud control of the app (web `.play-fab`): a round
 * accent button that starts or toggles playback. Use exactly one per view
 * (detail hero, mix card, now playing transport). It reports `busy` while
 * the player is buffering, never shrinks below the 48dp target, and supports
 * Android TV D-Pad focus rings.
 */
export function PlayButton({
  onPress,
  accessibilityLabel,
  playing = false,
  busy = false,
  disabled = false,
  size = 'md',
  icon,
  haptic = 'commit',
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused = false,
  focusedStyle,
  testID,
  style,
}: PlayButtonProps) {
  const unavailable = disabled || busy;
  const diameter = diameters[size];
  const focusController = createFocusRingController();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: unavailable, busy }}
      disabled={unavailable}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      android_ripple={{ color: 'rgba(255,255,255,0.22)', borderless: true, radius: diameter / 2 }}
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
        { width: diameter, height: diameter },
        style,
        pressed
          ? getReducedMotionSnapshot()
            ? styles.pressedReduced
            : styles.pressed
          : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator accessible={false} color={colors.onAccent} size="small" />
      ) : (
        <AppIcon
          name={icon ?? (playing ? 'pause' : 'play')}
          color={colors.onAccent}
          size={glyphs[size]}
        />
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
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    ...elevation.floating,
    shadowColor: colors.accent,
  },
  pressed: { backgroundColor: colors.accentSolid, transform: [{ scale: 0.95 }] },
  pressedReduced: { backgroundColor: colors.accentSolid },
  disabled: { opacity: opacity.disabled },
});
