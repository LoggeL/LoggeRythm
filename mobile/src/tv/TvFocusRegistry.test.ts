import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTvFocusRegistry,
  resetTvFocusRegistryForTests,
  tvFocusRegistry,
  useTvFocusReturn,
} from './TvFocusRegistry';

const mocks = vi.hoisted(() => ({
  isTv: true,
  refValue: { current: false },
  effects: [] as (() => void)[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: () => mocks.refValue,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useEffect: (effect: () => void) => {
      mocks.effects.push(effect);
    },
  };
});

vi.mock('./tvEnvironment', () => ({
  isTvMode: () => mocks.isTv,
}));

beforeEach(() => {
  resetTvFocusRegistryForTests();
  mocks.isTv = true;
  mocks.refValue = { current: false };
  mocks.effects = [];
});

describe('TvFocusRegistry', () => {
  it('remembers last focused items per scope even after blur', () => {
    const registry = createTvFocusRegistry();
    const homeCard = { requestFocus: vi.fn(), getNodeHandle: () => 101 };
    const searchRow = { requestFocus: vi.fn(), getNodeHandle: () => 202 };

    const unregHome = registry.register('home-mix-3', homeCard, 'home');
    const unregSearch = registry.register('search-track-1', searchRow, 'search');

    registry.recordFocus('home-mix-3');
    expect(registry.getCurrentFocusedKey()).toBe('home-mix-3');
    expect(registry.getLastFocusedKey()).toBe('home-mix-3');
    expect(registry.getLastFocusedKey('home')).toBe('home-mix-3');

    registry.recordBlur('home-mix-3');
    expect(registry.getCurrentFocusedKey()).toBeNull();
    expect(registry.getLastFocusedKey('home')).toBe('home-mix-3');

    registry.recordFocus('search-track-1');
    expect(registry.getLastFocusedKey('search')).toBe('search-track-1');
    expect(registry.getLastFocusedKey('home')).toBe('home-mix-3');
    expect(registry.getNodeHandle('home-mix-3')).toBe(101);
    expect(registry.getNodeHandle('search-track-1')).toBe(202);

    unregHome();
    unregSearch();
    expect(registry.getNodeHandle('home-mix-3')).toBeNull();
  });

  it('delivers deferred focus requests immediately once the target registers', () => {
    const registry = createTvFocusRegistry();
    expect(registry.requestFocus('home-card-7')).toBe(false);

    const requestFocus = vi.fn();
    registry.register('home-card-7', { requestFocus }, 'home');
    expect(requestFocus).toHaveBeenCalledTimes(1);

    // Subsequent immediate request invokes directly and returns true.
    expect(registry.requestFocus('home-card-7')).toBe(true);
    expect(requestFocus).toHaveBeenCalledTimes(2);
  });

  it('supports LIFO focus checkpoints for modal/player/queue round-trips', () => {
    const registry = createTvFocusRegistry();
    const homeTarget = { requestFocus: vi.fn() };
    const nowPlayingTarget = { requestFocus: vi.fn() };
    registry.register('home-album-2', homeTarget, 'home');
    registry.register('player-queue-btn', nowPlayingTarget, 'now-playing');

    registry.recordFocus('home-album-2');
    registry.pushCheckpoint('open-now-playing');

    registry.recordFocus('player-queue-btn');
    registry.pushCheckpoint('open-queue');

    // Leaving Queue returns to NowPlaying button.
    expect(registry.popAndRestore()).toBe('player-queue-btn');
    expect(nowPlayingTarget.requestFocus).toHaveBeenCalledTimes(1);

    // Leaving NowPlaying returns to Home album card.
    expect(registry.popAndRestore()).toBe('home-album-2');
    expect(homeTarget.requestFocus).toHaveBeenCalledTimes(1);

    // Empty checkpoint stack uses fallbackKey cleanly.
    expect(registry.popAndRestore('home-album-2')).toBe('home-album-2');
    expect(homeTarget.requestFocus).toHaveBeenCalledTimes(2);
  });

  it('ignores stale unregister calls after a remount replaces the same key', () => {
    const registry = createTvFocusRegistry();
    const first = { requestFocus: vi.fn() };
    const second = { requestFocus: vi.fn() };

    const unmountFirst = registry.register('tv-nav-home', first, 'tv-nav-rail');
    const unmountSecond = registry.register('tv-nav-home', second, 'tv-nav-rail');

    unmountFirst();
    expect(registry.requestFocus('tv-nav-home')).toBe(true);
    expect(second.requestFocus).toHaveBeenCalledTimes(1);
    expect(first.requestFocus).not.toHaveBeenCalled();

    unmountSecond();
    expect(registry.requestFocus('tv-nav-home', { deferIfUnmounted: false })).toBe(false);
  });

  it('fails loudly on empty focus keys, empty scopes, or invalid targets', () => {
    const registry = createTvFocusRegistry();
    expect(() => registry.register('   ', { requestFocus: vi.fn() })).toThrow(
      /focusKey must be a non-empty string/,
    );
    expect(() => registry.register('item-1', { requestFocus: vi.fn() }, ' ')).toThrow(
      /scope must be a non-empty string/,
    );
    expect(() =>
      registry.register('item-1', {} as unknown as { requestFocus: () => void }),
    ).toThrow(TypeError);
    expect(() => registry.restoreScopeFocus('')).toThrow(/scope must be a non-empty string/);
  });

  it('useTvFocusReturn restores scope focus on becoming active in TV mode and stays inert on phones', () => {
    const target = { requestFocus: vi.fn() };
    tvFocusRegistry.register('library-playlist-4', target, 'library');
    tvFocusRegistry.recordFocus('library-playlist-4', 'library');

    const controls = useTvFocusReturn({
      scope: 'library',
      active: true,
      fallbackKey: 'library-liked',
    });
    expect(controls.lastFocusedKey).toBe('library-playlist-4');
    mocks.effects.forEach((fn) => fn());
    expect(target.requestFocus).toHaveBeenCalledTimes(1);

    // On phones, automatic restoration does not fire.
    mocks.isTv = false;
    mocks.refValue = { current: false };
    mocks.effects = [];
    target.requestFocus.mockClear();

    useTvFocusReturn({ scope: 'library', active: true, fallbackKey: 'library-liked' });
    mocks.effects.forEach((fn) => fn());
    expect(target.requestFocus).not.toHaveBeenCalled();
  });
});
