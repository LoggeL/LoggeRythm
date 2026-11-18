import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Playlist, Track } from '../api/types';
import { queryKeys } from '../data/queryKeys';
import {
  attachDownloadedTrack,
  beginPlaylistDownload,
  createEmptyOfflineManifest,
} from '../offline/model';
import type { OfflineRuntimeSnapshot } from '../offline/registry';
import { useSearchLibrary } from './useSearchLibrary';

const harness = vi.hoisted(() => ({
  client: null as unknown,
  likes: undefined as unknown,
  /** Query state besides `data`; the default is a settled, healthy query. */
  likesState: {} as Record<string, unknown>,
  refetch: (() => undefined) as () => unknown,
  offline: null as unknown,
  queryKeys: [] as unknown[],
}));

// House style: no renderer. The hook's React primitives run once, synchronously.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useMemo: <T,>(create: () => T): T => create(),
  useSyncExternalStore: <T,>(_subscribe: unknown, getSnapshot: () => T): T => getSnapshot(),
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => harness.client,
  useQuery: (options: { queryKey: unknown }) => {
    harness.queryKeys.push(options.queryKey);
    return {
      data: harness.likes,
      error: null,
      isPending: harness.likes === undefined,
      isFetching: false,
      isStale: false,
      fetchStatus: 'idle',
      refetch: harness.refetch,
      ...harness.likesState,
    };
  },
}));
vi.mock('../offline/hooks', () => ({ useOfflineDownloads: () => harness.offline }));
// The data barrel loads the React Native API client; the hook needs two pure pieces.
vi.mock('../data', async () => {
  const { createCachedPlaylistDetailsStore } = await import('../data/playlistCache');
  const keys = (await import('../data/queryKeys')).queryKeys;
  return {
    createCachedPlaylistDetailsStore,
    musicQueries: { likes: (scope: string) => ({ queryKey: keys.library.likes(scope) }) },
  };
});

const scope = 'https://music.test::user:7';

const track = (id: string, title: string, overrides: Partial<Track> = {}): Track => ({
  id,
  title,
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
  ...overrides,
});

const playlist = (id: number, isOwner: boolean, tracks: Track[]): Playlist => ({
  id,
  name: `Playlist ${id}`,
  description: null,
  cover_url: null,
  is_public: false,
  is_owner: isOwner,
  owner_name: null,
  tracks,
});

function offlineSnapshot(downloaded: Track[] = []): OfflineRuntimeSnapshot {
  const source = playlist(4, true, downloaded);
  let manifest = createEmptyOfflineManifest(scope);
  if (downloaded.length > 0) {
    manifest = beginPlaylistDownload(manifest, source, '2026-07-16T12:00:00.000Z');
    for (const item of downloaded) {
      manifest = attachDownloadedTrack(manifest, source.id, item, 4_000, '2026-07-16T12:00:00.000Z');
    }
  }
  return {
    scope,
    hydrated: true,
    manifest,
    directoryUri: null,
    playlists: [],
    trackUris: {},
    downloadedTrackIds: new Set(Object.keys(manifest.tracks)),
    storageBytes: 0,
    availableDiskBytes: null,
    progress: null,
    error: null,
  };
}

const titles = (tracks: readonly Track[]) => tracks.map(({ title }) => title);

beforeEach(() => {
  harness.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  harness.likes = undefined;
  harness.likesState = {};
  harness.refetch = vi.fn(async () => undefined);
  harness.offline = offlineSnapshot();
  harness.queryKeys = [];
});

describe('useSearchLibrary', () => {
  it('matches likes, cached own playlists and downloads once per track, without a request', () => {
    const client = harness.client as QueryClient;
    harness.likes = [track('1', 'Blue Monday'), track('2', 'Something Else')];
    client.setQueryData(
      queryKeys.playlists.detail(scope, 4),
      playlist(4, true, [
        track('1', 'Blue Monday', { playlist_entry_id: 11 }),
        track('3', 'Blue in Green', { playlist_entry_id: 12 }),
      ]),
    );
    client.setQueryData(
      queryKeys.playlists.detail(scope, 5),
      playlist(5, false, [track('4', 'Blue Foreign', { playlist_entry_id: 13 })]),
    );
    harness.offline = offlineSnapshot([track('3', 'Blue in Green'), track('5', 'Blue Train')]);

    const library = useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'all' });

    expect(titles(library.matches)).toEqual(['Blue Monday', 'Blue in Green', 'Blue Train']);
    expect(library.shown).toEqual(library.matches);
    expect([...library.shownIds]).toEqual(['1', '3', '5']);
    expect(library.matches.every((item) => item.playlist_entry_id === undefined)).toBe(true);
    // Only the likes query is observed; playlists are read from the cache.
    expect(harness.queryKeys).toEqual([queryKeys.library.likes(scope)]);
    expect(client.isFetching()).toBe(0);
  });

  it('works from the download manifest alone when no server data is on the device', () => {
    harness.offline = offlineSnapshot([track('5', 'Blue Train')]);

    const library = useSearchLibrary({ accountScope: scope, input: 'train', tab: 'all' });

    expect(titles(library.shown)).toEqual(['Blue Train']);
  });

  it('shows a handful in the all tab while the queue keeps every match', () => {
    harness.likes = Array.from({ length: 8 }, (_, index) => track(String(index + 1), `Blue ${index + 1}`));

    const all = useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'all' });
    expect(all.matches).toHaveLength(8);
    expect(titles(all.shown)).toEqual(['Blue 1', 'Blue 2', 'Blue 3', 'Blue 4', 'Blue 5']);
    expect([...all.shownIds]).toEqual(['1', '2', '3', '4', '5']);

    const tracksTab = useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'track' });
    expect(tracksTab.shown).toHaveLength(8);

    const albums = useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'album' });
    expect(albums.shown).toEqual([]);
    expect(albums.shownIds.size).toBe(0);
  });

  it('reports a failed likes query while other sources keep matching', () => {
    harness.likesState = { error: new Error('500'), isPending: false };
    harness.offline = offlineSnapshot([track('5', 'Blue Train')]);

    const library = useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'all' });

    expect(titles(library.shown)).toEqual(['Blue Train']);
    expect(library.likesIssue).toMatchObject({ kind: 'hard-error', retryBusy: false });
    library.likesIssue?.retry();
    expect(harness.refetch).toHaveBeenCalledOnce();
  });

  it('keeps stale likes searchable when their refresh failed', () => {
    harness.likes = [track('1', 'Blue Monday')];
    harness.likesState = { error: new Error('500'), isFetching: true, fetchStatus: 'fetching' };

    const library = useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'track' });

    expect(titles(library.shown)).toEqual(['Blue Monday']);
    expect(library.likesIssue).toMatchObject({ kind: 'cached-refresh-error', retryBusy: true });
  });

  it('treats a paused likes fetch as offline', () => {
    harness.likesState = { fetchStatus: 'paused' };
    expect(useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'all' }).likesIssue?.kind)
      .toBe('offline');

    harness.likes = [track('1', 'Blue Monday')];
    expect(useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'all' }).likesIssue?.kind)
      .toBe('cached-offline');
  });

  it('stays quiet while likes load, when they are healthy, and in tabs without the section', () => {
    harness.likesState = { isFetching: true, fetchStatus: 'fetching' };
    expect(useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'all' }).likesIssue)
      .toBeNull();

    harness.likes = [track('1', 'Blue Monday')];
    harness.likesState = { isStale: true };
    expect(useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'all' }).likesIssue)
      .toBeNull();

    harness.likes = undefined;
    harness.likesState = { error: new Error('500'), isPending: false };
    expect(useSearchLibrary({ accountScope: scope, input: 'blue', tab: 'album' }).likesIssue)
      .toBeNull();
  });

  it('matches nothing below the minimum length or for another account', () => {
    harness.likes = [track('1', 'Blue Monday')];
    harness.offline = offlineSnapshot([track('5', 'Blue Train')]);

    expect(useSearchLibrary({ accountScope: scope, input: 'b', tab: 'all' }).shown).toEqual([]);
    harness.likes = undefined;
    expect(useSearchLibrary({
      accountScope: 'https://music.test::user:8',
      input: 'blue',
      tab: 'all',
    }).shown).toEqual([]);
  });
});
