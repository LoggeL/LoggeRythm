import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId, flatStyle, queryByTestId } from '../test/render';
import { colors, elevation, radii } from '../theme';
import {
  resolveTvFocusRingColor,
  resolveTvRingRadius,
  TV_DEFAULT_FOCUS_SCALE,
  TV_FOCUS_RING_WIDTH,
  TvFocusRing,
} from './TvFocusRing';

const mocks = vi.hoisted(() => ({
  reducedMotion: false,
}));

vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mocks.reducedMotion,
}));

vi.mock('react-native', () => ({
  View: 'View',
  StyleSheet: {
    absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    create: <T,>(styles: T): T => styles,
  },
}));

beforeEach(() => {
  mocks.reducedMotion = false;
});

describe('TvFocusRing', () => {
  it('renders no ring overlay or elevation when unfocused', () => {
    const rendered = TvFocusRing({
      focused: false,
      ringTestID: 'card-focus-ring',
      children: React.createElement('Child'),
    });

    expect(rendered.props.collapsable).toBe(false);
    expect(queryByTestId(rendered, 'card-focus-ring')).toBeNull();
    const containerStyle = flatStyle(rendered.props.style);
    expect(containerStyle.elevation).toBeUndefined();
    expect(containerStyle.transform).toBeUndefined();
    expect(containerStyle.borderRadius).toBe(radii.card);
  });

  it('renders a high-contrast non-layout-shifting ring, highlight, elevation, and subtle scale when focused', () => {
    const rendered = TvFocusRing({
      focused: true,
      radius: 'panel',
      tone: 'brand',
      ringTestID: 'panel-focus-ring',
      children: React.createElement('Child'),
    });

    const containerStyle = flatStyle(rendered.props.style);
    expect(containerStyle.elevation).toBe(elevation.floating.elevation);
    expect(containerStyle.transform).toEqual([{ scale: TV_DEFAULT_FOCUS_SCALE }]);

    const ring = byTestId(rendered, 'panel-focus-ring');
    expect(ring.props.pointerEvents).toBe('none');
    expect(ring.props.accessible).toBe(false);
    const ringStyle = flatStyle(ring.props.style);
    expect(ringStyle.position).toBe('absolute');
    expect(ringStyle.borderWidth).toBe(TV_FOCUS_RING_WIDTH);
    expect(ringStyle.borderColor).toBe(colors.brand);
    expect(ringStyle.borderRadius).toBe(radii.panel);
    expect(ringStyle.backgroundColor).toBe(colors.fill);
  });

  it('disables scale transform under reduced motion while preserving the high-contrast ring', () => {
    mocks.reducedMotion = true;
    const rendered = TvFocusRing({
      focused: true,
      tone: 'accent',
      ringTestID: 'reduced-ring',
      children: React.createElement('Child'),
    });

    const containerStyle = flatStyle(rendered.props.style);
    expect(containerStyle.transform).toBeUndefined();
    expect(containerStyle.elevation).toBe(elevation.floating.elevation);

    const ring = byTestId(rendered, 'reduced-ring');
    expect(flatStyle(ring.props.style).borderColor).toBe(colors.accentSoft);
  });

  it('fails loudly on unsupported tones or invalid radii', () => {
    expect(() => resolveTvFocusRingColor('neon' as never)).toThrow(/Unsupported TvFocusRing tone/);
    expect(() => resolveTvRingRadius(-4)).toThrow(RangeError);
    expect(() => resolveTvRingRadius('missing' as never)).toThrow(/Unknown radii token/);
  });
});
