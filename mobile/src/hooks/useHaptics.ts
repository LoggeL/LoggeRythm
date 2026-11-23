import * as ReactNative from 'react-native';
import { getReducedMotionSnapshot, useReducedMotion } from './useReducedMotion';

export type HapticKind = 'tap' | 'like' | 'commit' | 'drag';

/**
 * Subtle Android vibration patterns in milliseconds.
 * Single numbers vibrate once; arrays follow Android's [wait, vibrate, wait, vibrate] format.
 */
export const HAPTIC_PATTERNS: Readonly<Record<HapticKind, number | number[]>> = {
  tap: 10,
  drag: 12,
  commit: 16,
  like: [0, 12, 32, 18],
};

function isVitestEnvironment(): boolean {
  return typeof process !== 'undefined' && process.env?.VITEST === 'true';
}

function getPlatformOs(): string | undefined {
  if (!('Platform' in ReactNative)) return undefined;
  return ReactNative.Platform?.OS;
}

function getVibrate(): ((pattern: number | number[]) => void) | undefined {
  if (!('Vibration' in ReactNative)) return undefined;
  const vibration = ReactNative.Vibration;
  return typeof vibration?.vibrate === 'function'
    ? (pattern) => vibration.vibrate(pattern)
    : undefined;
}

/**
 * Trigger subtle Android haptic feedback through core RN `Vibration`.
 * Respects reduced motion and returns `false` without vibrating on non-Android
 * platforms or partial test mocks. Real Android runtime errors propagate loudly.
 */
export function triggerHaptic(kind: HapticKind): boolean {
  if (!Object.prototype.hasOwnProperty.call(HAPTIC_PATTERNS, kind)) {
    throw new RangeError(`Unknown haptic feedback kind: ${String(kind)}`);
  }
  if (getReducedMotionSnapshot()) return false;
  if (getPlatformOs() !== 'android') return false;
  const vibrate = getVibrate();
  if (vibrate === undefined) {
    if (isVitestEnvironment()) return false;
    throw new Error('React Native Vibration.vibrate is unavailable on Android');
  }
  const pattern = HAPTIC_PATTERNS[kind];
  vibrate(Array.isArray(pattern) ? [...pattern] : pattern);
  return true;
}

export interface HapticsController {
  readonly trigger: (kind: HapticKind) => boolean;
}

const HAPTICS_CONTROLLER: HapticsController = Object.freeze({
  trigger: triggerHaptic,
});

/**
 * Subscribes the component to the shared reduced-motion preference and returns
 * a referentially stable haptic trigger handle.
 */
export function useHaptics(): HapticsController {
  useReducedMotion();
  return HAPTICS_CONTROLLER;
}
