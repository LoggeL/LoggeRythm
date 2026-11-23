import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackPresentationState } from '../player/trackPresentation';
import { resetTvEnvironmentForTests, setTvModeOverride } from '../tv/tvEnvironment';
import TrackStateIndicator, {
  EqualizerBars,
  type TrackStateIndicatorCopy,
} from './TrackStateIndicator';

const mocks = vi.hoisted(() => ({
  reducedMotion: false,
  loopStart: vi.fn(),
  loopStop: vi.fn(),
  timingCalls: [] as Record<string, unknown>[],
  effectCleanups: [] as (() => void)[],
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
    useMemo: <T,>(factory: () => T) => factory(),
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect();
      if (typeof cleanup === 'function') mocks.effectCleanups.push(cleanup);
    },
  };
});

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    Value: class {
      setValue = vi.fn();
      interpolate = vi.fn(() => 'interpolated');
    },
    View: 'Animated.View',
    loop: vi.fn(() => ({
      start: mocks.loopStart,
      stop: mocks.loopStop,
    })),
    sequence: vi.fn((items: unknown) => items),
    timing: vi.fn((_value: unknown, config: Record<string, unknown>) => {
      mocks.timingCalls.push(config);
      return config;
    }),
  },
  Easing: {
    inOut: (fn: unknown) => fn,
    sin: () => 0,
  },
  Platform: { OS: 'android', isTV: false },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mocks.reducedMotion,
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  if (
    typeof element.type === 'object'
    && element.type !== null
    && 'type' in element.type
    && typeof (element.type as { type?: unknown }).type === 'function'
  ) {
    const inner = (element.type as { type: (props: ElementProps) => React.ReactNode }).type;
    return [element, ...elements(inner(element.props))];
  }
  return [element, ...elements(element.props.children)];
}

function byTestID(
  node: React.ReactNode,
  testID: string,
): React.ReactElement<ElementProps> | null {
  return elements(node).find((element) => element.props.testID === testID) ?? null;
}

const copy: TrackStateIndicatorCopy = {
  playing: 'Playing',
  paused: 'Paused',
  buffering: 'Buffering',
  active: 'Current track',
  downloaded: 'Downloaded',
  serverCached: 'Stored on the server',
  rollingDeviceCache: (seconds) => `Rolling device cache ${seconds}s`,
};

function presentation(
  overrides: Partial<TrackPresentationState> = {},
): TrackPresentationState {
  return {
    active: true,
    playback: 'playing',
    serverCache: 'unknown',
    rollingDeviceCache: null,
    explicitDownload: { kind: 'unknown' },
    ...overrides,
  };
}

describe('TrackStateIndicator', () => {
  afterEach(() => {
    resetTvEnvironmentForTests();
  });

  it('leaves playing state to the row color instead of rendering a tag', () => {
    const rendered = TrackStateIndicator({ presentation: presentation(), copy });

    expect(rendered).toBeNull();
  });

  it('makes buffering both visible and accessibility-busy', () => {
    const rendered = TrackStateIndicator({
      presentation: presentation({ playback: 'buffering' }),
      copy,
      testID: 'state',
    });

    expect(byTestID(rendered, 'state')?.props).toMatchObject({
      accessibilityLabel: 'Buffering',
      accessibilityState: { selected: true, busy: true },
      focusable: false,
    });
    expect(byTestID(rendered, 'state-buffering-spinner')?.props.accessible).toBe(false);
  });

  it('renders only positive server and rolling-cache evidence', () => {
    const rendered = TrackStateIndicator({
      presentation: presentation({
        playback: 'paused',
        serverCache: 'cached',
        rollingDeviceCache: { kind: 'rolling-lru', seconds: 61.5 },
      }),
      copy,
    });

    expect(byTestID(rendered, 'track-state')?.props.accessibilityLabel).toBe(
      'Stored on the server. Rolling device cache 61.5s',
    );
    expect(byTestID(rendered, 'track-state-server-cache')).not.toBeNull();
    expect(byTestID(rendered, 'track-state-rolling-cache')).not.toBeNull();
  });

  it('renders a verified explicit download as visible and accessible evidence', () => {
    const rendered = TrackStateIndicator({
      presentation: presentation({
        active: false,
        playback: 'inactive',
        explicitDownload: { kind: 'downloaded' },
      }),
      copy,
    });

    expect(byTestID(rendered, 'track-state')?.props.accessibilityLabel).toBe('Downloaded');
    expect(byTestID(rendered, 'track-state-downloaded')).not.toBeNull();
  });

  it('does not turn unknown/not-cached or absent download into a badge', () => {
    const unknown = TrackStateIndicator({
      presentation: presentation({ active: false, playback: 'inactive' }),
      copy,
    });
    const knownAbsent = TrackStateIndicator({
      presentation: presentation({
        active: false,
        playback: 'inactive',
        serverCache: 'not-cached',
        explicitDownload: { kind: 'not-downloaded' },
      }),
      copy,
    });

    expect(unknown).toBeNull();
    expect(knownAbsent).toBeNull();
  });

  it('can show server evidence on an inactive row but suppresses impossible rolling evidence', () => {
    const rendered = TrackStateIndicator({
      presentation: presentation({
        active: false,
        playback: 'inactive',
        serverCache: 'cached',
        rollingDeviceCache: { kind: 'rolling-lru', seconds: 90 },
      }),
      copy,
    });

    expect(byTestID(rendered, 'track-state')?.props).toMatchObject({
      accessibilityLabel: 'Stored on the server',
      accessibilityState: { selected: false, busy: false },
      focusable: false,
    });
    expect(byTestID(rendered, 'track-state-server-cache')).not.toBeNull();
    expect(byTestID(rendered, 'track-state-rolling-cache')).toBeNull();
    expect(
      elements(rendered).some((element) => String(element.props.testID).includes('download')),
    ).toBe(false);
  });

  it('disables accessible in TV mode so RN 0.86 ReactViewManager does not force view.isFocusable = true', () => {
    setTvModeOverride(false);
    const phone = TrackStateIndicator({
      presentation: presentation({ serverCache: 'cached' }),
      copy,
    });
    expect(byTestID(phone, 'track-state')?.props).toMatchObject({
      accessible: true,
      focusable: false,
    });

    setTvModeOverride(true);
    const tv = TrackStateIndicator({
      presentation: presentation({ serverCache: 'cached' }),
      copy,
    });
    expect(byTestID(tv, 'track-state')?.props).toMatchObject({
      accessible: false,
      focusable: false,
    });
  });
});

describe('EqualizerBars', () => {
  beforeEach(() => {
    mocks.reducedMotion = false;
    mocks.loopStart.mockClear();
    mocks.loopStop.mockClear();
    mocks.timingCalls = [];
    mocks.effectCleanups = [];
  });

  it('runs native-driver animated bars while playing with reduced motion off and stops loops on cleanup', () => {
    const rendered = EqualizerBars({ bars: 4, height: 16, isPlaying: true, testID: 'eq' });
    const all = elements(rendered);
    const animatedBars = all.filter((element) => element.type === 'Animated.View');

    expect(animatedBars).toHaveLength(4);
    expect(mocks.loopStart).toHaveBeenCalledTimes(4);
    expect(mocks.timingCalls.length).toBeGreaterThan(0);
    expect(mocks.timingCalls.every((config) => config.useNativeDriver === true)).toBe(true);

    mocks.effectCleanups.forEach((cleanup) => cleanup());
    expect(mocks.loopStop).toHaveBeenCalledTimes(4);
  });

  it('renders static non-animated bars when paused or when reduced motion is enabled', () => {
    const paused = EqualizerBars({ bars: 4, isPlaying: false, testID: 'eq-paused' });
    expect(elements(paused).filter((element) => element.type === 'Animated.View')).toHaveLength(0);
    expect(mocks.loopStart).not.toHaveBeenCalled();

    mocks.reducedMotion = true;
    const reduced = EqualizerBars({ bars: 4, isPlaying: true, testID: 'eq-reduced' });
    expect(elements(reduced).filter((element) => element.type === 'Animated.View')).toHaveLength(0);
    expect(mocks.loopStart).not.toHaveBeenCalled();
  });

  it('fails loudly on invalid bar counts or heights', () => {
    expect(() => EqualizerBars({ bars: 0 })).toThrow(RangeError);
    expect(() => EqualizerBars({ bars: 17 })).toThrow(RangeError);
    expect(() => EqualizerBars({ height: 0 })).toThrow(RangeError);
    expect(() => EqualizerBars({ height: Number.NaN })).toThrow(RangeError);
  });
});
