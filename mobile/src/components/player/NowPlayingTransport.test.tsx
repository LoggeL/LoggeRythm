import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { metrics } from '../../theme';
import NowPlayingTransport from './NowPlayingTransport';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('@react-native-community/slider', () => ({ default: 'Slider' }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`Missing ${testID}`);
  return found;
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textContent((node as React.ReactElement<ElementProps>).props.children);
}

function flattenedStyle(value: unknown): Record<string, unknown> {
  const parts = (Array.isArray(value) ? value.flat(Infinity) : [value])
    .filter((part): part is Record<string, unknown> => (
      part !== null && typeof part === 'object' && !Array.isArray(part)
    ));
  return Object.assign({}, ...parts);
}

function compactTransport(overrides: Partial<Parameters<typeof NowPlayingTransport>[0]> = {}) {
  return NowPlayingTransport({
    variant: 'compact',
    testIDPrefix: 'lyrics',
    position: 12.5,
    duration: 205,
    playing: false,
    buffering: false,
    onPositionChange: vi.fn(),
    onSeek: vi.fn(),
    onPrevious: vi.fn(),
    onTogglePlay: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  });
}

describe('NowPlayingTransport', () => {
  it('renders compact progress and forwards the single owner commands', () => {
    const onPositionChange = vi.fn();
    const onSeek = vi.fn();
    const onPrevious = vi.fn();
    const onTogglePlay = vi.fn();
    const onNext = vi.fn();
    const rendered = compactTransport({
      onPositionChange,
      onSeek,
      onPrevious,
      onTogglePlay,
      onNext,
    });

    expect(textContent(byTestId(rendered, 'lyrics-position'))).toBe('0:12');
    expect(textContent(byTestId(rendered, 'lyrics-duration'))).toBe('3:25');

    const slider = byTestId(rendered, 'lyrics-slider');
    expect(slider.props.accessibilityLabel).toBe(strings.player.playbackPosition);
    expect(slider.props.accessibilityValue).toEqual({ min: 0, max: 205, now: 12.5 });
    expect(flattenedStyle(slider.props.style).height).toBe(metrics.minimumTouchTarget);
    (slider.props.onValueChange as (value: number) => void)(44);
    (slider.props.onSlidingComplete as (value: number) => void)(45);

    const previous = byTestId(rendered, 'lyrics-previous');
    const playPause = byTestId(rendered, 'lyrics-play-pause');
    const next = byTestId(rendered, 'lyrics-next');
    (previous.props.onPress as () => void)();
    (playPause.props.onPress as () => void)();
    (next.props.onPress as () => void)();

    expect(onPositionChange).toHaveBeenCalledExactlyOnceWith(44);
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(45);
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onTogglePlay).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(previous.props.accessibilityLabel).toBe(strings.common.previousTrack);
    expect(playPause.props.accessibilityLabel).toBe(strings.common.play);
    expect(next.props.accessibilityLabel).toBe(strings.common.nextTrack);

    for (const control of [previous, playPause, next]) {
      const style = flattenedStyle(control.props.style);
      expect(style.minWidth).toBeGreaterThanOrEqual(metrics.minimumTouchTarget);
      expect(style.minHeight).toBeGreaterThanOrEqual(metrics.minimumTouchTarget);
    }
    expect(flattenedStyle(playPause.props.style)).toEqual(expect.objectContaining({
      width: metrics.minimumTouchTarget,
      height: metrics.minimumTouchTarget,
    }));
  });

  it('exposes buffering and unavailable-duration state without inventing progress', () => {
    const rendered = compactTransport({
      position: 9,
      duration: 0,
      playing: true,
      buffering: true,
    });
    const slider = byTestId(rendered, 'lyrics-slider');
    const playPause = byTestId(rendered, 'lyrics-play-pause');

    expect(slider.props.disabled).toBe(true);
    expect(slider.props.accessibilityState).toEqual({ disabled: true });
    expect(slider.props.accessibilityValue).toEqual({ min: 0, max: 1, now: 0 });
    expect(textContent(byTestId(rendered, 'lyrics-position'))).toBe('0:09');
    expect(textContent(byTestId(rendered, 'lyrics-duration'))).toBe('0:00');
    expect(playPause.props.accessibilityLabel).toBe(strings.common.pause);
    expect(playPause.props.accessibilityState).toEqual({ busy: true });
    expect(byTestId(rendered, 'lyrics-buffering')).toBeDefined();
  });

  it('keeps the full transport extension slots used by shuffle and repeat', () => {
    const leadingControl = React.createElement('LeadingControl', {
      testID: 'leading-control',
    });
    const trailingControl = React.createElement('TrailingControl', {
      testID: 'trailing-control',
    });
    const rendered = NowPlayingTransport({
      position: 30,
      duration: 120,
      playing: true,
      buffering: false,
      onPositionChange: vi.fn(),
      onSeek: vi.fn(),
      onPrevious: vi.fn(),
      onTogglePlay: vi.fn(),
      onNext: vi.fn(),
      leadingControl,
      trailingControl,
    });

    expect(byTestId(rendered, 'leading-control')).toBeDefined();
    expect(byTestId(rendered, 'now-playing-slider')).toBeDefined();
    expect(byTestId(rendered, 'now-playing-previous')).toBeDefined();
    expect(byTestId(rendered, 'now-playing-play-pause')).toBeDefined();
    expect(byTestId(rendered, 'now-playing-next')).toBeDefined();
    expect(byTestId(rendered, 'trailing-control')).toBeDefined();
  });
});
