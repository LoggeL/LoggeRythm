import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import {
  assertSearchRouteCallbacks,
  formatSearchErrorDetail,
  formatSearchDuration,
  isCurrentSearchQuery,
  isSearchableQuery,
  normalizeSearchInput,
  orderedPlaylistTrackIds,
  pickSearchTopResult,
  resultLimit,
  searchPopularityPercent,
  searchTrackCredit,
  scheduleSearchDebounce,
  searchInputReducer,
  SEARCH_DEBOUNCE_MS,
  sortSearchTracks,
  wantedSearchEntities,
  type SearchInputState,
} from './searchModel';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const track = (id: string, title: string, duration: number): Track => ({
  id,
  title,
  artist: 'Artist',
  artist_id: '1',
  artists: [],
  album: 'Album',
  album_id: '9',
  cover: '',
  duration_sec: duration,
  preview_url: null,
  rank: 0,
  release_date: '',
});

describe('search model', () => {
  it('canonicalizes whitespace and enforces the two-character boundary', () => {
    expect(normalizeSearchInput('  daft   punk ')).toBe('daft punk');
    expect(isSearchableQuery(' a ')).toBe(false);
    expect(isSearchableQuery(' ab ')).toBe(true);
    expect(isCurrentSearchQuery('  new   query ', 'new query')).toBe(true);
    expect(isCurrentSearchQuery('new query', 'old query')).toBe(false);
    expect(isCurrentSearchQuery('new query', '')).toBe(false);
  });

  it('debounces the canonical query and cancels a superseded timer', () => {
    vi.useFakeTimers();
    const publish = vi.fn();

    const cancelFirst = scheduleSearchDebounce('  da  ', publish);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(publish).not.toHaveBeenCalled();

    cancelFirst();
    scheduleSearchDebounce('  daft   punk ', publish);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(publish).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith('daft punk');
    vi.runAllTimers();
    expect(publish).toHaveBeenCalledOnce();
  });

  it('keeps a published query active when only whitespace changes', () => {
    let state: SearchInputState = { input: 'daft punk', publishedQuery: 'daft punk' };
    for (const value of ['daft punk ', '  daft   punk ', 'daft punk']) {
      state = searchInputReducer(state, { type: 'edit', value });
      expect(state.input).toBe(value);
      expect(isCurrentSearchQuery(state.input, state.publishedQuery)).toBe(true);
    }
    state = searchInputReducer(state, { type: 'edit', value: 'daft punk live' });
    expect(state.publishedQuery).toBe('');
    expect(isCurrentSearchQuery(state.input, state.publishedQuery)).toBe(false);
  });

  it('publishes a pending debounce after whitespace edits without a replacement timer', () => {
    vi.useFakeTimers();
    let state: SearchInputState = { input: 'daft punk', publishedQuery: '' };
    scheduleSearchDebounce(state.input, (query) => {
      state = searchInputReducer(state, { type: 'publish', query });
    });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    state = searchInputReducer(state, { type: 'edit', value: 'daft punk ' });
    vi.advanceTimersByTime(1);
    expect(state).toEqual({ input: 'daft punk ', publishedQuery: 'daft punk' });
  });

  it('starts an eligible query on keyboard submission and rejects obsolete publication', () => {
    let state: SearchInputState = { input: '  daft   punk ', publishedQuery: '' };
    state = searchInputReducer(state, { type: 'submit' });
    expect(state.publishedQuery).toBe('daft punk');

    state = searchInputReducer(state, { type: 'edit', value: 'new query' });
    state = searchInputReducer(state, { type: 'publish', query: 'daft punk' });
    expect(state.publishedQuery).toBe('');
    state = searchInputReducer(state, { type: 'publish', query: 'new query' });
    expect(state.publishedQuery).toBe('new query');

    state = searchInputReducer(state, { type: 'edit', value: 'a' });
    state = searchInputReducer(state, { type: 'submit' });
    expect(state.publishedQuery).toBe('');

    state = searchInputReducer(state, { type: 'select', query: '  kraft   werk ' });
    expect(state).toEqual({ input: 'kraft werk', publishedQuery: 'kraft werk' });
    state = searchInputReducer(state, { type: 'select', query: 'x' });
    expect(state).toEqual({ input: 'x', publishedQuery: '' });
  });

  it('extracts specific error details without dropping causes', () => {
    expect(formatSearchErrorDetail(new Error('HTTP 503'))).toBe('HTTP 503');
    expect(formatSearchErrorDetail('  timeout  ')).toBe('timeout');
    expect(formatSearchErrorDetail(new Error('   '))).toBeNull();
    expect(formatSearchErrorDetail(null)).toBeNull();
  });

  it('selects only the entity queries needed by a tab', () => {
    expect(wantedSearchEntities('all')).toEqual({ track: true, album: true, artist: true, playlist: true });
    expect(wantedSearchEntities('artist')).toEqual({ track: false, album: false, artist: true, playlist: false });
    expect(resultLimit('all', 'track')).toBe(6);
    expect(resultLimit('track', 'track')).toBeUndefined();
  });

  it('sorts a copy while preserving relevance order', () => {
    const input = [track('1', 'Zulu', 20), track('2', 'Alpha', 10)];
    expect(sortSearchTracks(input, 'relevance', 'de').map((item) => item.id)).toEqual(['1', '2']);
    expect(sortSearchTracks(input, 'title', 'de').map((item) => item.id)).toEqual(['2', '1']);
    expect(sortSearchTracks(input, 'dur-asc', 'de').map((item) => item.id)).toEqual(['2', '1']);
    expect(input.map((item) => item.id)).toEqual(['1', '2']);
  });

  it('keeps the album result limit independent from track sorting', () => {
    expect(resultLimit('all', 'album')).toBe(5);
    expect(resultLimit('album', 'album')).toBeUndefined();
  });

  it('preserves external playlist order and duplicates for strict resolution', () => {
    expect(orderedPlaylistTrackIds([{ id: '2' }, { id: '1' }, { id: '2' }])).toEqual([
      '2', '1', '2',
    ]);
  });

  it('fails loudly without every navigation callback', () => {
    expect(() => assertSearchRouteCallbacks({})).toThrow('SearchScreen requires');
  });

  it.each(['de', 'en'] as const)(
    'threads the active %s locale through title sorting',
    (locale) => {
      const compare = vi.spyOn(String.prototype, 'localeCompare');

      sortSearchTracks([track('1', 'Zulu', 20), track('2', 'Alpha', 10)], 'title', locale);

      expect(compare).toHaveBeenCalledWith('Zulu', locale, { sensitivity: 'base' });

      compare.mockRestore();
    },
  );

  it('formats only evidence-backed search metadata values', () => {
    expect(formatSearchDuration(185.9)).toBe('3:05');
    expect(formatSearchDuration(0)).toBeNull();
    expect(() => formatSearchDuration(Number.NaN)).toThrow('finite non-negative');
    expect(searchPopularityPercent(750_000)).toBe(75);
    expect(searchPopularityPercent(0)).toBeNull();
    expect(searchTrackCredit({ artist: 'Artist', album: 'Album' })).toBe('Artist · Album');
    expect(searchTrackCredit({
      artist: 'Primary',
      artist_id: '1',
      artists: [
        { id: '1', name: 'Primary' },
        { id: '2', name: 'Guest' },
      ],
      album: 'Album',
    })).toBe('Primary, Guest · Album');
  });

  it('promotes the named artist, else the leading track, artist, then album', () => {
    const track = (id: string): Track => ({
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
    });
    const artist = { id: '9', name: 'Kraftwerk', picture: '' };
    const album = { id: '4', title: 'Autobahn', artistName: 'Kraftwerk', artworkUrl: null };
    const tracks = [track('1'), track('2')];

    expect(pickSearchTopResult({ query: '  kraft ', artists: [artist], tracks, albums: [album] }))
      .toEqual({ kind: 'artist', artist });
    expect(pickSearchTopResult({ query: 'autobahn', artists: [artist], tracks, albums: [album] }))
      .toEqual({ kind: 'track', track: tracks[0], index: 0 });
    expect(pickSearchTopResult({ query: 'autobahn', artists: [artist], tracks: [], albums: [album] }))
      .toEqual({ kind: 'artist', artist });
    expect(pickSearchTopResult({ query: 'autobahn', artists: [], tracks: [], albums: [album] }))
      .toEqual({ kind: 'album', album });
    expect(pickSearchTopResult({ query: 'autobahn', artists: [], tracks: [], albums: [] }))
      .toBeNull();
  });

  it('promotes nothing in place of a leading track the library section already shows', () => {
    const artist = { id: '3', name: 'Kraftwerk', picture: '' };
    const album = { id: '4', title: 'Autobahn', artistName: 'Kraftwerk', artworkUrl: null };
    const tracks = [track('1', 'First', 180), track('2', 'Second', 180)];
    const input = { artists: [artist], tracks, albums: [album] };

    expect(pickSearchTopResult({ ...input, query: 'autobahn', libraryTrackIds: new Set(['1']) }))
      .toBeNull();
    // A library track further down does not affect the promoted leading track.
    expect(pickSearchTopResult({ ...input, query: 'autobahn', libraryTrackIds: new Set(['2']) }))
      .toEqual({ kind: 'track', track: tracks[0], index: 0 });
    // An artist the query names still wins over any track.
    expect(pickSearchTopResult({ ...input, query: 'kraft', libraryTrackIds: new Set(['1']) }))
      .toEqual({ kind: 'artist', artist });
  });
});
