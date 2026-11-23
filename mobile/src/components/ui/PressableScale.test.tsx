import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byType, flatStyle } from '../../test/render';
import { colors, opacity, radii } from '../../theme';
import {
  createFocusRingController,
  FocusRingOverlay,
  PressableScale,
} from './PressableScale';

const mocks = vi.hoisted(() => ({
  reducedMotion: false,
  memoCalls: 0,
  memoCache: new Map<number, { deps: readonly unknown[]; value: unknown }>(),
  stateIndex: 0,
  stateValues: [] as unknown[],
  stateSetters: [] as ReturnType<typeof vi.fn>[],
  effects: [] as (() => void | (() => void))[],
  setValue: vi.fn(),
  timing: vi.fn((_value: unknown, _config: unknown) => ({ start: vi.fn() })),
  spring: vi.fn((_value: unknown, _config: unknown) => ({ start: vi.fn() })),
  createAnimatedComponent: vi.fn((component: unknown) => `Animated(${String(component)})`),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: <T,>(initial: T | (() => T)) => {
      const slot = mocks.stateIndex++;
      if (slot >= mocks.stateValues.length) {
        mocks.stateValues[slot] =
          typeof initial === 'function' ? (initial as () => T)() : initial;
        mocks.stateSetters[slot] = vi.fn((next: T) => {
          mocks.stateValues[slot] = next;
        });
      }
      return [mocks.stateValues[slot] as T, mocks.stateSetters[slot]];
    },
    useEffect: (effect: () => void | (() => void)) => {
      mocks.effects.push(effect);
    },
    useMemo: <T,>(factory: () => T, deps: readonly unknown[]) => {
      const slot = mocks.memoCalls++;
      const prev = mocks.memoCache.get(slot);
      if (
        prev !== undefined
        && prev.deps.length === deps.length
        && prev.deps.every((dep, idx) => Object.is(dep, deps[idx]))
      ) {
        return prev.value as T;
      }
      const value = factory();
      mocks.memoCache.set(slot, { deps, value });
      return value;
    },
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mocks.reducedMotion,
}));
vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      setValue = mocks.setValue;
      interpolate(config: unknown) {
        return { interpolate: config };
      }
    },
    timing: mocks.timing,
    spring: mocks.spring,
    createAnimatedComponent: mocks.createAnimatedComponent,
  },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));

type Props = Record<string, unknown> & { style: Record<string, unknown>[] };

function render(props: Partial<Parameters<typeof PressableScale>[0]> = {}) {
  mocks.memoCalls = 0;
  mocks.stateIndex = 0;
  return PressableScale({ children: React.createElement('Child'), ...props }) as React.ReactElement<Props>;
}

function renderFocusOverlay(props: Parameters<typeof FocusRingOverlay>[0]) {
  mocks.stateIndex = 0;
  const Inner = (FocusRingOverlay as unknown as { type: (p: Parameters<typeof FocusRingOverlay>[0]) => React.ReactNode }).type;
  return Inner(props);
}

beforeEach(() => {
  mocks.reducedMotion = false;
  mocks.memoCalls = 0;
  mocks.memoCache.clear();
  mocks.stateIndex = 0;
  mocks.stateValues = [];
  mocks.stateSetters = [];
  mocks.effects.length = 0;
  mocks.setValue.mockClear();
  mocks.timing.mockClear();
  mocks.spring.mockClear();
});

describe('PressableScale', () => {
  it('wraps an animated Pressable, forwards props, and memoizes animated interpolations across renders', () => {
    const onPress = vi.fn();
    const first = render({
      onPress,
      testID: 'album-card',
      accessibilityRole: 'button',
      accessibilityLabel: 'Album öffnen',
      style: { width: 148 },
    });
    expect(first.type).toBe('Animated(Pressable)');
    expect(first.props.testID).toBe('album-card');
    expect(first.props.accessibilityRole).toBe('button');
    expect(first.props.accessibilityLabel).toBe('Album öffnen');
    expect(first.props.onPress).toBe(onPress);
    expect(first.props.style[0]).toEqual({ width: 148 });

    const second = render({ onPress, style: { width: 148 } });
    expect(second.props.style[1]).toBe(first.props.style[1]);
    expect(mocks.createAnimatedComponent).toHaveBeenCalledOnce();
  });

  it('uses fast native timing on press-in and springs back on press-out', () => {
    const onPressIn = vi.fn();
    const onPressOut = vi.fn();
    const rendered = render({ onPressIn, onPressOut, scaleTo: 0.9 });
    const animated = rendered.props.style[1] as {
      transform: { scale: { interpolate: { outputRange: number[] } } }[];
    };
    expect(animated.transform[0].scale.interpolate.outputRange).toEqual([1, 0.9]);

    (rendered.props.onPressIn as (event: unknown) => void)('in');
    expect(mocks.timing).toHaveBeenCalledOnce();
    expect(mocks.timing.mock.calls[0][1]).toMatchObject({
      toValue: 1,
      useNativeDriver: true,
    });
    expect(onPressIn).toHaveBeenCalledWith('in');

    (rendered.props.onPressOut as (event: unknown) => void)('out');
    expect(mocks.spring).toHaveBeenCalledOnce();
    expect(mocks.spring.mock.calls[0][1]).toMatchObject({
      toValue: 0,
      useNativeDriver: true,
    });
    expect(onPressOut).toHaveBeenCalledWith('out');
  });

  it('removes scale motion and applies instant opacity transitions when reduced motion is enabled', () => {
    mocks.reducedMotion = true;
    const rendered = render({ scaleTo: 0.9 });
    expect(rendered.props.style[1].transform).toBeUndefined();

    (rendered.props.onPressIn as (event: unknown) => void)('in');
    expect(mocks.setValue).toHaveBeenLastCalledWith(1);
    expect(mocks.timing).not.toHaveBeenCalled();

    (rendered.props.onPressOut as (event: unknown) => void)('out');
    expect(mocks.setValue).toHaveBeenLastCalledWith(0);
    expect(mocks.spring).not.toHaveBeenCalled();
  });

  it('dims to the disabled opacity instead of animating when disabled', () => {
    const rendered = render({ disabled: true });
    expect(rendered.props.disabled).toBe(true);
    expect(rendered.props.style[1].opacity).toBe(opacity.disabled);
  });

  it('forwards Android TV focus props and paints a zero-layout-shift absolute focus ring overlay', () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const initial = render({
      testID: 'card-1',
      focusable: true,
      hasTVPreferredFocus: true,
      onFocus,
      onBlur,
      style: { width: 148, borderRadius: radii.panel },
      focusedStyle: { borderColor: colors.brand },
    });
    expect(initial.props.focusable).toBe(true);
    expect(initial.props.hasTVPreferredFocus).toBe(true);
    expect(byType(initial, 'View')).toHaveLength(0);
    expect(flatStyle(initial.props.style).borderWidth).toBeUndefined();

    (initial.props.onFocus as (event: unknown) => void)('focus-event');
    expect(onFocus).toHaveBeenCalledWith('focus-event');

    const focused = render({
      testID: 'card-1',
      style: { width: 148, borderRadius: radii.panel },
      focusedStyle: { borderColor: colors.brand },
      onFocus,
      onBlur,
    });
    // Container border must never change on focus (zero layout shift).
    expect(flatStyle(focused.props.style).borderWidth).toBeUndefined();
    const [ring] = byType(focused, 'View');
    expect(ring.props.testID).toBe('card-1-focus-ring');
    expect(ring.props.pointerEvents).toBe('none');
    expect(flatStyle(ring.props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderWidth: 2,
      borderRadius: radii.panel,
      borderColor: colors.brand,
    });

    (focused.props.onBlur as (event: unknown) => void)('blur-event');
    expect(onBlur).toHaveBeenCalledWith('blur-event');
    expect(byType(render({ testID: 'card-1' }), 'View')).toHaveLength(0);
  });
});

describe('createFocusRingController & FocusRingOverlay', () => {
  it('retains and replays early focus events arriving before subscribe', () => {
    const controller = createFocusRingController();
    expect(controller.getFocused()).toBe(false);

    // Simulates hasTVPreferredFocus firing onFocus before FocusRingOverlay effect subscribes.
    controller.setFocused(true);
    expect(controller.getFocused()).toBe(true);

    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    expect(listener).toHaveBeenCalledWith(true);

    controller.setFocused(false);
    expect(controller.getFocused()).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(false);
    unsubscribe();
  });

  it('preserves mounted focus across fresh hook-free controller re-renders and clears on subsequent blur', () => {
    const firstController = createFocusRingController();
    expect(renderFocusOverlay({ controller: firstController })).toBeNull();
    const cleanupFirst = mocks.effects.pop()?.() as (() => void) | undefined;

    // Button receives focus on firstController.
    firstController.setFocused(true);
    expect(renderFocusOverlay({ controller: firstController })).not.toBeNull();

    // Parent re-renders hook-free button -> allocates a fresh untouched controller.
    const secondController = createFocusRingController();
    cleanupFirst?.();
    const stillFocused = renderFocusOverlay({ controller: secondController });
    expect(stillFocused).not.toBeNull();
    mocks.effects.pop()?.();

    // Subsequent blur on secondController cleanly clears the overlay.
    secondController.setFocused(false);
    expect(renderFocusOverlay({ controller: secondController })).toBeNull();
  });
});
