import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId, flatStyle } from '../test/render';
import { opacity } from '../theme';
import { createTvFocusRegistry } from './TvFocusRegistry';
import { TvFocusable } from './TvFocusable';

const mocks = vi.hoisted(() => ({
  isTv: true,
  stateValues: [] as unknown[],
  stateIndex: 0,
  setters: [] as ReturnType<typeof vi.fn>[],
  effects: [] as (() => void | (() => void))[],
  refObject: { current: null as unknown },
  nodeHandle: 777,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useContext: () => ({ scope: 'home', registry: null }),
    useRef: () => mocks.refObject,
    useState: <T,>(initial: T | (() => T)) => {
      const idx = mocks.stateIndex++;
      if (!(idx in mocks.stateValues)) {
        mocks.stateValues[idx] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setter = vi.fn((next: T) => {
        mocks.stateValues[idx] = next;
      });
      mocks.setters[idx] = setter;
      return [mocks.stateValues[idx] as T, setter];
    },
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useEffect: (effect: () => void | (() => void)) => {
      mocks.effects.push(effect);
    },
  };
});

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  findNodeHandle: () => mocks.nodeHandle,
  StyleSheet: {
    absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    create: <T,>(styles: T): T => styles,
  },
}));

vi.mock('./tvEnvironment', () => ({
  isTvMode: () => mocks.isTv,
}));

vi.mock('./TvFocusRing', () => ({
  TV_DEFAULT_FOCUS_SCALE: 1.04,
  TvFocusRing: 'TvFocusRing',
}));

function renderFocusable(props: Partial<Parameters<typeof TvFocusable>[0]> = {}) {
  mocks.stateIndex = 0;
  mocks.effects = [];
  return TvFocusable({
    testID: 'tile-1',
    accessibilityRole: 'button',
    accessibilityLabel: 'Album öffnen',
    children: React.createElement('Child'),
    ...props,
  }) as React.ReactElement<Record<string, unknown>>;
}

beforeEach(() => {
  mocks.isTv = true;
  mocks.stateValues = [];
  mocks.stateIndex = 0;
  mocks.setters = [];
  mocks.effects = [];
  mocks.refObject = { current: { focus: vi.fn() } };
  mocks.nodeHandle = 777;
});

describe('TvFocusable', () => {
  it('wraps Pressable in TvFocusRing, wires preferredFocus and nextFocus* handles in TV mode', () => {
    const registry = createTvFocusRegistry();
    registry.register('tv-nav-home', { requestFocus: vi.fn(), getNodeHandle: () => 42 }, 'tv-nav-rail');

    const rendered = renderFocusable({
      registry,
      focusKey: 'home-card-1',
      preferredFocus: true,
      nextFocusLeftKey: 'tv-nav-home',
      nextFocusDown: 99,
      ringRadius: 'panel',
    });

    expect(rendered.type).toBe('TvFocusRing');
    expect(rendered.props.radius).toBe('panel');
    expect(rendered.props.scale).toBe(1.04);

    const pressable = byTestId(rendered, 'tile-1');
    expect(pressable.props.focusable).toBe(true);
    expect(pressable.props.hasTVPreferredFocus).toBe(true);
    expect(pressable.props.nextFocusLeft).toBe(42);
    expect(pressable.props.nextFocusDown).toBe(99);
    // Unspecified directional overrides must be omitted so Fabric never receives empty keys.
    expect('nextFocusUp' in pressable.props).toBe(false);
    expect('nextFocusRight' in pressable.props).toBe(false);
    expect('nextFocusForward' in pressable.props).toBe(false);
  });

  it('omits hasTVPreferredFocus when not requested in TV mode and never enables it on touch phones', () => {
    const tvIdle = renderFocusable();
    const tvIdlePressable = byTestId(tvIdle, 'tile-1');
    expect('hasTVPreferredFocus' in tvIdlePressable.props).toBe(false);

    mocks.isTv = false;
    const rendered = renderFocusable({
      preferredFocus: true,
      hasTVPreferredFocus: true,
    });

    expect(rendered.props.scale).toBe(1);
    const pressable = byTestId(rendered, 'tile-1');
    expect('hasTVPreferredFocus' in pressable.props).toBe(false);
    expect(pressable.props.focusable).toBe(true);
  });

  it('records focus/blur in TvFocusRegistry, invokes user callbacks, and supports programmatic focus return', () => {
    const registry = createTvFocusRegistry();
    const onFocus = vi.fn();
    const onBlur = vi.fn();

    const rendered = renderFocusable({
      registry,
      focusKey: 'home-card-2',
      focusScope: 'home',
      onFocus,
      onBlur,
    });

    // Run registration effect.
    const cleanup = mocks.effects[0]?.();
    expect(registry.getNodeHandle('home-card-2')).toBe(777);

    // Programmatic focus pulses requestedFocusPulse and calls ref.focus().
    expect(registry.requestFocus('home-card-2')).toBe(true);
    expect(mocks.setters[1]).toHaveBeenCalledWith(true);
    expect((mocks.refObject.current as { focus: ReturnType<typeof vi.fn> }).focus).toHaveBeenCalledTimes(1);

    // Focus event clears pulse, sets focused=true, and records scope memory.
    const pressable = byTestId(rendered, 'tile-1');
    (pressable.props.onFocus as (e: unknown) => void)({ target: 777 });
    expect(mocks.setters[0]).toHaveBeenCalledWith(true);
    expect(mocks.setters[1]).toHaveBeenCalledWith(false);
    expect(registry.getLastFocusedKey('home')).toBe('home-card-2');
    expect(onFocus).toHaveBeenCalledTimes(1);

    // Blur event clears focused=false while keeping scope memory intact.
    (pressable.props.onBlur as (e: unknown) => void)({ target: 777 });
    expect(mocks.setters[0]).toHaveBeenCalledWith(false);
    expect(registry.getLastFocusedKey('home')).toBe('home-card-2');
    expect(onBlur).toHaveBeenCalledTimes(1);

    if (typeof cleanup === 'function') cleanup();
    expect(registry.getNodeHandle('home-card-2')).toBeNull();
  });

  it('disables focusability, preferred focus, and dims opacity when disabled', () => {
    const rendered = renderFocusable({
      disabled: true,
      preferredFocus: true,
    });
    const pressable = byTestId(rendered, 'tile-1');
    expect(pressable.props.focusable).toBe(false);
    expect(pressable.props.hasTVPreferredFocus).toBeUndefined();
    expect(flatStyle(pressable.props.style).opacity).toBe(opacity.disabled);
  });
});
