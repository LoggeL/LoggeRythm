import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { opacity } from '../../theme';
import { PressableScale } from './PressableScale';

const mocks = vi.hoisted(() => ({
  spring: vi.fn((_value: unknown, _config: unknown) => ({ start: vi.fn() })),
  createAnimatedComponent: vi.fn((component: unknown) => `Animated(${String(component)})`),
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
  };
});
vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      interpolate(config: unknown) {
        return { interpolate: config };
      }
    },
    spring: mocks.spring,
    createAnimatedComponent: mocks.createAnimatedComponent,
  },
  Pressable: 'Pressable',
}));

type Props = Record<string, unknown> & { style: Record<string, unknown>[] };

function render(props: Partial<Parameters<typeof PressableScale>[0]> = {}) {
  return PressableScale({ children: React.createElement('Child'), ...props }) as React.ReactElement<Props>;
}

beforeEach(() => {
  mocks.spring.mockClear();
});

describe('PressableScale', () => {
  it('wraps an animated Pressable and forwards accessibility and test props', () => {
    const onPress = vi.fn();
    const rendered = render({
      onPress,
      testID: 'album-card',
      accessibilityRole: 'button',
      accessibilityLabel: 'Album öffnen',
      style: { width: 148 },
    });
    expect(rendered.type).toBe('Animated(Pressable)');
    expect(rendered.props.testID).toBe('album-card');
    expect(rendered.props.accessibilityRole).toBe('button');
    expect(rendered.props.accessibilityLabel).toBe('Album öffnen');
    expect(rendered.props.onPress).toBe(onPress);
    expect(rendered.props.style[0]).toEqual({ width: 148 });
    render();
    expect(mocks.createAnimatedComponent).toHaveBeenCalledOnce();
  });

  it('springs towards the pressed scale and back on the native driver', () => {
    const onPressIn = vi.fn();
    const onPressOut = vi.fn();
    const rendered = render({ onPressIn, onPressOut, scaleTo: 0.9 });
    const animated = rendered.props.style[1] as {
      transform: { scale: { interpolate: { outputRange: number[] } } }[];
    };
    expect(animated.transform[0].scale.interpolate.outputRange).toEqual([1, 0.9]);

    (rendered.props.onPressIn as (event: unknown) => void)('in');
    expect(mocks.spring.mock.calls[0][1]).toMatchObject({ toValue: 1, useNativeDriver: true });
    expect(onPressIn).toHaveBeenCalledWith('in');

    (rendered.props.onPressOut as (event: unknown) => void)('out');
    expect(mocks.spring.mock.calls[1][1]).toMatchObject({ toValue: 0, useNativeDriver: true });
    expect(onPressOut).toHaveBeenCalledWith('out');
  });

  it('dims to the disabled opacity instead of animating when disabled', () => {
    const rendered = render({ disabled: true });
    expect(rendered.props.disabled).toBe(true);
    expect(rendered.props.style[1].opacity).toBe(opacity.disabled);
  });
});
