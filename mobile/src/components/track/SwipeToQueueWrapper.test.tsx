import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { byTestId, queryByTestId } from '../../test/render';
import {
  shouldCaptureHorizontalQueueSwipe,
  shouldCommitHorizontalQueueSwipe,
  SwipeToQueueWrapper,
} from './SwipeToQueueWrapper';

const mocks = vi.hoisted(() => ({
  isTv: false,
  reducedMotion: false,
  hapticTrigger: vi.fn(),
  setValue: vi.fn(),
  springStart: vi.fn(),
  quickAdd: vi.fn(async () => true),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useMemo: <T,>(factory: () => T) => factory(),
  useState: <T,>(initial: T | (() => T)) => [
    typeof initial === 'function' ? (initial as () => T)() : initial,
    vi.fn(),
  ],
}));

vi.mock('react-native', () => ({
  Animated: {
    Value: class MockAnimatedValue {
      setValue = mocks.setValue;
    },
    View: 'Animated.View',
    spring: () => ({ start: mocks.springStart }),
  },
  PanResponder: {
    create: (config: Record<string, unknown>) => ({
      panHandlers: {
        onMoveShouldSetResponderCapture: config.onMoveShouldSetPanResponderCapture,
        onResponderMove: config.onPanResponderMove,
        onResponderRelease: config.onPanResponderRelease,
        onResponderTerminate: config.onPanResponderTerminate,
      },
    }),
  },
  Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));
vi.mock('../../hooks/useHaptics', () => ({ triggerHaptic: mocks.hapticTrigger }));
vi.mock('../../hooks/useReducedMotion', () => ({
  getReducedMotionSnapshot: () => mocks.reducedMotion,
}));
vi.mock('../../tv', () => ({ isTvMode: () => mocks.isTv }));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', () => ({ AppText: 'AppText' }));
vi.mock('../trackActions', () => ({ quickAddTrackToQueue: mocks.quickAdd }));

const track: Track = {
  id: '99',
  title: 'Veridis Quo',
  artist: 'Daft Punk',
  artist_id: '27',
  artists: [{ id: '27', name: 'Daft Punk' }],
  album: 'Discovery',
  album_id: '302127',
  cover: '',
  duration_sec: 344,
  preview_url: null,
  rank: 1,
  release_date: '2001-03-07',
};

describe('SwipeToQueueWrapper', () => {
  beforeEach(() => {
    mocks.isTv = false;
    mocks.reducedMotion = false;
    vi.clearAllMocks();
  });

  it('only captures clearly horizontal rightward swipes so vertical scrolling stays smooth', () => {
    expect(shouldCaptureHorizontalQueueSwipe(20, 2)).toBe(true);
    expect(shouldCaptureHorizontalQueueSwipe(20, 18)).toBe(false);
    expect(shouldCaptureHorizontalQueueSwipe(-30, 0)).toBe(false);
    expect(shouldCaptureHorizontalQueueSwipe(8, 0)).toBe(false);
    expect(shouldCommitHorizontalQueueSwipe(56)).toBe(true);
    expect(shouldCommitHorizontalQueueSwipe(40)).toBe(false);
  });

  it('commits queue addition with haptic feedback on release past threshold', () => {
    const onQueue = vi.fn();
    const wrapper = SwipeToQueueWrapper({
      track,
      testID: 'row-99',
      onQueue,
      children: React.createElement('View', { testID: 'child-row' }),
    });
    const tree = typeof wrapper.type === 'function'
      ? (wrapper.type as (props: unknown) => React.ReactElement)(wrapper.props)
      : wrapper;
    const surface = byTestId(tree, 'row-99-swipe-surface');
    expect(byTestId(tree, 'row-99-swipe-queue-action')).toBeDefined();

    (surface.props.onResponderMove as (e: unknown, g: { dx: number; dy: number }) => void)(
      {},
      { dx: 64, dy: 0 },
    );
    expect(mocks.setValue).toHaveBeenCalledWith(64);
    expect(mocks.hapticTrigger).toHaveBeenCalledWith('tap');

    (surface.props.onResponderRelease as (e: unknown, g: { dx: number; dy: number }) => void)(
      {},
      { dx: 64, dy: 0 },
    );
    expect(mocks.hapticTrigger).toHaveBeenCalledWith('commit');
    expect(onQueue).toHaveBeenCalledExactlyOnceWith(track);
  });

  it('disables swipe gesture wrapper on Android TV', () => {
    mocks.isTv = true;
    const tree = SwipeToQueueWrapper({
      track,
      testID: 'row-99',
      children: React.createElement('View', { testID: 'child-row' }),
    });
    expect(queryByTestId(tree, 'row-99-swipe-surface')).toBeNull();
    expect(byTestId(tree, 'child-row')).toBeDefined();
  });
});
