import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId, byType, flatStyle } from '../../test/render';
import { colors, layout, metrics, radii } from '../../theme';
import {
  CardRailSkeleton,
  DetailHeroSkeleton,
  resetSkeletonClockForTests,
  Skeleton,
  TrackRowSkeleton,
} from './Skeleton';

const mocks = vi.hoisted(() => {
  const loop = { start: vi.fn(), stop: vi.fn() };
  return {
    loop,
    reducedMotion: false,
    effects: [] as (() => void | (() => void))[],
    setValue: vi.fn(),
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
    useEffect: (effect: () => void | (() => void)) => {
      mocks.effects.push(effect);
    },
  };
});
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mocks.reducedMotion,
}));
vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      setValue = mocks.setValue;
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
  resetSkeletonClockForTests();
  mocks.reducedMotion = false;
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

  it('shares a single native-driver pulse loop across many mounted skeletons and stops when the last unmounts', () => {
    const first = Skeleton({});
    const second = Skeleton({});
    const third = Skeleton({});
    expect(flatStyle(first.props.style).opacity).toBe(flatStyle(second.props.style).opacity);
    expect(flatStyle(second.props.style).opacity).toBe(flatStyle(third.props.style).opacity);
    expect(mocks.effects).toHaveLength(3);

    const cleanup1 = mocks.effects[0]() as () => void;
    const cleanup2 = mocks.effects[1]() as () => void;
    const cleanup3 = mocks.effects[2]() as () => void;

    // All three share ONE loop instead of spawning 3 loops.
    expect(mocks.loopFactory).toHaveBeenCalledOnce();
    expect(mocks.loop.start).toHaveBeenCalledOnce();
    expect(mocks.timing).toHaveBeenCalledTimes(2);
    for (const call of mocks.timing.mock.calls) {
      expect(call[1]).toMatchObject({ useNativeDriver: true });
    }

    cleanup1();
    cleanup2();
    expect(mocks.loop.stop).not.toHaveBeenCalled();

    cleanup3();
    expect(mocks.loop.stop).toHaveBeenCalledOnce();
  });

  it('uses static opacity and starts no animation loop when reduced motion is enabled', () => {
    mocks.reducedMotion = true;
    const rendered = Skeleton({ width: 100, height: 16 });
    expect(typeof flatStyle(rendered.props.style).opacity).toBe('number');
    expect(mocks.effects[0]()).toBeUndefined();
    expect(mocks.loopFactory).not.toHaveBeenCalled();
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

  it('labels a rail of card placeholders and supports round, track, genre, and playlist variants', () => {
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

    const trackRail = CardRailSkeleton({ accessibilityLabel: 'x', count: 1, variant: 'track' });
    // artwork + 2 copy lines + 2 action circles
    expect(byType(trackRail, 'Animated.View')).toHaveLength(5);

    const genreRail = CardRailSkeleton({ accessibilityLabel: 'x', count: 2, variant: 'genre' });
    const genreBlocks = byType(genreRail, 'Animated.View');
    expect(genreBlocks).toHaveLength(2);
    expect(flatStyle(genreBlocks[0].props.style)).toMatchObject({
      width: layout.artwork.card,
      height: layout.artwork.lg,
    });

    const playlistRail = CardRailSkeleton({ accessibilityLabel: 'x', count: 1, variant: 'playlist' });
    const playlistBlocks = byType(playlistRail, 'Animated.View');
    expect(playlistBlocks).toHaveLength(4);
    expect(flatStyle(playlistBlocks[0].props.style)).toMatchObject({
      width: layout.artwork.lg,
      height: layout.artwork.lg,
    });
  });

  it('renders full and compact DetailHeroSkeletons with 64dp PlayButton action space', () => {
    const full = DetailHeroSkeleton({ testID: 'hero-full' });
    const fullBlocks = byType(full, 'Animated.View');
    expect(flatStyle(fullBlocks[0].props.style)).toMatchObject({
      width: layout.artwork.hero,
      height: layout.artwork.hero,
    });
    expect(
      fullBlocks.some((block) => flatStyle(block.props.style).height === 64),
    ).toBe(true);
    expect(
      fullBlocks.some((block) => flatStyle(block.props.style).height === metrics.minimumTouchTarget),
    ).toBe(true);

    const compact = DetailHeroSkeleton({ testID: 'hero-compact', compact: true });
    const compactBlocks = byType(compact, 'Animated.View');
    expect(flatStyle(compactBlocks[0].props.style)).toMatchObject({
      width: layout.artwork.lg,
      height: layout.artwork.lg,
    });
    expect(
      compactBlocks.some((block) => flatStyle(block.props.style).height === 64),
    ).toBe(true);
  });
});
