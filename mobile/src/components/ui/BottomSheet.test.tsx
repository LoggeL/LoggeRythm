import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId, byType, flatStyle, textContent } from '../../test/render';
import { colors, radii, spacing } from '../../theme';
import { BottomSheet, shouldDismissSheet } from './BottomSheet';

type PanConfig = {
  onPanResponderMove: (event: unknown, gesture: { dy: number; vy: number }) => void;
  onPanResponderRelease: (event: unknown, gesture: { dy: number; vy: number }) => void;
};

const mocks = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  setValue: vi.fn(),
  spring: vi.fn((_value: unknown, _config: unknown) => ({ start: vi.fn() })),
  panConfig: null as unknown,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: <T,>(initial: T | (() => T)) => [
      typeof initial === 'function' ? (initial as () => T)() : initial,
      vi.fn(),
    ],
    useEffect: (effect: () => void) => {
      mocks.effects.push(effect);
    },
    useMemo: <T,>(factory: () => T) => factory(),
  };
});
vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      setValue = mocks.setValue;
    },
    View: 'Animated.View',
    spring: mocks.spring,
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
  return BottomSheet({
    visible: true,
    onClose: vi.fn(),
    closeLabel: 'Schließen',
    testID: 'track-sheet',
    children: React.createElement('Row', { testID: 'sheet-row' }),
    ...props,
  });
}

beforeEach(() => {
  mocks.effects.length = 0;
  vi.clearAllMocks();
});

describe('BottomSheet', () => {
  it('is a transparent modal whose hardware back and scrim both close it', () => {
    const onClose = vi.fn();
    const rendered = render({ onClose });
    expect(rendered.type).toBe('Modal');
    expect(rendered.props.visible).toBe(true);
    expect(rendered.props.transparent).toBe(true);
    expect(rendered.props.onRequestClose).toBe(onClose);

    const scrim = byTestId(rendered, 'track-sheet-scrim');
    expect(scrim.props.accessibilityRole).toBe('button');
    expect(scrim.props.accessibilityLabel).toBe('Schließen');
    expect(flatStyle(scrim.props.style).backgroundColor).toBe(colors.scrim);
    (scrim.props.onPress as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders a rounded modal sheet with safe-area padding, title and children', () => {
    const rendered = render({ title: 'Titelaktionen' });
    const sheet = byTestId(rendered, 'track-sheet');
    expect(sheet.type).toBe('Animated.View');
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    expect(flatStyle(sheet.props.style)).toMatchObject({
      borderTopLeftRadius: radii.sheet,
      borderTopRightRadius: radii.sheet,
      paddingBottom: 24 + spacing.md,
    });
    const [title] = byType(rendered, 'Text');
    expect(title.props.accessibilityRole).toBe('header');
    expect(textContent(rendered)).toEqual(['Titelaktionen']);
    expect(byTestId(rendered, 'sheet-row')).toBeDefined();
    expect(byType(render(), 'Text')).toHaveLength(0);
  });

  it('springs in when it becomes visible and stays put while hidden', () => {
    render({ visible: false });
    mocks.effects[0]();
    expect(mocks.spring).not.toHaveBeenCalled();

    mocks.effects.length = 0;
    render({ visible: true });
    mocks.effects[0]();
    expect(mocks.setValue).toHaveBeenCalledOnce();
    expect(mocks.spring.mock.calls[0][1]).toMatchObject({ toValue: 0, useNativeDriver: true });
  });

  it('follows a downward drag on the handle and closes past the threshold', () => {
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
