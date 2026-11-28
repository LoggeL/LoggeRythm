import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/error';
import type { Track } from '../api/types';
import { createMusicQueryOptions } from '../data/queryOptions';
import { strings } from '../localization';
import { partyErrorDetail } from './partyErrors';
import {
  isPartySearchableQuery,
  PARTY_SEARCH_DEBOUNCE_MS,
  usePartySearch,
  type PartySearchState,
} from './usePartySearch';

const harness = vi.hoisted(() => ({
  client: null as QueryClient | null,
  searchTracks: vi.fn(),
  state: null as PartySearchState | null,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  cleanups: [] as (() => void)[],
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: <T,>(initial: T | (() => T)) => {
    if (harness.state === null) {
      harness.state = (typeof initial === 'function' ? (initial as () => T)() : initial) as PartySearchState;
    }
    const setState = (next: T | ((prev: T) => T)) => {
      harness.state = (
        typeof next === 'function'
          ? (next as (prev: PartySearchState) => PartySearchState)(harness.state!)
          : next
      ) as PartySearchState;
    };
    return [harness.state, setState];
  },
  useRef: <T,>(initial: T) => {
    const index = harness.refIndex++;
    if (!(index in harness.refs)) harness.refs[index] = { current: initial };
    return harness.refs[index];
  },
  useEffect: (effect: () => void | (() => void)) => {
    if (harness.cleanups.length === 0) {
      const cleanup = effect();
      if (typeof cleanup === 'function') harness.cleanups.push(cleanup);
    }
  },
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => harness.client,
}));

vi.mock('../api/client', async () => ({
  ApiError: (await import('../api/error')).ApiError,
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
  const { queryKeys } = await import('../data/queryKeys');
  const { createMusicQueryOptions } = await import('../data/queryOptions');
  const queries = createMusicQueryOptions({
    searchTracks: (...args: unknown[]) => harness.searchTracks(...args),
  } as never);
  return { musicQueries: queries, queryKeys };
});

function sampleTrack(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    artist_id: '1',
    artists: [{ id: '1', name: 'Artist' }],
    album: 'Album',
    album_id: '2',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 0,
    release_date: '',
  };
}

function resetRefCursor() {
  harness.refIndex = 0;
}

function useTestPartySearch(scope = 'https://music.test::user:7') {
  return usePartySearch(scope);
}

describe('party search errors and hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    harness.searchTracks.mockReset();
    harness.state = null;
    harness.refs = [];
    harness.refIndex = 0;
    harness.cleanups = [];
  });

  afterEach(() => {
    for (const cleanup of harness.cleanups) cleanup();
    harness.client?.clear();
    vi.useRealTimers();
  });

  it('formats HTTP 429 rate limits with full unclamped Retry-After seconds', () => {
    const withWait = new ApiError(429, '{"detail":"Deezer rate limit reached."}', '429', {
      retryAfterSeconds: 90,
    });
    expect(partyErrorDetail(withWait)).toBe(strings.search.rateLimitedWait(90));

    const withoutWait = new ApiError(429, '', '429');
    expect(partyErrorDetail(withoutWait)).toBe(strings.search.rateLimited);
  });

  it('enforces 2-char minimum, skips outer-whitespace refires, caches results, and retries immediately', async () => {
    expect(isPartySearchableQuery('a')).toBe(false);
    expect(isPartySearchableQuery('  a  ')).toBe(false);
    expect(isPartySearchableQuery('ab')).toBe(true);

    let callCount = 0;
    harness.searchTracks.mockImplementation(async (query: string) => {
      callCount += 1;
      if (query === 'fail me' && callCount === 2) {
        throw new ApiError(429, '', '429', { retryAfterSeconds: 25 });
      }
      return [sampleTrack(`${query}-${callCount}`)];
    });

    resetRefCursor();
    const [, setQuery] = useTestPartySearch();

    // 1 character must never hit the API.
    setQuery('d');
    await vi.advanceTimersByTimeAsync(PARTY_SEARCH_DEBOUNCE_MS + 50);
    expect(harness.searchTracks).not.toHaveBeenCalled();

    // 2+ characters debounce and fetch once.
    setQuery('Daft Punk');
    await vi.advanceTimersByTimeAsync(PARTY_SEARCH_DEBOUNCE_MS);
    expect(harness.searchTracks).toHaveBeenCalledTimes(1);
    expect(harness.searchTracks).toHaveBeenLastCalledWith('Daft Punk', expect.any(AbortSignal));
    expect(harness.state?.results.map((t) => t.id)).toEqual(['Daft Punk-1']);

    // Trailing/leading whitespace edit must NOT refire.
    resetRefCursor();
    const [, setQuery2] = useTestPartySearch();
    setQuery2('  Daft Punk  ');
    await vi.advanceTimersByTimeAsync(PARTY_SEARCH_DEBOUNCE_MS + 50);
    expect(harness.searchTracks).toHaveBeenCalledTimes(1);

    // Rate-limited search surfaces wait guidance; retry() fires immediately without waiting debounce.
    resetRefCursor();
    const [, setQuery3] = useTestPartySearch();
    setQuery3('fail me');
    await vi.advanceTimersByTimeAsync(PARTY_SEARCH_DEBOUNCE_MS);
    expect(harness.state?.error).toBe(strings.search.rateLimitedWait(25));

    resetRefCursor();
    const [, , retry] = useTestPartySearch();
    retry();
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.searchTracks).toHaveBeenCalledTimes(3);
    expect(harness.state?.error).toBeNull();
    expect(harness.state?.results.map((t) => t.id)).toEqual(['fail me-3']);
  });

  it('cancels superseded in-flight searches and ignores late out-of-order responses', async () => {
    let resolveSlow!: (tracks: Track[]) => void;
    let slowSignal: AbortSignal | undefined;
    harness.searchTracks.mockImplementation((query: string, signal?: AbortSignal) => {
      if (query === 'slow') {
        slowSignal = signal;
        return new Promise<Track[]>((resolve) => { resolveSlow = resolve; });
      }
      return Promise.resolve([sampleTrack('fast')]);
    });

    resetRefCursor();
    const [, setQuery] = useTestPartySearch();
    setQuery('slow');
    await vi.advanceTimersByTimeAsync(PARTY_SEARCH_DEBOUNCE_MS);
    expect(harness.searchTracks).toHaveBeenCalledTimes(1);

    resetRefCursor();
    const [, setQuery2] = useTestPartySearch();
    setQuery2('fast');
    expect(slowSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(PARTY_SEARCH_DEBOUNCE_MS);
    expect(harness.state?.results.map((t) => t.id)).toEqual(['fast']);

    // Late resolution from superseded request must never overwrite newer results.
    resolveSlow([sampleTrack('late-slow')]);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.state?.results.map((t) => t.id)).toEqual(['fast']);
  });

  it('does not cancel a shared search query still observed by another mounted screen', async () => {
    const scope = 'https://music.test::user:7';
    let resolveShared!: (tracks: Track[]) => void;
    let sharedSignal: AbortSignal | undefined;
    harness.searchTracks.mockImplementation((query: string, signal?: AbortSignal) => {
      if (query === 'shared') {
        sharedSignal = signal;
        return new Promise<Track[]>((resolve) => { resolveShared = resolve; });
      }
      return Promise.resolve([sampleTrack('other')]);
    });

    // Simulate SearchScreen mounted in another tab actively observing 'shared'.
    const queries = createMusicQueryOptions({
      searchTracks: (...args: unknown[]) => harness.searchTracks(...args),
    } as never);
    const otherScreenObserver = new QueryObserver(
      harness.client!,
      queries.searchTracks(scope, 'shared'),
    );
    const otherScreenResults: Track[][] = [];
    const unsubscribeOther = otherScreenObserver.subscribe((result) => {
      if (result.data !== undefined) otherScreenResults.push(result.data);
    });

    // PartyScreen also subscribes to 'shared', then types 'other'.
    resetRefCursor();
    const [, setQuery] = useTestPartySearch(scope);
    setQuery('shared');
    await vi.advanceTimersByTimeAsync(PARTY_SEARCH_DEBOUNCE_MS);
    expect(harness.searchTracks).toHaveBeenCalledTimes(1);

    resetRefCursor();
    const [, setQuery2] = useTestPartySearch(scope);
    setQuery2('other');
    // Another screen still observes 'shared', so its AbortSignal MUST remain active.
    expect(sharedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(PARTY_SEARCH_DEBOUNCE_MS);
    expect(harness.state?.results.map((t) => t.id)).toEqual(['other']);

    resolveShared([sampleTrack('shared-ok')]);
    await Promise.resolve();
    await Promise.resolve();
    expect(otherScreenResults.at(-1)?.map((t) => t.id)).toEqual(['shared-ok']);
    expect(harness.state?.results.map((t) => t.id)).toEqual(['other']);

    unsubscribeOther();
  });

  it('clears prior-scope results and allows searching the same query again after scope changes', async () => {
    let callCount = 0;
    harness.searchTracks.mockImplementation(async (query: string) => {
      callCount += 1;
      return [sampleTrack(`${query}-call-${callCount}`)];
    });

    resetRefCursor();
    const [, setQueryA] = useTestPartySearch('https://a.example::user:1');
    setQueryA('Daft Punk');
    await vi.advanceTimersByTimeAsync(PARTY_SEARCH_DEBOUNCE_MS);
    expect(harness.state?.results.map((t) => t.id)).toEqual(['Daft Punk-call-1']);

    // Switch scope (e.g. account/server change): prior-scope results must immediately clear
    // and searching the identical query under the new scope must NOT be blocked by activeTrimmed.
    resetRefCursor();
    const [stateB, setQueryB] = useTestPartySearch('https://b.example::user:2');
    expect(stateB).toEqual({ query: '', results: [], loading: false, error: null });

    setQueryB('  Daft Punk  ');
    await vi.advanceTimersByTimeAsync(PARTY_SEARCH_DEBOUNCE_MS);
    expect(harness.searchTracks).toHaveBeenCalledTimes(2);
    expect(harness.state?.results.map((t) => t.id)).toEqual(['Daft Punk-call-2']);
  });
});
