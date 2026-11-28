import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/error';
import type { Track } from '../../api/types';
import { createMusicQueryOptions } from '../../data/queryOptions';
import { strings } from '../../localization';
import { libraryStrings } from '../../screens/libraryStrings';
import { byTestId, queryByTestId } from '../../test/render';
import {
  formatQuickAddSearchError,
  PlaylistQuickAddSheet,
  QUICK_ADD_SEARCH_DEBOUNCE_MS,
} from './PlaylistQuickAddSheet';

const harness = vi.hoisted(() => ({
  client: null as QueryClient | null,
  searchTracks: vi.fn(),
  stateSlots: [] as unknown[],
  stateCursor: 0,
  refs: [] as { current: unknown }[],
  refCursor: 0,
  effectCleanups: [] as (() => void)[],
  lastEffectDeps: [] as (readonly unknown[] | undefined)[],
  effectCursor: 0,
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
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
  useRef: <T,>(initial: T) => {
    const index = harness.refCursor++;
    if (!(index in harness.refs)) harness.refs[index] = { current: initial };
    return harness.refs[index];
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

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => harness.client,
}));
vi.mock('../../data/repositories', () => ({ musicRepository: {} }));
vi.mock('../../offline/registry', () => ({
  getOfflineSnapshot: () => ({ scope: null }),
  trackIsExplicitlyDownloaded: () => false,
}));
vi.mock('../../offline/lyricsCache', () => ({
  readOfflineLyrics: vi.fn(),
  saveOfflineLyrics: vi.fn(),
}));
vi.mock('../../data', async () => {
  const { isRemoteOffline } = await import('../../data/remoteState');
  const { createMusicQueryOptions: createOptions } = await import('../../data/queryOptions');
  return {
    invalidatePlaylistCaches: vi.fn(),
    isRemoteOffline,
    musicQueries: createOptions({
      searchTracks: (...args: unknown[]) => harness.searchTracks(...args),
    } as never),
    musicRepository: { addToPlaylist: vi.fn() },
    optimisticallyAddPlaylistTrack: vi.fn(),
    restorePlaylistCache: vi.fn(),
  };
});
vi.mock('../ui', () => ({
  AppText: 'AppText',
  Artwork: 'Artwork',
  BottomSheet: 'BottomSheet',
  IconButton: 'IconButton',
}));
vi.mock('./autoBrowse', () => ({ refreshAutoBrowse: vi.fn() }));
vi.mock('./InlineNotice', () => ({ InlineNotice: 'InlineNotice' }));
vi.mock('./useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

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

function renderSheet(visible = true, scope = 'https://music.test::user:7') {
  harness.stateCursor = 0;
  harness.refCursor = 0;
  harness.effectCursor = 0;
  return PlaylistQuickAddSheet({
    visible,
    playlistId: 42,
    scope,
    existingTrackIds: new Set(),
    onClose: vi.fn(),
  });
}

describe('PlaylistQuickAddSheet search error presentation & query behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    harness.searchTracks.mockReset();
    harness.stateSlots = [];
    harness.refs = [];
    harness.effectCleanups = [];
    harness.lastEffectDeps = [];
  });

  afterEach(() => {
    for (const cleanup of harness.effectCleanups) cleanup?.();
    harness.client?.clear();
    vi.useRealTimers();
  });

  it('formats offline, rate-limited (with full Retry-After), and generic errors without leaking raw URLs', () => {
    expect(
      formatQuickAddSearchError(new ApiError(0, '', 'Network request GET https://secret.test/api/search failed')),
    ).toBe(libraryStrings.common.offline);

    expect(
      formatQuickAddSearchError(new ApiError(429, '', 'GET /api/search?q=x returned 429', { retryAfterSeconds: 65 })),
    ).toBe(strings.search.rateLimitedWait(65));

    expect(
      formatQuickAddSearchError(new ApiError(429, '', 'GET /api/search?q=x returned 429')),
    ).toBe(strings.search.rateLimited);

    const generic = formatQuickAddSearchError(
      new ApiError(502, '', 'GET /api/search?q=daft returned 502: internal'),
    );
    expect(generic).toBe(libraryStrings.common.loadFailed);
    expect(generic).not.toContain('/api/search');
  });

  it('restores debounce and cache reuse after an explicit Retry and clears searching when closed', async () => {
    let attempts = 0;
    harness.searchTracks.mockImplementation(async (query: string) => {
      attempts += 1;
      if (query === 'daft' && attempts === 1) {
        throw new ApiError(429, '', '429', { retryAfterSeconds: 10 });
      }
      return [sampleTrack(`${query}-${attempts}`)];
    });

    // Seed cache for 'cached' so subsequent typing proves cache reuse after Retry.
    const scope = 'https://music.test::user:7';
    const queries = createMusicQueryOptions({
      searchTracks: (...args: unknown[]) => harness.searchTracks(...args),
    } as never);
    harness.client!.setQueryData(queries.searchTracks(scope, 'cached').queryKey, [sampleTrack('from-cache')]);

    let tree = renderSheet(true, scope);
    (byTestId(tree, 'playlist-quick-add-input').props.onChangeText as (v: string) => void)('daft');
    tree = renderSheet(true, scope);
    await vi.advanceTimersByTimeAsync(QUICK_ADD_SEARCH_DEBOUNCE_MS);
    tree = renderSheet(true, scope);

    const notice = byTestId(tree, 'playlist-quick-add-error');
    expect(notice.props.message).toBe(strings.search.rateLimitedWait(10));

    // Clicking Retry fires immediately (0ms delay) and recovers.
    const retry = notice.props.retry as { onRetry: () => void };
    retry.onRetry();
    tree = renderSheet(true, scope);
    await Promise.resolve();
    await Promise.resolve();
    tree = renderSheet(true, scope);
    expect(harness.searchTracks).toHaveBeenCalledTimes(2);
    expect(queryByTestId(tree, 'playlist-quick-add-error')).toBeNull();
    expect(byTestId(tree, 'playlist-quick-add-row-daft-2')).toBeDefined();

    // After Retry, typing a NEW query MUST still debounce (NOT fire at 0ms) and reuse cache!
    (byTestId(tree, 'playlist-quick-add-input').props.onChangeText as (v: string) => void)('cached');
    tree = renderSheet(true, scope);
    await vi.advanceTimersByTimeAsync(QUICK_ADD_SEARCH_DEBOUNCE_MS - 1);
    expect(harness.searchTracks).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    tree = renderSheet(true, scope);
    // Served from shared cache with zero extra upstream call!
    expect(harness.searchTracks).toHaveBeenCalledTimes(2);
    expect(byTestId(tree, 'playlist-quick-add-row-from-cache')).toBeDefined();

    // Closing the sheet while a search is in flight resets `searching` cleanly.
    harness.searchTracks.mockImplementationOnce(() => new Promise<Track[]>(() => undefined));
    (byTestId(tree, 'playlist-quick-add-input').props.onChangeText as (v: string) => void)('slow');
    tree = renderSheet(true, scope);
    await vi.advanceTimersByTimeAsync(QUICK_ADD_SEARCH_DEBOUNCE_MS);
    tree = renderSheet(true, scope);
    expect(harness.stateSlots[2]).toBe(true); // searching === true

    tree = renderSheet(false, scope);
    expect(harness.stateSlots[2]).toBe(false); // searching reset when closed
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

    const queries = createMusicQueryOptions({
      searchTracks: (...args: unknown[]) => harness.searchTracks(...args),
    } as never);
    const otherScreenObserver = new QueryObserver(
      harness.client!,
      queries.searchTracks(scope, 'shared'),
    );
    const otherResults: Track[][] = [];
    const unsubscribeOther = otherScreenObserver.subscribe((result) => {
      if (result.data !== undefined) otherResults.push(result.data);
    });

    let tree = renderSheet(true, scope);
    (byTestId(tree, 'playlist-quick-add-input').props.onChangeText as (v: string) => void)('shared');
    tree = renderSheet(true, scope);
    await vi.advanceTimersByTimeAsync(QUICK_ADD_SEARCH_DEBOUNCE_MS);
    expect(harness.searchTracks).toHaveBeenCalledTimes(1);

    // Quick-Add switches to 'other' (or closes); the other screen's observer MUST stay un-aborted.
    (byTestId(tree, 'playlist-quick-add-input').props.onChangeText as (v: string) => void)('other');
    tree = renderSheet(true, scope);
    expect(sharedSignal?.aborted).toBe(false);

    resolveShared([sampleTrack('shared-ok')]);
    await Promise.resolve();
    await Promise.resolve();
    expect(otherResults.at(-1)?.map((t) => t.id)).toEqual(['shared-ok']);

    unsubscribeOther();
  });
});
