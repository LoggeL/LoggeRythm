import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

type ReduceMotionSubscription = { remove(): void };

const listeners = new Set<() => void>();
let reducedMotion = false;
let subscription: ReduceMotionSubscription | null = null;
let subscriptionEpoch = 0;

function publish(next: boolean): void {
  if (typeof next !== 'boolean') {
    throw new TypeError(`Expected boolean reduced-motion state, received ${typeof next}`);
  }
  if (next === reducedMotion) return;
  reducedMotion = next;
  listeners.forEach((listener) => listener());
}

function startNativeSubscription(): void {
  if (subscription !== null) return;
  if (
    AccessibilityInfo === undefined
    || typeof AccessibilityInfo.isReduceMotionEnabled !== 'function'
    || typeof AccessibilityInfo.addEventListener !== 'function'
  ) {
    throw new Error('React Native AccessibilityInfo reduce-motion API is unavailable');
  }
  const epoch = ++subscriptionEpoch;
  let receivedEvent = false;
  subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
    if (epoch !== subscriptionEpoch) return;
    receivedEvent = true;
    publish(enabled);
  });
  void AccessibilityInfo.isReduceMotionEnabled().then(
    (enabled) => {
      if (epoch !== subscriptionEpoch || receivedEvent) return;
      publish(enabled);
    },
    (error: unknown) => {
      console.error('[LoggeRythm] Failed to read AccessibilityInfo.isReduceMotionEnabled', error);
      throw error;
    },
  );
}

function stopNativeSubscription(): void {
  if (subscription === null) return;
  subscriptionEpoch += 1;
  subscription.remove();
  subscription = null;
}

/** Synchronous snapshot of the OS reduced-motion preference. */
export function getReducedMotionSnapshot(): boolean {
  return reducedMotion;
}

/** Subscribe to OS reduced-motion changes through one shared native listener. */
export function subscribeReducedMotion(listener: () => void): () => void {
  listeners.add(listener);
  startNativeSubscription();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopNativeSubscription();
  };
}

/**
 * Shared singleton subscription to `AccessibilityInfo.isReduceMotionEnabled`.
 * Keeps per-row / per-card components free of duplicate native listeners.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionSnapshot,
  );
}

/** Test-only reset for isolating singleton reduced-motion state between cases. */
export function resetReducedMotionForTests(initial = false): void {
  stopNativeSubscription();
  listeners.clear();
  reducedMotion = initial;
}
