import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId, queryByTestId } from '../../test/render';
import { MINI_PLAYER_MOTION } from './miniPlayerMotion';
import { MiniPlayerPlayGlyph } from './MiniPlayerPlayGlyph';

const harness = vi.hoisted(() => {
  const state = {
    effects: [] as (() => (() => void) | void)[],
    deps: [] as (unknown[] | undefined)[],
    /** The component's one boolean state (`stalled`), kept across renders like React would. */
    stalled: null as boolean | null,
    setStalled: vi.fn((next: boolean) => {
      state.stalled = next;
    }),
    timing: vi.fn((_value: unknown, _config: unknown) => ({ start: vi.fn(), stop: vi.fn() })),
    setValue: vi.fn(),
  };
  return state;
});
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
    harness.effects.push(effect);
    harness.deps.push(deps);
  },
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    if (typeof initial !== 'boolean') return [(initial as () => unknown)(), vi.fn()];
    if (harness.stalled === null) harness.stalled = initial;
    return [harness.stalled, harness.setStalled];
  },
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    Value: class {
      constructor(public value: number) {}
      setValue = harness.setValue;
      interpolate = (config: unknown) => ({ interpolate: config });
    },
    View: 'Animated.View',
    timing: harness.timing,
  },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('MiniPlayerPlayGlyph', () => {
  beforeEach(() => {
    harness.effects = [];
    harness.deps = [];
    harness.stalled = null;
    harness.setStalled.mockClear();
    harness.timing.mockClear();
    harness.setValue.mockClear();
    vi.useRealTimers();
  });

  it('keeps both glyphs mounted and morphs between them on the native driver', () => {
    const rendered = MiniPlayerPlayGlyph({ playing: true, buffering: false, reducedMotion: false });
    expect(byTestId(rendered, 'mini-player-glyph-play')).toBeDefined();
    expect(byTestId(rendered, 'mini-player-glyph-pause')).toBeDefined();
    expect(queryByTestId(rendered, 'mini-player-buffering')).toBeNull();

    harness.effects[0]();
    expect(harness.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      toValue: 1,
      duration: MINI_PLAYER_MOTION.toggleMs,
      useNativeDriver: true,
    }));
  });

  it('maps the morph to the right glyph and re-runs it whenever playing flips', () => {
    const rendered = MiniPlayerPlayGlyph({ playing: false, buffering: false, reducedMotion: false });
    const style = (id: string) => (byTestId(rendered, id).props.style as Record<string, unknown>[])[1];
    // Pause follows the progress value directly; play is its inverse.
    expect((style('mini-player-glyph-pause').opacity as { value: number }).value).toBe(0);
    expect(style('mini-player-glyph-play').opacity).toEqual({
      interpolate: { inputRange: [0, 1], outputRange: [1, 0] },
    });
    expect(harness.deps[0]).toContain(false);
    harness.effects[0]();
    expect(harness.timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 0 }));

    harness.effects = [];
    harness.deps = [];
    MiniPlayerPlayGlyph({ playing: true, buffering: false, reducedMotion: false });
    expect(harness.deps[0]).toContain(true);
    harness.effects[0]();
    expect(harness.timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1 }));
  });

  it('snaps the glyph under reduced motion', () => {
    MiniPlayerPlayGlyph({ playing: false, buffering: false, reducedMotion: true });
    harness.effects[0]();
    expect(harness.timing).not.toHaveBeenCalled();
    expect(harness.setValue).toHaveBeenCalledWith(0);
  });

  it('shows the spinner only once buffering outlasts the delay', () => {
    vi.useFakeTimers();
    const rendered = MiniPlayerPlayGlyph({ playing: true, buffering: true, reducedMotion: false });
    // Mounted mid-stall: `stalled` starts true, so the spinner shows at once.
    expect(byTestId(rendered, 'mini-player-buffering')).toBeDefined();

    harness.effects = [];
    MiniPlayerPlayGlyph({ playing: true, buffering: true, reducedMotion: false });
    const cleanup = harness.effects[1]();
    vi.advanceTimersByTime(MINI_PLAYER_MOTION.spinnerDelayMs - 1);
    expect(harness.setStalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(harness.setStalled).toHaveBeenCalledWith(true);
    if (typeof cleanup !== 'function') throw new Error('buffering effect must clean up');
    cleanup();
    expect(harness.setStalled).toHaveBeenLastCalledWith(false);
  });

  it('keeps the glyph through a short buffering blip and swaps in the spinner only after the delay', () => {
    vi.useFakeTimers();
    const render = (buffering: boolean) => {
      harness.effects = [];
      return MiniPlayerPlayGlyph({ playing: true, buffering, reducedMotion: false });
    };
    expect(queryByTestId(render(false), 'mini-player-buffering')).toBeNull();

    // A skip starts buffering after mount: the glyph stays.
    let rendered = render(true);
    expect(queryByTestId(rendered, 'mini-player-buffering')).toBeNull();
    expect(byTestId(rendered, 'mini-player-glyph-pause')).toBeDefined();
    const cleanup = harness.effects[1]();
    vi.advanceTimersByTime(MINI_PLAYER_MOTION.spinnerDelayMs - 1);
    expect(queryByTestId(render(true), 'mini-player-buffering')).toBeNull();

    // The stall outlasts the delay: now the spinner shows.
    vi.advanceTimersByTime(1);
    expect(byTestId(render(true), 'mini-player-buffering')).toBeDefined();

    // Buffering ends: the glyph returns, and the next blip waits again.
    if (typeof cleanup !== 'function') throw new Error('buffering effect must clean up');
    cleanup();
    rendered = render(false);
    expect(queryByTestId(rendered, 'mini-player-buffering')).toBeNull();
    expect(queryByTestId(render(true), 'mini-player-buffering')).toBeNull();
  });
});
