import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Playlist, PlaylistSummary, Track } from '../api/types';
import { refreshLibraryAutoBrowse } from './autoBrowseRefresh';
import { queryKeys } from './queryKeys';
import {
  createPlaylistWithTrack,
  createPlaylistWithTracks,
  optimisticallyAddPlaylistTrack,
  optimisticallyAddPlaylistTracks,
  optimisticallyRemovePlaylistTrack,
  optimisticallyReorderPlaylistTracks,
  optimisticallyUpdatePlaylist,
  removeDeletedPlaylistFromCache,
  restorePlaylistCache,
  tracksInPlaylistEntryOrder,
} from './playlistCache';

const scope = 'account-7';
const track = (id: string, title = `Track ${id}`, entryId = Number(id)): Track => ({
  id,
  title,
  artist: 'Artist',
  artist_id: 'artist',
  artists: [{ id: 'artist', name: 'Artist' }],
  album: 'Album',
  album_id: 'album',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
  playlist_entry_id: entryId,
});

const summary = (id = 4): PlaylistSummary => ({
  id,
  name: 'Road Trip',
  description: 'Old description',
  cover_url: null,
  track_count: 3,
  is_public: false,
  owner_name: null,
});

const detail = (): Playlist => ({
  ...summary(),
  is_owner: true,
  tracks: [track('1'), track('2'), track('3')],
});

function clientWithPlaylist(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.playlists.detail(scope, 4), detail());
  client.setQueryData(queryKeys.playlists.owned(scope), [summary()]);
  client.setQueryData(queryKeys.playlists.public(scope), [summary()]);
  return client;
}

describe('playlist cache parity contract', () => {
  it('optimistically edits name/description and restores every scoped cache on failure', async () => {
    const client = clientWithPlaylist();
    const snapshot = await optimisticallyUpdatePlaylist(client, scope, 4, {
      name: 'Renamed',
      description: '',
    });

    expect(client.getQueryData<Playlist>(queryKeys.playlists.detail(scope, 4))).toEqual(
      expect.objectContaining({ name: 'Renamed', description: '' }),
    );
    expect(client.getQueryData<PlaylistSummary[]>(queryKeys.playlists.owned(scope))?.[0]).toEqual(
      expect.objectContaining({ name: 'Renamed', description: '' }),
    );

    restorePlaylistCache(client, scope, 4, snapshot);
    expect(client.getQueryData(queryKeys.playlists.detail(scope, 4))).toEqual(detail());
    expect(client.getQueryData(queryKeys.playlists.owned(scope))).toEqual([summary()]);
    expect(client.getQueryData(queryKeys.playlists.public(scope))).toEqual([summary()]);
  });

  it('mutates exact entries while preserving the active queue snapshot', async () => {
    const client = clientWithPlaylist();
    const activeQueue = client.getQueryData<Playlist>(
      queryKeys.playlists.detail(scope, 4),
    )?.tracks;
    expect(activeQueue).toBeDefined();
    await optimisticallyRemovePlaylistTrack(client, scope, 4, 2);
    expect(
      client.getQueryData<Playlist>(queryKeys.playlists.detail(scope, 4))?.tracks.map((item) => item.id),
    ).toEqual(['1', '3']);
    expect(
      client.getQueryData<PlaylistSummary[]>(queryKeys.playlists.owned(scope))?.[0].track_count,
    ).toBe(2);

    const reorderSource = detail();
    const activeReorderedQueue = reorderSource.tracks;
    client.setQueryData(queryKeys.playlists.detail(scope, 4), reorderSource);
    await optimisticallyReorderPlaylistTracks(client, scope, 4, [2, 1, 3]);
    expect(
      client.getQueryData<Playlist>(queryKeys.playlists.detail(scope, 4))?.tracks.map((item) => item.id),
    ).toEqual(['2', '1', '3']);
    expect(detail().tracks.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(activeQueue?.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(activeReorderedQueue.map((item) => item.id)).toEqual(['1', '2', '3']);
  });

  it('orders and removes duplicate catalog IDs by stable entry identity', async () => {
    const first = track('1', 'First occurrence', 101);
    const second = track('1', 'Second occurrence', 102);
    const other = track('2', 'Other', 201);

    expect(tracksInPlaylistEntryOrder([first, second, other], [102, 201, 101])).toEqual([
      second,
      other,
      first,
    ]);
    expect(() => tracksInPlaylistEntryOrder([first, other], [101, 999])).toThrow('unknown entry');

    const client = clientWithPlaylist();
    client.setQueryData(queryKeys.playlists.detail(scope, 4), {
      ...detail(),
      tracks: [first, second, other],
    });
    const removalSnapshot = await optimisticallyRemovePlaylistTrack(client, scope, 4, 102);
    expect(client.getQueryData<Playlist>(
      queryKeys.playlists.detail(scope, 4),
    )?.tracks).toEqual([first, other]);
    restorePlaylistCache(client, scope, 4, removalSnapshot);
    expect(client.getQueryData<Playlist>(
      queryKeys.playlists.detail(scope, 4),
    )?.tracks).toEqual([first, second, other]);

    const reorderSnapshot = await optimisticallyReorderPlaylistTracks(
      client,
      scope,
      4,
      [102, 201, 101],
    );
    expect(client.getQueryData<Playlist>(
      queryKeys.playlists.detail(scope, 4),
    )?.tracks).toEqual([second, other, first]);
    restorePlaylistCache(client, scope, 4, reorderSnapshot);
    expect(client.getQueryData<Playlist>(
      queryKeys.playlists.detail(scope, 4),
    )?.tracks).toEqual([first, second, other]);
  });

  it('optimistically adds an idempotent track and can roll it back exactly', async () => {
    const client = clientWithPlaylist();
    const added = track('4');
    const snapshot = await optimisticallyAddPlaylistTrack(client, scope, 4, added);
    expect(
      client.getQueryData<Playlist>(queryKeys.playlists.detail(scope, 4))?.tracks.map((item) => item.id),
    ).toEqual(['1', '2', '3', '4']);
    expect(
      client.getQueryData<PlaylistSummary[]>(queryKeys.playlists.owned(scope))?.[0].track_count,
    ).toBe(4);

    restorePlaylistCache(client, scope, 4, snapshot);
    expect(client.getQueryData(queryKeys.playlists.detail(scope, 4))).toEqual(detail());
  });

  it('removes a deleted playlist from detail, owned, and public caches', () => {
    const client = clientWithPlaylist();
    removeDeletedPlaylistFromCache(client, scope, 4);
    expect(client.getQueryData(queryKeys.playlists.detail(scope, 4))).toBeUndefined();
    expect(client.getQueryData(queryKeys.playlists.owned(scope))).toEqual([]);
    expect(client.getQueryData(queryKeys.playlists.public(scope))).toEqual([]);
  });

  it('creates then adds a track, compensating with delete when add fails', async () => {
    const created = { ...summary(9), track_count: 0 };
    const createPlaylist = vi.fn(async () => created);
    const addToPlaylist = vi.fn(async () => undefined);
    const deletePlaylist = vi.fn(async () => undefined);

    await expect(
      createPlaylistWithTrack(
        { createPlaylist, addToPlaylist, deletePlaylist },
        { name: 'New', description: null },
        track('7'),
      ),
    ).resolves.toEqual({ ...created, track_count: 1 });
    expect(addToPlaylist).toHaveBeenCalledWith(9, expect.objectContaining({ id: '7' }));
    expect(deletePlaylist).not.toHaveBeenCalled();

    const failure = new Error('add failed');
    addToPlaylist.mockRejectedValueOnce(failure);
    await expect(
      createPlaylistWithTrack(
        { createPlaylist, addToPlaylist, deletePlaylist },
        { name: 'Broken', description: null },
        track('8'),
      ),
    ).rejects.toBe(failure);
    expect(deletePlaylist).toHaveBeenCalledWith(9);
  });

  it('optimistically appends unique imported tracks and rolls back the exact cache', async () => {
    const client = clientWithPlaylist();
    const imported = [track('2'), track('4'), track('4'), track('5')];
    const snapshot = await optimisticallyAddPlaylistTracks(client, scope, 4, imported);
    expect(client.getQueryData<Playlist>(queryKeys.playlists.detail(scope, 4))?.tracks)
      .toHaveLength(5);
    expect(client.getQueryData<PlaylistSummary[]>(queryKeys.playlists.owned(scope))?.[0])
      .toMatchObject({ track_count: 5 });
    restorePlaylistCache(client, scope, 4, snapshot);
    expect(client.getQueryData(queryKeys.playlists.detail(scope, 4))).toEqual(detail());
    expect(client.getQueryData(queryKeys.playlists.owned(scope))).toEqual([summary()]);
  });

  it('does not guess a bulk count when only a playlist summary is cached', async () => {
    const client = clientWithPlaylist();
    client.removeQueries({ queryKey: queryKeys.playlists.detail(scope, 4), exact: true });
    await optimisticallyAddPlaylistTracks(client, scope, 4, [track('2')]);
    expect(client.getQueryData<PlaylistSummary[]>(queryKeys.playlists.owned(scope))?.[0])
      .toMatchObject({ track_count: 3 });
  });

  it('creates then bulk-adds an import and compensates a failed bulk write', async () => {
    const created = { ...summary(12), track_count: 0, cover_url: null };
    const createPlaylist = vi.fn(async () => created);
    const addTracksBulk = vi.fn(async () => ({ added: 2 }));
    const deletePlaylist = vi.fn(async () => undefined);
    const imported = [track('7'), { ...track('8'), cover: 'https://img.test/8.jpg' }];

    await expect(
      createPlaylistWithTracks(
        { createPlaylist, addTracksBulk, deletePlaylist },
        { name: 'Import', description: 'Spotify' },
        imported,
      ),
    ).resolves.toEqual({
      playlist: {
        ...created,
        cover_url: 'https://img.test/8.jpg',
        track_count: 2,
      },
      added: 2,
    });
    expect(addTracksBulk).toHaveBeenCalledWith(12, imported);
    expect(deletePlaylist).not.toHaveBeenCalled();

    const failure = new Error('bulk failed');
    addTracksBulk.mockRejectedValueOnce(failure);
    await expect(
      createPlaylistWithTracks(
        { createPlaylist, addTracksBulk, deletePlaylist },
        { name: 'Broken' },
        imported,
      ),
    ).rejects.toBe(failure);
    expect(deletePlaylist).toHaveBeenCalledWith(12);
  });

  it('does not turn an Android Auto publication error into a mutation failure', async () => {
    const error = new Error('Auto unavailable');
    const onError = vi.fn();
    await expect(
      refreshLibraryAutoBrowse(vi.fn(async () => { throw error; }), onError),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
