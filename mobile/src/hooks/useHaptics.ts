import * as ReactNative from 'react-native';
import { getReducedMotionSnapshot, useReducedMotion } from './useReducedMotion';

export type HapticKind = 'tap' | 'like' | 'commit' | 'drag';

export type NativeHapticStyle =
  | 'light'
  | 'selection'
  | 'tick'
  | 'medium'
  | 'click'
  | 'heavy'
  | 'success'
  | 'double'
  | 'confirm'
  | 'error'
  | 'reject'
  | 'warning';

export const NATIVE_HAPTIC_STYLE_BY_KIND: Readonly<Record<HapticKind, NativeHapticStyle>> = {
  tap: 'click',
  drag: 'tick',
  commit: 'confirm',
  like: 'success',
};

/**
 * Fallback Android vibration patterns in milliseconds when the native
 * LoggeRythmPlayer.performHaptic method is absent (e.g. partial test mocks).
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

function getNativePerformHaptic(): ((style: NativeHapticStyle) => Promise<unknown>) | undefined {
  if (!('NativeModules' in ReactNative)) return undefined;
  const mod = (
    ReactNative.NativeModules as {
      LoggeRythmPlayer?: { performHaptic?: (style: NativeHapticStyle) => Promise<unknown> };
    } | undefined
  )?.LoggeRythmPlayer;
  return typeof mod?.performHaptic === 'function'
    ? (style) => mod.performHaptic!(style)
    : undefined;
}

function getVibrate(): ((pattern: number | number[]) => void) | undefined {
  if (!('Vibration' in ReactNative)) return undefined;
  const vibration = ReactNative.Vibration;
  return typeof vibration?.vibrate === 'function'
    ? (pattern) => vibration.vibrate(pattern)
    : undefined;
}

/**
 * Trigger crisp Android haptic feedback through native `LoggeRythmPlayer.performHaptic`
 * (using Android `VibrationEffect` primitives), falling back to RN `Vibration` when
 * running under partial test mocks. Respects reduced motion and fails loud on real errors.
 */
export function triggerHaptic(kind: HapticKind): boolean {
  if (!Object.prototype.hasOwnProperty.call(HAPTIC_PATTERNS, kind)) {
    throw new RangeError(`Unknown haptic feedback kind: ${String(kind)}`);
  }
  if (getReducedMotionSnapshot()) return false;
  if (getPlatformOs() !== 'android') return false;
  const performNative = getNativePerformHaptic();
  if (performNative !== undefined) {
    const style = NATIVE_HAPTIC_STYLE_BY_KIND[kind];
    void performNative(style).catch((error: unknown) => {
      console.error(`[LoggeRythm] Native haptic (${style}) failed:`, error);
    });
    return true;
  }
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
