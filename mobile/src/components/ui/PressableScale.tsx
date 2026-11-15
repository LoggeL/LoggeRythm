import React, { useState } from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { opacity } from '../../theme';

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  children: React.ReactNode;
  /** Plain style only (no `({ pressed }) =>` function): feedback is the animation. */
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed. Defaults to 0.96; use ~0.98 for wide rows. */
  scaleTo?: number;
}

// Created on first render rather than at module load, so importing the ui
// barrel under a partial `react-native` test mock does not touch Animated.
let AnimatedPressable: ReturnType<typeof Animated.createAnimatedComponent<typeof Pressable>> | null = null;

/**
 * PressableScale is a Pressable with springy press feedback: it scales down
 * and dims slightly while held (web `.press:active`), on the native driver.
 * Wrap tappable cards, artwork tiles and rows in it. It forwards every
 * Pressable prop, so the caller still supplies accessibilityRole/Label and
 * testID; `style` must be a plain style, not a function.
 */
export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const [progress] = useState(() => new Animated.Value(0));
  AnimatedPressable ??= Animated.createAnimatedComponent(Pressable);
  const Component = AnimatedPressable;
  const animateTo = (toValue: number) => {
    Animated.spring(progress, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: toValue === 0 ? 6 : 0,
    }).start();
  };
  return (
    <Component
      {...rest}
      disabled={disabled}
      onPressIn={(event: GestureResponderEvent) => {
        animateTo(1);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        animateTo(0);
        onPressOut?.(event);
      }}
      style={[
        style,
        {
          opacity: disabled
            ? opacity.disabled
            : progress.interpolate({ inputRange: [0, 1], outputRange: [1, opacity.pressed + 0.14] }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) },
          ],
        },
      ]}
    >
      {children}
    </Component>
  );
}
