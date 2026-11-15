import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId, byType, flatStyle } from '../../test/render';
import { colors, layout, radii } from '../../theme';
import { CardRailSkeleton, Skeleton, TrackRowSkeleton } from './Skeleton';

const mocks = vi.hoisted(() => {
  const loop = { start: vi.fn(), stop: vi.fn() };
  return {
    loop,
    effects: [] as (() => void | (() => void))[],
    timing: vi.fn((_value: unknown, config: unknown) => ({ timing: config })),
    sequence: vi.fn((steps: unknown[]) => ({ sequence: steps })),
    loopFactory: vi.fn(() => loop),
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: <T,>(initial: T | (() => T)) => [
      typeof initial === 'function' ? (initial as () => T)() : initial,
      vi.fn(),
    ],
    useEffect: (effect: () => void | (() => void)) => {
      mocks.effects.push(effect);
    },
  };
});
vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      constructor(public value: number) {}
    },
    View: 'Animated.View',
    timing: mocks.timing,
    sequence: mocks.sequence,
    loop: mocks.loopFactory,
  },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));

beforeEach(() => {
  mocks.effects.length = 0;
  vi.clearAllMocks();
});

describe('Skeleton', () => {
  it('renders an inaccessible themed block sized by its props', () => {
    const rendered = Skeleton({ width: 120, height: 14, radius: 'pill', testID: 'line' });
    expect(rendered.type).toBe('Animated.View');
    expect(rendered.props.accessible).toBe(false);
    expect(rendered.props.importantForAccessibility).toBe('no');
    expect(flatStyle(rendered.props.style)).toMatchObject({
      width: 120,
      height: 14,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceElevated,
    });
    expect(flatStyle(Skeleton({}).props.style)).toMatchObject({ width: '100%', height: 16 });
  });

  it('pulses opacity on the native driver and stops the loop on unmount', () => {
    Skeleton({});
    expect(mocks.effects).toHaveLength(1);
    const cleanup = mocks.effects[0]();
    expect(mocks.timing).toHaveBeenCalledTimes(2);
    for (const call of mocks.timing.mock.calls) {
      expect(call[1]).toMatchObject({ useNativeDriver: true });
    }
    expect(mocks.loop.start).toHaveBeenCalledOnce();
    expect(mocks.loop.stop).not.toHaveBeenCalled();
    (cleanup as () => void)();
    expect(mocks.loop.stop).toHaveBeenCalledOnce();
  });
});

describe('skeleton groups', () => {
  it('labels a list of track-row placeholders as one polite progressbar', () => {
    const rendered = TrackRowSkeleton({ accessibilityLabel: 'Titel werden geladen', count: 3, testID: 'tracks-loading' });
    const root = byTestId(rendered, 'tracks-loading');
    expect(root.props.accessibilityRole).toBe('progressbar');
    expect(root.props.accessibilityLabel).toBe('Titel werden geladen');
    expect(root.props.accessibilityLiveRegion).toBe('polite');
    // artwork + two text lines per row
    expect(byType(rendered, 'Animated.View')).toHaveLength(9);
    expect(TrackRowSkeleton({ accessibilityLabel: 'x' }).props.children).toHaveLength(6);
  });

  it('labels a rail of card placeholders and supports round artwork', () => {
    const rendered = CardRailSkeleton({ accessibilityLabel: 'Alben werden geladen', count: 2, testID: 'albums-loading' });
    const root = byTestId(rendered, 'albums-loading');
    expect(root.props.accessibilityRole).toBe('progressbar');
    expect(root.props.accessibilityLabel).toBe('Alben werden geladen');
    const blocks = byType(rendered, 'Animated.View');
    expect(blocks).toHaveLength(6);
    expect(flatStyle(blocks[0].props.style)).toMatchObject({
      width: layout.artwork.card,
      height: layout.artwork.card,
      borderRadius: radii.card,
    });
    const round = CardRailSkeleton({ accessibilityLabel: 'x', count: 1, size: 96, round: true });
    expect(flatStyle(byType(round, 'Animated.View')[0].props.style)).toMatchObject({
      width: 96,
      borderRadius: radii.pill,
    });
  });
});
