import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import { useSearchResults } from './useSearchResults';

const harness = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  requests: [] as { name: string; args: unknown[] }[],
}));

// House style: no renderer. Memoized values are computed once, synchronously.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useMemo: <T,>(create: () => T): T => create(),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: [string]; enabled: boolean }) => {
    const data = options.enabled ? harness.data.get(options.queryKey[0]) : undefined;
    return {
      data,
      error: null,
      isPending: data === undefined,
      isFetching: false,
      isStale: false,
      fetchStatus: 'idle',
      refetch: vi.fn(async () => undefined),
    };
  },
}));
vi.mock('../data', () => {
  const query = (name: string) => (...args: unknown[]) => {
    harness.requests.push({ name, args });
    return { queryKey: [name] };
  };
  return {
    musicQueries: {
      searchTracks: query('searchTracks'),
      searchAlbums: query('searchAlbums'),
      searchArtists: query('searchArtists'),
      searchPlaylists: query('searchPlaylists'),
      trackPlayCounts: query('trackPlayCounts'),
      cachedTrackIds: query('cachedTrackIds'),
    },
  };
});

const track = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  artist_id: '1',
  artists: [{ id: '1', name: 'Artist' }],
  album: 'Album',
  album_id: '9',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
});

const ids = (tracks: readonly Track[]) => tracks.map(({ id }) => id);
const found = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(track);

function useSearch(libraryTrackIds: ReadonlySet<string>, tab: 'all' | 'track' = 'all') {
  return useSearchResults({
    accountScope: 'https://music.test::user:7',
    query: 'track',
    ready: true,
    tab,
    sort: 'relevance',
    locale: 'de',
    libraryTrackIds,
  });
}

beforeEach(() => {
  harness.data.clear();
  harness.requests = [];
  harness.data.set('searchTracks', found);
  harness.data.set('searchAlbums', []);
  harness.data.set('searchArtists', []);
  harness.data.set('searchPlaylists', []);
});

describe('useSearchResults library dedupe', () => {
  it('leaves the remote track list untouched without library matches', () => {
    const results = useSearch(new Set());

    expect(ids(results.foundTracks)).toEqual(ids(found));
    expect(ids(results.tracks)).toEqual(ids(found));
    expect(ids(results.shownTracks)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('removes tracks the library section shows and keeps the remaining order', () => {
    const results = useSearch(new Set(['1', '4']));

    // `tracks` is the queue: play(index) and occurrence indices address it.
    expect(ids(results.tracks)).toEqual(['2', '3', '5', '6', '7', '8', '9']);
    // The all-tab preview is filled from the remaining tracks, not shortened.
    expect(ids(results.shownTracks)).toEqual(['2', '3', '5', '6', '7', '8']);
    expect(results.shownTracks.every((item, index) => results.tracks[index] === item)).toBe(true);
    // The backend order stays available for the top-result decision.
    expect(ids(results.foundTracks)).toEqual(ids(found));
  });

  it('requests play counts only for the remote rows that are shown', () => {
    useSearch(new Set(['1']));

    const request = harness.requests.find(({ name }) => name === 'trackPlayCounts');
    expect((request?.args[0] as { id: string }[]).map(({ id }) => id))
      .toEqual(['2', '3', '4', '5', '6', '7']);
  });

  it('does not report an empty search when every found track is in the library section', () => {
    harness.data.set('searchTracks', [track('1'), track('2')]);

    const results = useSearch(new Set(['1', '2']), 'track');

    expect(results.tracks).toEqual([]);
    expect(results.state.body).toBe('content');
    expect(results.state.resultCount).toBe(2);
  });

  it('still reports an empty search when nothing was found at all', () => {
    harness.data.set('searchTracks', []);

    expect(useSearch(new Set(['1']), 'track').state.body).toBe('empty');
  });
});
