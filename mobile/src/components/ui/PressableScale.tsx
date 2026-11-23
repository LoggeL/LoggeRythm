import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  type PressableProps,
  type StyleProp,
  type TargetedEvent,
  type ViewStyle,
} from 'react-native';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { colors, opacity, radii } from '../../theme';

/** Shared Android TV / keyboard D-Pad focus props forwarded by interactive UI primitives. */
export interface TvFocusProps {
  focusable?: boolean;
  hasTVPreferredFocus?: boolean;
  onFocus?: PressableProps['onFocus'];
  onBlur?: PressableProps['onBlur'];
  /** Optional controlled focus flag (e.g. from a parent TV focus container). */
  focused?: boolean;
  /** Optional custom focus ring styling when focused via D-Pad or keyboard. */
  focusedStyle?: StyleProp<ViewStyle>;
}

export interface FocusRingController {
  subscribe(listener: (focused: boolean) => void): () => void;
  getFocused(): boolean;
  setFocused(focused: boolean): void;
}

/**
 * Stateful focus-ring channel shared between a pressable host and its
 * `FocusRingOverlay` child:
 * - Retains the latest focus state (`getFocused()`) and replays it on
 *   `subscribe()` when an event already arrived (e.g. early `hasTVPreferredFocus`
 *   firing before `FocusRingOverlay`'s effect mounts).
 * - Leaves an already-mounted overlay's state intact when a hook-free parent
 *   re-renders with a fresh untouched controller (`hasEvent === false`), while
 *   still delivering subsequent `setFocused(false)` blur events.
 */
export function createFocusRingController(): FocusRingController {
  let focused = false;
  let hasEvent = false;
  const listeners = new Set<(focused: boolean) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (hasEvent) listener(focused);
      return () => {
        listeners.delete(listener);
      };
    },
    getFocused() {
      return focused;
    },
    setFocused(next) {
      hasEvent = true;
      focused = next;
      listeners.forEach((listener) => listener(next));
    },
  };
}

export interface FocusRingOverlayProps {
  controller: FocusRingController;
  borderRadius?: number;
  controlledFocused?: boolean;
  disabled?: boolean;
  focusedStyle?: StyleProp<ViewStyle>;
}

/**
 * Lightweight React.memo focus-ring overlay for hook-free button primitives.
 * Renders `null` at rest (zero extra native views on touch phones) and paints
 * an absolute high-contrast focus ring immediately when D-Pad focused on TV.
 */
export const FocusRingOverlay = React.memo(function FocusRingOverlay({
  controller,
  borderRadius = radii.pill,
  controlledFocused = false,
  disabled = false,
  focusedStyle,
}: FocusRingOverlayProps) {
  const [focused, setFocused] = useState(() => controller.getFocused());

  useEffect(() => controller.subscribe(setFocused), [controller]);

  if (disabled || (!focused && !controlledFocused)) return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no"
      style={[focusStyles.ring, { borderRadius }, focusedStyle]}
    />
  );
});

export interface PressableScaleProps
  extends Omit<PressableProps, 'style' | 'children'>,
    Pick<TvFocusProps, 'focused' | 'focusedStyle'> {
  children: React.ReactNode;
  /** Plain style only (no `({ pressed }) =>` function): feedback is the animation. */
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed. Defaults to 0.96; use ~0.98 for wide rows. */
  scaleTo?: number;
}

const PRESS_IN_MS = 65;

// Created on first render rather than at module load, so importing the ui
// barrel under a partial `react-native` test mock does not touch Animated.
let AnimatedPressable: ReturnType<typeof Animated.createAnimatedComponent<typeof Pressable>> | null = null;

function extractBorderRadius(style: StyleProp<ViewStyle>): number | undefined {
  if (style === null || style === undefined || typeof style !== 'object') return undefined;
  if (Array.isArray(style)) {
    let found: number | undefined;
    for (const entry of style) {
      const next = extractBorderRadius(entry as StyleProp<ViewStyle>);
      if (next !== undefined) found = next;
    }
    return found;
  }
  const radius = (style as ViewStyle).borderRadius;
  return typeof radius === 'number' ? radius : undefined;
}

/**
 * PressableScale is a Pressable with crisp press-in timing and springy release
 * feedback on the native driver, plus a zero-layout-shift absolute Android TV
 * D-Pad focus ring overlay. Under reduced motion it falls back to instant
 * opacity feedback without scale motion.
 */
export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  disabled,
  focused,
  focusedStyle,
  onPressIn,
  onPressOut,
  onFocus,
  onBlur,
  pressRetentionOffset = 8,
  ...rest
}: PressableScaleProps) {
  const [progress] = useState(() => new Animated.Value(0));
  const [nativeFocused, setNativeFocused] = useState(false);
  const reducedMotion = useReducedMotion();
  AnimatedPressable ??= Animated.createAnimatedComponent(Pressable);
  const Component = AnimatedPressable;

  const animatedStyles = useMemo(() => {
    const pressedOpacity = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, opacity.pressed + 0.14],
    });
    const pressedScale = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, scaleTo],
    });
    return {
      full: {
        opacity: pressedOpacity,
        transform: [{ scale: pressedScale }],
      },
      reduced: {
        opacity: pressedOpacity,
      },
    };
  }, [progress, scaleTo]);

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (reducedMotion) {
        progress.setValue?.(1);
      } else {
        Animated.timing(progress, {
          toValue: 1,
          duration: PRESS_IN_MS,
          useNativeDriver: true,
        }).start();
      }
      onPressIn?.(event);
    },
    [onPressIn, progress, reducedMotion],
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      if (reducedMotion) {
        progress.setValue?.(0);
      } else {
        Animated.spring(progress, {
          toValue: 0,
          useNativeDriver: true,
          speed: 36,
          bounciness: 5,
        }).start();
      }
      onPressOut?.(event);
    },
    [onPressOut, progress, reducedMotion],
  );

  const handleFocus = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent>) => {
      setNativeFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent>) => {
      setNativeFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  const showFocus = !disabled && (focused === true || nativeFocused);
  const feedbackStyle = disabled
    ? { opacity: opacity.disabled }
    : reducedMotion
      ? animatedStyles.reduced
      : animatedStyles.full;
  const focusRadius = showFocus ? extractBorderRadius(style) ?? radii.card : undefined;

  return (
    <Component
      {...rest}
      disabled={disabled}
      pressRetentionOffset={pressRetentionOffset}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={[style, feedbackStyle]}
    >
      {children}
      {showFocus ? (
        <View
          testID={rest.testID ? `${rest.testID}-focus-ring` : undefined}
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no"
          style={[
            focusStyles.ring,
            focusRadius !== undefined ? { borderRadius: focusRadius } : null,
            focusedStyle,
          ]}
        />
      ) : null}
    </Component>
  );
}

const focusStyles = StyleSheet.create({
  ring: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 2,
    borderColor: colors.accentSoft,
    backgroundColor: 'rgba(195,181,255,0.12)',
  },
});
