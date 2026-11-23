import { describe, expect, it } from 'vitest';
import type { PlaylistSummary } from '../api/types';
import type { CatalogQueryVisualState } from '../components/catalog/catalogQueryState';
import { resolveRemoteVisualState } from '../data/remoteState';
import {
  combineCatalogQueryStates,
  mergeDiscoverPlaylists,
  resolveDiscoverPlaylistsSection,
  type DiscoverPlaylistSourceQuery,
} from './discoverPlaylistsModel';

const playlist = (id: number, overrides: Partial<PlaylistSummary> = {}): PlaylistSummary => ({
  id,
  name: `Playlist ${id}`,
  description: null,
  cover_url: null,
  is_public: true,
  track_count: 3,
  owner_name: null,
  ...overrides,
});

const loaded: CatalogQueryVisualState = {
  hasData: true,
  isPending: false,
  isFetching: false,
  isStale: false,
  fetchStatus: 'idle',
  error: null,
};
const firstLoad: CatalogQueryVisualState = {
  ...loaded,
  hasData: false,
  isPending: true,
  isFetching: true,
  fetchStatus: 'fetching',
};

function body(state: CatalogQueryVisualState, empty = false) {
  return resolveRemoteVisualState({
    hasData: state.hasData,
    empty,
    pending: state.isPending,
    fetching: state.isFetching,
    stale: state.isStale,
    fetchStatus: state.fetchStatus,
    error: state.error,
  });
}

describe('mergeDiscoverPlaylists', () => {
  it('lists own playlists first, private ones included, then the community', () => {
    const own = [playlist(7, { is_public: false }), playlist(3)];
    const community = [playlist(11, { owner_name: 'Sam' }), playlist(5, { owner_name: 'Kim' })];

    const merged = mergeDiscoverPlaylists(own, community);

    expect(merged.map((entry) => [entry.playlist.id, entry.own])).toEqual([
      [7, true],
      [3, true],
      [11, false],
      [5, false],
    ]);
    expect(merged[0].playlist).toBe(own[0]);
    expect(merged[2].playlist).toBe(community[0]);
  });

  it('shows a playlist both lists carry once, as the own one', () => {
    const own = [playlist(3)];
    const community = [playlist(3, { owner_name: 'Logge' }), playlist(9, { owner_name: 'Sam' })];

    const merged = mergeDiscoverPlaylists(own, community);

    expect(merged.map((entry) => [entry.playlist.id, entry.own])).toEqual([
      [3, true],
      [9, false],
    ]);
    expect(merged[0].playlist).toBe(own[0]);
  });

  it('returns only the side that has playlists and nothing for two empty lists', () => {
    expect(mergeDiscoverPlaylists([playlist(1)], [])).toEqual([
      { playlist: playlist(1), own: true },
    ]);
    expect(mergeDiscoverPlaylists([], [playlist(2)])).toEqual([
      { playlist: playlist(2), own: false },
    ]);
    expect(mergeDiscoverPlaylists([], [])).toEqual([]);
  });

  it('rejects a list that repeats a playlist instead of hiding the repeat', () => {
    expect(() => mergeDiscoverPlaylists([playlist(4), playlist(4)], [])).toThrow(
      'Own playlists list playlist 4 more than once',
    );
    expect(() => mergeDiscoverPlaylists([], [playlist(6), playlist(6)])).toThrow(
      'Community playlists list playlist 6 more than once',
    );
  });
});

describe('combineCatalogQueryStates', () => {
  it('is settled content only when every query has loaded', () => {
    expect(combineCatalogQueryStates([loaded, loaded])).toEqual(loaded);
    expect(body(combineCatalogQueryStates([loaded, loaded]))).toEqual({
      body: 'content',
      notice: null,
    });
  });

  it('keeps loading while one query is still on its first load', () => {
    const combined = combineCatalogQueryStates([loaded, firstLoad]);

    expect(combined.hasData).toBe(false);
    expect(combined.isPending).toBe(true);
    expect(combined.fetchStatus).toBe('fetching');
    expect(body(combined).body).toBe('loading');
  });

  it('blocks with the error of a failed query instead of showing the other half', () => {
    const error = new Error('GET /api/playlists/public: HTTP 503');
    const failed: CatalogQueryVisualState = { ...loaded, hasData: false, error };

    for (const states of [[loaded, failed], [failed, loaded]]) {
      const combined = combineCatalogQueryStates(states);
      expect(combined.error).toBe(error);
      expect(body(combined)).toEqual({ body: 'hard-error', notice: null });
    }
  });

  it('keeps the merged row with a refresh-error notice when cached data exists', () => {
    const error = new Error('GET /api/playlists: HTTP 500');
    const combined = combineCatalogQueryStates([{ ...loaded, error }, loaded]);

    expect(body(combined)).toEqual({ body: 'content', notice: 'cached-refresh-error' });
  });

  it('reports an offline pause of either query', () => {
    const paused: CatalogQueryVisualState = {
      ...loaded,
      hasData: false,
      isPending: true,
      fetchStatus: 'paused',
    };
    const combined = combineCatalogQueryStates([loaded, paused]);

    expect(combined.fetchStatus).toBe('paused');
    expect(body(combined).body).toBe('offline');
  });

  it('marks a background refresh or stale data of either query', () => {
    const refreshing = combineCatalogQueryStates([
      loaded,
      { ...loaded, isFetching: true, fetchStatus: 'fetching' },
    ]);
    expect(body(refreshing).notice).toBe('refreshing');
    expect(body(combineCatalogQueryStates([{ ...loaded, isStale: true }, loaded])).notice).toBe(
      'stale',
    );
  });

  it('refuses to combine nothing', () => {
    expect(() => combineCatalogQueryStates([])).toThrow('at least one query');
  });
});

describe('resolveDiscoverPlaylistsSection (decoupled own vs community)', () => {
  const source = (
    data: PlaylistSummary[] | undefined,
    overrides: Partial<DiscoverPlaylistSourceQuery> = {},
  ): DiscoverPlaylistSourceQuery => ({
    data,
    isPending: data === undefined,
    isFetching: data === undefined,
    isStale: false,
    fetchStatus: data === undefined ? 'fetching' : 'idle',
    error: null,
    ...overrides,
  });

  it('shows own playlists immediately while community playlists are still loading', () => {
    const own = [playlist(7, { is_public: false })];
    const resolved = resolveDiscoverPlaylistsSection(source(own), source(undefined));

    expect(resolved.entries).toEqual([{ playlist: own[0], own: true }]);
    expect(resolved.empty).toBe(false);
    expect(body(resolved.state, resolved.empty)).toEqual({
      body: 'content',
      notice: 'refreshing',
    });
  });

  it('shows community playlists immediately while own playlists are still loading', () => {
    const community = [playlist(11, { owner_name: 'Sam' })];
    const resolved = resolveDiscoverPlaylistsSection(source(undefined), source(community));

    expect(resolved.entries).toEqual([{ playlist: community[0], own: false }]);
    expect(body(resolved.state, resolved.empty)).toEqual({
      body: 'content',
      notice: 'refreshing',
    });
  });

  it('keeps loading instead of showing a false empty state when one list is empty and the other is pending', () => {
    const resolved = resolveDiscoverPlaylistsSection(source([]), source(undefined));

    expect(resolved.entries).toEqual([]);
    expect(resolved.empty).toBe(false);
    expect(body(resolved.state, resolved.empty)).toEqual({
      body: 'loading',
      notice: null,
    });
  });

  it('keeps loaded playlists usable while surfacing the other list failure loudly', () => {
    const own = [playlist(7)];
    const failure = new Error('GET /api/playlists/public: HTTP 503');
    const resolved = resolveDiscoverPlaylistsSection(
      source(own),
      source(undefined, { isPending: false, isFetching: false, fetchStatus: 'idle', error: failure }),
    );

    expect(resolved.entries).toEqual([{ playlist: own[0], own: true }]);
    expect(resolved.state.error).toBe(failure);
    expect(body(resolved.state, resolved.empty)).toEqual({
      body: 'content',
      notice: 'cached-refresh-error',
    });
  });

  it('blocks with hard-error when one list is empty and the other fails', () => {
    const failure = new Error('GET /api/playlists/public: HTTP 503');
    const resolved = resolveDiscoverPlaylistsSection(
      source([]),
      source(undefined, { isPending: false, isFetching: false, fetchStatus: 'idle', error: failure }),
    );

    expect(body(resolved.state, resolved.empty)).toEqual({
      body: 'hard-error',
      notice: null,
    });
  });

  it('reports empty only once both lists have resolved with zero playlists', () => {
    const resolved = resolveDiscoverPlaylistsSection(source([]), source([]));
    expect(resolved.empty).toBe(true);
    expect(body(resolved.state, resolved.empty)).toEqual({
      body: 'empty',
      notice: null,
    });
  });
});
