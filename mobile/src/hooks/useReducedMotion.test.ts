import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getReducedMotionSnapshot,
  resetReducedMotionForTests,
  subscribeReducedMotion,
  useReducedMotion,
} from './useReducedMotion';

const mocks = vi.hoisted(() => ({
  reduceMotionPromise: null as Promise<boolean> | null,
  resolveReduceMotion: null as ((value: boolean) => void) | null,
  changeListener: null as ((enabled: boolean) => void) | null,
  remove: vi.fn(),
  addEventListener: vi.fn(),
  isReduceMotionEnabled: vi.fn(),
  subscribeCaptured: [] as ((listener: () => void) => () => void)[],
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => mocks.isReduceMotionEnabled(),
    addEventListener: (event: string, listener: (enabled: boolean) => void) => {
      mocks.addEventListener(event, listener);
      mocks.changeListener = listener;
      return { remove: mocks.remove };
    },
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useSyncExternalStore: <T,>(
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => T,
    ): T => {
      mocks.subscribeCaptured.push(subscribe);
      return getSnapshot();
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.changeListener = null;
  mocks.subscribeCaptured = [];
  mocks.reduceMotionPromise = new Promise<boolean>((resolve) => {
    mocks.resolveReduceMotion = resolve;
  });
  mocks.isReduceMotionEnabled.mockImplementation(() => mocks.reduceMotionPromise!);
  resetReducedMotionForTests(false);
});

afterEach(() => {
  resetReducedMotionForTests(false);
});

describe('useReducedMotion', () => {
  it('shares one singleton AccessibilityInfo listener across many subscribers and tears down at zero', async () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    const unsubA = subscribeReducedMotion(listenerA);
    const unsubB = subscribeReducedMotion(listenerB);

    expect(mocks.addEventListener).toHaveBeenCalledTimes(1);
    expect(mocks.addEventListener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));
    expect(mocks.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(getReducedMotionSnapshot()).toBe(false);

    mocks.resolveReduceMotion?.(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(getReducedMotionSnapshot()).toBe(true);
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);

    mocks.changeListener?.(false);
    expect(getReducedMotionSnapshot()).toBe(false);
    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerB).toHaveBeenCalledTimes(2);

    unsubA();
    expect(mocks.remove).not.toHaveBeenCalled();

    unsubB();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it('prefers a live reduceMotionChanged event over an older in-flight initial query', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReducedMotion(listener);

    mocks.changeListener?.(true);
    expect(getReducedMotionSnapshot()).toBe(true);

    // Late initial query returns stale false; must not overwrite the newer live event.
    mocks.resolveReduceMotion?.(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(getReducedMotionSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('connects useReducedMotion to the shared store via useSyncExternalStore', () => {
    resetReducedMotionForTests(true);
    expect(useReducedMotion()).toBe(true);
    expect(mocks.subscribeCaptured).toEqual([subscribeReducedMotion]);
  });
});
