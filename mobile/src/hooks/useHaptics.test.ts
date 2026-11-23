import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetReducedMotionForTests } from './useReducedMotion';
import { HAPTIC_PATTERNS, triggerHaptic, useHaptics, type HapticKind } from './useHaptics';

const mocks = vi.hoisted(() => ({
  os: 'android' as 'android' | 'ios' | 'web',
  vibrate: vi.fn(),
  useReducedMotionCalled: false,
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: vi.fn(async () => false),
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Platform: {
    get OS() {
      return mocks.os;
    },
  },
  Vibration: {
    vibrate: (...args: unknown[]) => mocks.vibrate(...args),
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useSyncExternalStore: <T,>(
      _subscribe: (listener: () => void) => () => void,
      getSnapshot: () => T,
    ): T => {
      mocks.useReducedMotionCalled = true;
      return getSnapshot();
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.os = 'android';
  mocks.useReducedMotionCalled = false;
  resetReducedMotionForTests(false);
});

afterEach(() => {
  resetReducedMotionForTests(false);
});

describe('useHaptics', () => {
  it.each(['tap', 'like', 'commit', 'drag'] as const)(
    'vibrates with the configured Android pattern for %s',
    (kind: HapticKind) => {
      expect(triggerHaptic(kind)).toBe(true);
      expect(mocks.vibrate).toHaveBeenCalledOnce();
      expect(mocks.vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS[kind]);
    },
  );

  it('suppresses vibration when reduced motion is enabled', () => {
    resetReducedMotionForTests(true);
    expect(triggerHaptic('like')).toBe(false);
    expect(mocks.vibrate).not.toHaveBeenCalled();
  });

  it('is a safe no-op on non-Android platforms', () => {
    mocks.os = 'ios';
    expect(triggerHaptic('tap')).toBe(false);
    expect(mocks.vibrate).not.toHaveBeenCalled();
  });

  it('rejects unknown haptic kinds and propagates unexpected Vibration errors loudly', () => {
    expect(() => triggerHaptic('unknown' as HapticKind)).toThrow(/Unknown haptic feedback kind/);
    mocks.vibrate.mockImplementationOnce(() => {
      throw new Error('VIBRATE permission denied');
    });
    expect(() => triggerHaptic('commit')).toThrow('VIBRATE permission denied');
  });

  it('returns a stable controller handle from useHaptics and subscribes to reduced motion', () => {
    const first = useHaptics();
    const second = useHaptics();
    expect(mocks.useReducedMotionCalled).toBe(true);
    expect(first).toBe(second);
    expect(first.trigger('drag')).toBe(true);
    expect(mocks.vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.drag);
  });
});
