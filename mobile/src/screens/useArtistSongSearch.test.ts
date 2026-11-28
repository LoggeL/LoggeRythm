import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../data/queryKeys';
import { useArtistSongSearch } from './useArtistSongSearch';

const harness = vi.hoisted(() => ({
  useQueryCalls: [] as { queryKey: unknown; enabled: boolean }[],
  stateSlots: [] as unknown[],
  stateCursor: 0,
  effectCleanups: [] as (() => void)[],
  lastEffectDeps: [] as (readonly unknown[] | undefined)[],
  effectCursor: 0,
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useState: <T,>(initial: T | (() => T)) => {
    const index = harness.stateCursor++;
    if (!(index in harness.stateSlots)) {
      harness.stateSlots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    const setState = (next: T | ((prev: T) => T)) => {
      harness.stateSlots[index] = typeof next === 'function'
        ? (next as (prev: T) => T)(harness.stateSlots[index] as T)
        : next;
    };
    return [harness.stateSlots[index] as T, setState];
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = harness.effectCursor++;
    const previousDeps = harness.lastEffectDeps[index];
    const changed =
      previousDeps === undefined
      || deps === undefined
      || deps.length !== previousDeps.length
      || deps.some((value, i) => !Object.is(value, previousDeps[i]));
    if (changed) {
      harness.effectCleanups[index]?.();
      harness.lastEffectDeps[index] = deps;
      const cleanup = effect();
      harness.effectCleanups[index] = typeof cleanup === 'function' ? cleanup : () => undefined;
    }
  },
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: { queryKey: unknown; enabled: boolean }) => {
    harness.useQueryCalls.push({ queryKey: options.queryKey, enabled: options.enabled });
    return {
      data: undefined,
      error: null,
      isPending: false,
      isFetching: false,
      isStale: false,
      fetchStatus: 'idle',
      refetch: vi.fn(),
    };
  },
}));

vi.mock('../data/repositories', () => ({ musicRepository: {} }));
vi.mock('../offline/registry', () => ({
  getOfflineSnapshot: () => ({ scope: null }),
  trackIsExplicitlyDownloaded: () => false,
}));
vi.mock('../offline/lyricsCache', () => ({
  readOfflineLyrics: vi.fn(),
  saveOfflineLyrics: vi.fn(),
}));
vi.mock('../data', async () => {
  const { createMusicQueryOptions } = await import('../data/queryOptions');
  return {
    musicQueries: createMusicQueryOptions({ searchTracks: vi.fn() } as never),
  };
});

function resetCursors() {
  harness.stateCursor = 0;
  harness.effectCursor = 0;
}

function useTestArtistSongSearch(
  scope = 'https://music.test::user:7',
  artistId = '27',
  artistName = 'Daft Punk',
) {
  return useArtistSongSearch(scope, artistId, artistName);
}

describe('useArtistSongSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.useQueryCalls = [];
    harness.stateSlots = [];
    harness.effectCleanups = [];
    harness.lastEffectDeps = [];
  });

  afterEach(() => {
    for (const cleanup of harness.effectCleanups) cleanup?.();
    vi.useRealTimers();
  });

  it('guards 1-char debounced fetches, allows explicit submit, switches off superseded keys cleanly, and clears immediately', () => {
    const scope = 'https://music.test::user:7';
    resetCursors();
    let hook = useTestArtistSongSearch(scope);
    expect(hook.active).toBe(false);
    expect(hook.enabled).toBe(false);

    // 1-char typing must NOT auto-fire after debounce.
    hook.setInput('X');
    resetCursors();
    hook = useTestArtistSongSearch(scope);
    vi.advanceTimersByTime(400);
    resetCursors();
    hook = useTestArtistSongSearch(scope);
    expect(hook.active).toBe(false);
    expect(hook.enabled).toBe(false);

    // Explicit keyboard submit still allows a 1-char song title search.
    hook.submit();
    resetCursors();
    hook = useTestArtistSongSearch(scope);
    expect(hook.active).toBe(true);
    expect(hook.query).toBe('X');
    expect(harness.useQueryCalls.at(-1)).toEqual({
      queryKey: queryKeys.search.tracks(scope, '"Daft Punk" "X"'),
      enabled: true,
    });

    // Typing a replacement switches the observer off the old key immediately
    // (so TanStack aborts only if sole observer) before debounce fires.
    hook.setInput('Get  Lucky');
    resetCursors();
    hook = useTestArtistSongSearch(scope);
    expect(harness.useQueryCalls.at(-1)).toEqual({
      queryKey: queryKeys.search.tracks(scope, ''),
      enabled: false,
    });

    vi.advanceTimersByTime(300);
    resetCursors();
    hook = useTestArtistSongSearch(scope);
    // Preserves case & internal whitespace (outer trim only).
    expect(hook.query).toBe('Get  Lucky');
    expect(harness.useQueryCalls.at(-1)).toEqual({
      queryKey: queryKeys.search.tracks(scope, '"Daft Punk" "Get  Lucky"'),
      enabled: true,
    });

    // Clearing the field clears active search immediately without waiting 300ms.
    hook.setInput('   ');
    resetCursors();
    hook = useTestArtistSongSearch(scope);
    expect(hook.active).toBe(false);
    expect(harness.useQueryCalls.at(-1)).toEqual({
      queryKey: queryKeys.search.tracks(scope, ''),
      enabled: false,
    });
  });
});
