import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId, byType, flatStyle, textContent } from '../../test/render';
import { colors, metrics, radii, spacing } from '../../theme';
import { BottomSheet, shouldDismissSheet } from './BottomSheet';

type PanConfig = {
  onPanResponderMove: (event: unknown, gesture: { dy: number; vy: number }) => void;
  onPanResponderRelease: (event: unknown, gesture: { dy: number; vy: number }) => void;
};

const mocks = vi.hoisted(() => ({
  reducedMotion: false,
  stateIndex: 0,
  stateValues: [] as unknown[],
  stateSetters: [] as ReturnType<typeof vi.fn>[],
  effects: [] as (() => void)[],
  setValue: vi.fn(),
  springStop: vi.fn(),
  timingStop: vi.fn(),
  spring: vi.fn(),
  timing: vi.fn(),
  panConfig: null as unknown,
  backHandlerEnabled: false,
  backHandlerCallback: null as (() => boolean | void) | null,
  triggerHaptic: vi.fn(),
}));

mocks.spring.mockImplementation((_value: unknown, _config: unknown) => ({
  start: vi.fn(),
  stop: mocks.springStop,
}));
mocks.timing.mockImplementation((_value: unknown, _config: unknown) => ({
  start: vi.fn((cb?: (result: { finished: boolean }) => void) => cb?.({ finished: true })),
  stop: mocks.timingStop,
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
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: (effect: () => void) => {
      mocks.effects.push(effect);
    },
    useMemo: <T,>(factory: () => T) => factory(),
  };
});
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mocks.reducedMotion,
}));
vi.mock('../../hooks/useBackHandler', () => ({
  useBackHandler: (enabled: boolean, onBack: () => boolean | void) => {
    mocks.backHandlerEnabled = enabled;
    mocks.backHandlerCallback = onBack;
  },
}));
vi.mock('../../hooks/useHaptics', () => ({
  triggerHaptic: (...args: unknown[]) => mocks.triggerHaptic(...args),
}));
vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      setValue = mocks.setValue;
      interpolate(config: unknown) {
        return { interpolate: config };
      }
    },
    View: 'Animated.View',
    spring: mocks.spring,
    timing: mocks.timing,
  },
  Modal: 'Modal',
  PanResponder: {
    create: (config: unknown) => {
      mocks.panConfig = config;
      return { panHandlers: { onResponderMove: 'pan-handler' } };
    },
  },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 24, left: 0 }),
}));

function render(props: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  mocks.stateIndex = 0;
  return BottomSheet({
    visible: true,
    onClose: vi.fn(),
    closeLabel: 'Schließen',
    testID: 'track-sheet',
    children: React.createElement('Row', { testID: 'sheet-row' }),
    ...props,
  });
}

function resetInstance() {
  mocks.stateIndex = 0;
  mocks.stateValues = [];
  mocks.stateSetters = [];
  mocks.effects.length = 0;
}

beforeEach(() => {
  mocks.reducedMotion = false;
  resetInstance();
  mocks.backHandlerEnabled = false;
  mocks.backHandlerCallback = null;
  vi.clearAllMocks();
});

describe('BottomSheet', () => {
  it('is a transparent modal whose hardware back, BackHandler, and scrim close it with linked scrim opacity', () => {
    const onClose = vi.fn();
    const rendered = render({ onClose });
    expect(rendered.type).toBe('Modal');
    expect(rendered.props.visible).toBe(true);
    expect(rendered.props.transparent).toBe(true);
    expect(rendered.props.onRequestClose).toBe(onClose);
    expect(mocks.backHandlerEnabled).toBe(true);

    const scrim = byTestId(rendered, 'track-sheet-scrim');
    expect(scrim.props.accessibilityRole).toBe('button');
    expect(scrim.props.accessibilityLabel).toBe('Schließen');
    expect(scrim.props.focusable).toBe(false);
    expect(flatStyle(scrim.props.style).backgroundColor).toBe(colors.scrim);
    (scrim.props.onPress as () => void)();
    expect(onClose).toHaveBeenCalledOnce();

    // Scrim wrapper derives opacity from the sheet offset interpolation.
    const animatedViews = byType(rendered, 'Animated.View');
    expect(flatStyle(animatedViews[0].props.style).opacity).toMatchObject({
      interpolate: { outputRange: [1, 0], extrapolate: 'clamp' },
    });
  });

  it('routes Android Back through optional onBack override without affecting scrim close', () => {
    const onClose = vi.fn();
    const onBack = vi.fn();
    const rendered = render({ onClose, onBack });
    expect(rendered.props.onRequestClose).toBe(onBack);

    expect(mocks.backHandlerCallback?.()).toBe(true);
    expect(onBack).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();

    (byTestId(rendered, 'track-sheet-scrim').props.onPress as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders a rounded modal sheet with a >=48dp drag handle zone, safe-area padding, title and children', () => {
    const rendered = render({ title: 'Titelaktionen' });
    const sheet = byTestId(rendered, 'track-sheet');
    expect(sheet.type).toBe('Animated.View');
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    expect(flatStyle(sheet.props.style)).toMatchObject({
      borderTopLeftRadius: radii.sheet,
      borderTopRightRadius: radii.sheet,
      paddingBottom: 24 + spacing.md,
    });
    const handle = byTestId(rendered, 'track-sheet-handle');
    expect(flatStyle(handle.props.style).minHeight).toBeGreaterThanOrEqual(
      metrics.minimumTouchTarget,
    );
    const [title] = byType(rendered, 'Text');
    expect(title.props.accessibilityRole).toBe('header');
    expect(textContent(rendered)).toEqual(['Titelaktionen']);
    expect(byTestId(rendered, 'sheet-row')).toBeDefined();

    resetInstance();
    expect(byType(render(), 'Text')).toHaveLength(0);
  });

  it('springs in when becoming visible and slides out smoothly before hiding', () => {
    render({ visible: false });
    mocks.effects[0]();
    expect(mocks.spring).not.toHaveBeenCalled();
    expect(mocks.timing).not.toHaveBeenCalled();

    resetInstance();
    mocks.setValue.mockClear();
    render({ visible: true });
    mocks.effects[0]();
    expect(mocks.setValue).toHaveBeenCalledOnce();
    expect(mocks.spring.mock.calls[0][1]).toMatchObject({ toValue: 0, useNativeDriver: true });

    // Transition visible true -> false triggers exiting state, then smooth slide-out timing.
    mocks.effects.length = 0;
    render({ visible: false }); // updates prevVisible + sets exiting = true
    const exitingTree = render({ visible: false }); // re-renders with exiting = true
    expect(exitingTree.props.visible).toBe(true);
    mocks.effects[mocks.effects.length - 1]();
    expect(mocks.timing).toHaveBeenCalledOnce();
    expect(mocks.timing.mock.calls[0][1]).toMatchObject({ useNativeDriver: true });
    expect(mocks.stateSetters[1]).toHaveBeenLastCalledWith(false);
  });

  it('skips spring and slide animations when reduced motion is enabled', () => {
    mocks.reducedMotion = true;
    render({ visible: true });
    mocks.effects[0]();
    expect(mocks.setValue).toHaveBeenCalledWith(0);
    expect(mocks.spring).not.toHaveBeenCalled();

    mocks.effects.length = 0;
    render({ visible: false });
    const hiddenTree = render({ visible: false });
    expect(hiddenTree.props.visible).toBe(false);
    mocks.effects[mocks.effects.length - 1]();
    expect(mocks.timing).not.toHaveBeenCalled();
  });

  it('follows a downward drag on the handle and closes past the threshold with commit haptic', () => {
    const onClose = vi.fn();
    const rendered = render({ onClose });
    expect(byTestId(rendered, 'track-sheet-handle').props.onResponderMove).toBe('pan-handler');
    const pan = mocks.panConfig as PanConfig;

    pan.onPanResponderMove(null, { dy: 40, vy: 0 });
    expect(mocks.setValue).toHaveBeenLastCalledWith(40);
    pan.onPanResponderMove(null, { dy: -30, vy: 0 });
    expect(mocks.setValue).toHaveBeenLastCalledWith(0);

    pan.onPanResponderRelease(null, { dy: 40, vy: 0.1 });
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.spring.mock.calls[0][1]).toMatchObject({ toValue: 0 });

    pan.onPanResponderRelease(null, { dy: 160, vy: 0.1 });
    expect(mocks.triggerHaptic).toHaveBeenCalledWith('commit');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('dismisses on a long drag or a fast downward flick only', () => {
    expect(shouldDismissSheet({ dy: 97, vy: 0 })).toBe(true);
    expect(shouldDismissSheet({ dy: 30, vy: 1.2 })).toBe(true);
    expect(shouldDismissSheet({ dy: 30, vy: 0.2 })).toBe(false);
    expect(shouldDismissSheet({ dy: 5, vy: 2 })).toBe(false);
    expect(shouldDismissSheet({ dy: -200, vy: -2 })).toBe(false);
  });
});
