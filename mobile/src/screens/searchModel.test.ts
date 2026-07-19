import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import {
  assertSearchRouteCallbacks,
  formatSearchDuration,
  isCurrentSearchQuery,
  isSearchableQuery,
  normalizeSearchInput,
  orderedPlaylistTrackIds,
  resultLimit,
  searchPopularityPercent,
  searchTrackCredit,
  scheduleSearchDebounce,
  SEARCH_DEBOUNCE_MS,
  sortSearchTracks,
  wantedSearchEntities,
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
});
