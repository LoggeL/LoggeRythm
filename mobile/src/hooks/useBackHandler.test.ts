import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackHandler } from './useBackHandler';

const mocks = vi.hoisted(() => ({
  os: 'android' as 'android' | 'ios',
  effects: [] as (() => void | (() => void))[],
  refs: [] as { current: unknown }[],
  remove: vi.fn(),
  listener: null as (() => boolean) | null,
  addEventListener: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: <T,>(initial: T) => {
      if (mocks.refs.length === 0) {
        mocks.refs.push({ current: initial });
      }
      return mocks.refs[0] as { current: T };
    },
    useEffect: (effect: () => void | (() => void)) => {
      mocks.effects.push(effect);
    },
  };
});

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mocks.os;
    },
  },
  BackHandler: {
    addEventListener: (event: string, listener: () => boolean) => {
      mocks.addEventListener(event, listener);
      mocks.listener = listener;
      return { remove: mocks.remove };
    },
  },
}));

function flushEffects(): (() => void)[] {
  const cleanups: (() => void)[] = [];
  for (const effect of mocks.effects.splice(0)) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  }
  return cleanups;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.os = 'android';
  mocks.effects.length = 0;
  mocks.refs.length = 0;
  mocks.listener = null;
});

describe('useBackHandler', () => {
  it('registers on Android when enabled, consumes void/true handlers, and cleans up on unmount', () => {
    const onBack = vi.fn();
    useBackHandler(true, onBack);
    const cleanups = flushEffects();

    expect(mocks.addEventListener).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    expect(mocks.listener?.()).toBe(true);
    expect(onBack).toHaveBeenCalledOnce();

    cleanups.forEach((cleanup) => cleanup());
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it('forwards explicit false returns so callers can decline handling', () => {
    const onBack = vi.fn(() => false);
    useBackHandler(true, onBack);
    flushEffects();

    expect(mocks.listener?.()).toBe(false);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('always invokes the latest callback without re-registering BackHandler', () => {
    const first = vi.fn();
    const second = vi.fn();
    useBackHandler(true, first);
    flushEffects();

    useBackHandler(true, second);
    // Only the ref-sync effect (index 0) runs when `onBack` changes and `enabled` stays true.
    mocks.effects[0]();
    expect(mocks.addEventListener).toHaveBeenCalledTimes(1);
    expect(mocks.listener?.()).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('does not subscribe when disabled or on non-Android platforms', () => {
    useBackHandler(false, vi.fn());
    flushEffects();
    expect(mocks.addEventListener).not.toHaveBeenCalled();

    mocks.os = 'ios';
    useBackHandler(true, vi.fn());
    flushEffects();
    expect(mocks.addEventListener).not.toHaveBeenCalled();
  });
});
