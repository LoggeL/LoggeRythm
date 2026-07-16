import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Playlist, Track } from '../api/types';
import { strings } from '../localization';
import {
  attachDownloadedTrack,
  beginPlaylistDownload,
  createEmptyOfflineManifest,
  settlePlaylistDownload,
} from '../offline/model';
import {
  getOfflineSnapshot,
  offlineUriForTrack,
  publishOfflineManifest,
  resetOfflineSnapshot,
} from '../offline/registry';
import {
  BrowseTreePublicationCancelledError,
  buildOfflineDownloadsBrowseCategory,
  clearBrowseTree,
  publishBrowseTree,
  refreshBrowseTree,
  refreshOfflineBrowseTree,
} from './browseTree';

const mocks = vi.hoisted(() => ({
  setBrowseTree: vi.fn(),
  authenticatedHeadersFor: vi.fn(),
  getApiBase: vi.fn(),
  getLikes: vi.fn(),
  getPlaylists: vi.fn(),
  getPlaylist: vi.fn(),
  connectivityStatus: 'unknown' as 'unknown' | 'online' | 'offline',
}));

vi.mock('@rntp/player', () => ({
  default: { setBrowseTree: mocks.setBrowseTree },
}));
vi.mock('../api/client', () => ({
  authenticatedHeadersFor: mocks.authenticatedHeadersFor,
}));
vi.mock('../config', () => ({ getApiBase: mocks.getApiBase }));
vi.mock('../connectivity/store', () => ({
  getConnectivitySnapshot: () => ({ status: mocks.connectivityStatus, showRecovery: false }),
}));
vi.mock('../data/repositories', () => ({
  musicRepository: {
    getLikes: mocks.getLikes,
    getPlaylists: mocks.getPlaylists,
    getPlaylist: mocks.getPlaylist,
  },
}));

const track: Track = {
  id: '3135556',
  title: 'Example',
  artist: 'Artist',
  artist_id: '42',
  artists: [{ id: '42', name: 'Artist' }],
  album: 'Album',
  album_id: '302127',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
};

const offlineScope = 'https://music.example.test::user:7';
const offlineDirectory = `file:///data/user/0/top.logge.loggerythm/no_backup/`
  + `loggerythm_explicit_downloads/v1/scopes/${'a'.repeat(64)}/audio/`;
const offlineTime = '2026-07-16T12:00:00.000Z';

function offlinePlaylist(): Playlist {
  return {
    id: 7,
    name: 'Cold duplicates',
    description: 'Exact source snapshot',
    cover_url: 'https://img.example.test/playlist.jpg',
    is_public: false,
    is_owner: true,
    owner_name: 'Offline owner',
    tracks: [
      { ...track, title: 'First captured title', rank: 1 },
      { ...track, id: '3135557', title: 'Failed occurrence', rank: 2 },
      { ...track, title: 'Repeated captured title', rank: 3 },
    ],
  };
}

function seedPartialOfflinePlaylist(): void {
  const source = offlinePlaylist();
  let manifest = beginPlaylistDownload(
    createEmptyOfflineManifest(offlineScope),
    source,
    offlineTime,
  );
  manifest = attachDownloadedTrack(manifest, source.id, source.tracks[0], 4_096, offlineTime);
  manifest = settlePlaylistDownload(manifest, source, offlineTime, [{
    trackId: '3135557',
    code: 'network-timeout',
    retryable: true,
  }]);
  publishOfflineManifest({
    manifest,
    directoryUri: offlineDirectory,
    trackUris: { [track.id]: `${offlineDirectory}${track.id}.mp3` },
    availableDiskBytes: 1_000_000,
  });
}

function rejectWhenAborted(signal?: AbortSignal): Promise<never> {
  if (!signal) throw new Error('Test expected an AbortSignal');
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error('request was cancelled'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('request was cancelled')), {
      once: true,
    });
  });
}

describe('Android Auto browse-tree publication', () => {
  beforeEach(() => {
    clearBrowseTree();
    resetOfflineSnapshot();
    vi.clearAllMocks();
    mocks.connectivityStatus = 'unknown';
    mocks.getApiBase.mockResolvedValue('https://music.example.test');
    mocks.authenticatedHeadersFor.mockResolvedValue({ Cookie: 'sf_session=test' });
    mocks.getLikes.mockResolvedValue([]);
    mocks.getPlaylists.mockResolvedValue([]);
    mocks.getPlaylist.mockRejectedValue(new Error('getPlaylist should not be called'));
  });

  it('builds exact duplicate offline occurrences without auth, network, or cache claims', () => {
    seedPartialOfflinePlaylist();
    const copy = {
      downloadsTitle: 'Downloads',
      downloadedProgress: (downloaded: number, total: number) =>
        `${downloaded} of ${total} downloaded`,
    };
    const category = buildOfflineDownloadsBrowseCategory(
      getOfflineSnapshot(),
      offlineUriForTrack,
      copy,
    );

    expect(category).toMatchObject({
      mediaId: 'library:downloads',
      title: 'Downloads',
      items: [{
        mediaId: 'download-playlist:7',
        title: 'Cold duplicates',
        artist: '2 of 3 downloaded',
        children: [
          {
            mediaId: `download:7:0:${track.id}`,
            title: 'First captured title',
            url: { uri: `${offlineDirectory}${track.id}.mp3` },
            mimeType: 'audio/mpeg',
            extras: {
              radio: false,
              explicitDownload: true,
              track: expect.objectContaining({ title: 'First captured title', rank: 1 }),
            },
          },
          {
            mediaId: `download:7:2:${track.id}`,
            title: 'Repeated captured title',
            url: { uri: `${offlineDirectory}${track.id}.mp3` },
            extras: {
              radio: false,
              explicitDownload: true,
              track: expect.objectContaining({ title: 'Repeated captured title', rank: 3 }),
            },
          },
        ],
      }],
    });
    expect(category?.items[0].children).toHaveLength(2);
    expect(category?.items[0].children?.some(({ title }) => title === 'Failed occurrence'))
      .toBe(false);
    expect(buildOfflineDownloadsBrowseCategory(
      getOfflineSnapshot(),
      offlineUriForTrack,
      copy,
    )).toEqual(category);
    expect(mocks.getApiBase).not.toHaveBeenCalled();
    expect(mocks.authenticatedHeadersFor).not.toHaveBeenCalled();
    expect(mocks.getLikes).not.toHaveBeenCalled();
    expect(mocks.getPlaylists).not.toHaveBeenCalled();
  });

  it('rejects a cross-account manifest before resolving any local URI', () => {
    seedPartialOfflinePlaylist();
    const snapshot = getOfflineSnapshot();
    const resolver = vi.fn(() => `${offlineDirectory}${track.id}.mp3`);

    expect(buildOfflineDownloadsBrowseCategory(
      { ...snapshot, scope: 'https://music.example.test::user:8' },
      resolver,
      { downloadsTitle: 'Downloads', downloadedProgress: () => 'unreachable' },
    )).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('publishes only verified downloads on known-offline startup without touching auth', async () => {
    seedPartialOfflinePlaylist();
    mocks.connectivityStatus = 'offline';

    await publishBrowseTree();

    expect(mocks.getApiBase).not.toHaveBeenCalled();
    expect(mocks.authenticatedHeadersFor).not.toHaveBeenCalled();
    expect(mocks.getLikes).not.toHaveBeenCalled();
    expect(mocks.getPlaylists).not.toHaveBeenCalled();
    expect(mocks.setBrowseTree).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({
        mediaId: 'library:downloads',
        items: [expect.objectContaining({
          mediaId: 'download-playlist:7',
          children: expect.arrayContaining([
            expect.objectContaining({ url: { uri: `${offlineDirectory}${track.id}.mp3` } }),
          ]),
        })],
      }),
    ]);
  });

  it('keeps remote browse nodes online and adds Downloads without cache mislabeling', async () => {
    seedPartialOfflinePlaylist();
    mocks.connectivityStatus = 'online';
    mocks.getLikes.mockResolvedValueOnce([track]);

    await publishBrowseTree();

    const categories = mocks.setBrowseTree.mock.calls.at(-1)?.[0];
    expect(categories.map(({ mediaId }: { mediaId: string }) => mediaId)).toEqual([
      'library:liked',
      'library:downloads',
    ]);
    expect(categories[0].items[0]).toMatchObject({
      url: {
        uri: `https://music.example.test/api/tracks/${track.id}/stream`,
        headers: { Cookie: 'sf_session=test' },
      },
      extras: { radio: false, track },
    });
    expect(categories[0].items[0].extras.explicitDownload).toBeUndefined();
    expect(categories[1].items[0].children[0].extras.explicitDownload).toBe(true);
  });

  it('refreshes local Downloads without repeating auth or remote repository reads', async () => {
    seedPartialOfflinePlaylist();
    mocks.connectivityStatus = 'online';
    mocks.getLikes.mockResolvedValueOnce([track]);
    await publishBrowseTree();
    const calls = {
      base: mocks.getApiBase.mock.calls.length,
      auth: mocks.authenticatedHeadersFor.mock.calls.length,
      likes: mocks.getLikes.mock.calls.length,
      playlists: mocks.getPlaylists.mock.calls.length,
    };

    await refreshOfflineBrowseTree();

    expect(mocks.getApiBase).toHaveBeenCalledTimes(calls.base);
    expect(mocks.authenticatedHeadersFor).toHaveBeenCalledTimes(calls.auth);
    expect(mocks.getLikes).toHaveBeenCalledTimes(calls.likes);
    expect(mocks.getPlaylists).toHaveBeenCalledTimes(calls.playlists);
    expect(mocks.setBrowseTree.mock.calls.at(-1)?.[0].map(
      ({ mediaId }: { mediaId: string }) => mediaId,
    )).toEqual(['library:liked', 'library:downloads']);
  });

  it('publishes local fallback nodes but still reports an unknown-connectivity remote failure', async () => {
    seedPartialOfflinePlaylist();
    mocks.getLikes.mockRejectedValueOnce(new Error('likes endpoint unavailable'));

    await expect(publishBrowseTree()).rejects.toThrow('likes endpoint unavailable');

    expect(mocks.setBrowseTree).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ mediaId: 'library:downloads' }),
    ]);
  });

  it('rejects a directly cancelled publication with an explicit cancellation type', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(publishBrowseTree(controller.signal)).rejects.toBeInstanceOf(
      BrowseTreePublicationCancelledError,
    );
    expect(mocks.setBrowseTree).not.toHaveBeenCalled();
  });

  it('treats a superseded refresh as expected while the replacement succeeds', async () => {
    mocks.getLikes
      .mockImplementationOnce((signal?: AbortSignal) => rejectWhenAborted(signal))
      .mockResolvedValueOnce([]);
    mocks.getPlaylists
      .mockImplementationOnce((signal?: AbortSignal) => rejectWhenAborted(signal))
      .mockResolvedValueOnce([]);

    const superseded = refreshBrowseTree();
    await vi.waitFor(() => expect(mocks.getLikes).toHaveBeenCalledTimes(1));
    const replacement = refreshBrowseTree();

    await expect(Promise.all([superseded, replacement])).resolves.toEqual([undefined, undefined]);
    expect(mocks.setBrowseTree).toHaveBeenCalledTimes(1);
  });

  it('cancels an old-account publication before deleting the native tree', async () => {
    mocks.getLikes.mockImplementationOnce((signal?: AbortSignal) => rejectWhenAborted(signal));
    mocks.getPlaylists.mockImplementationOnce((signal?: AbortSignal) => rejectWhenAborted(signal));

    const publishing = refreshBrowseTree();
    await vi.waitFor(() => expect(mocks.getLikes).toHaveBeenCalledTimes(1));
    clearBrowseTree();

    await expect(publishing).resolves.toBeUndefined();
    expect(mocks.setBrowseTree).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('still rejects real publication failures', async () => {
    mocks.getLikes.mockRejectedValueOnce(new Error('likes endpoint unavailable'));

    await expect(refreshBrowseTree()).rejects.toThrow('likes endpoint unavailable');
    expect(mocks.setBrowseTree).not.toHaveBeenCalled();
  });

  it('encodes stream path segments before publishing native browse items', async () => {
    mocks.getLikes.mockResolvedValueOnce([{ ...track, id: '12/../private?x=1#fragment' }]);

    await publishBrowseTree();

    const categories = mocks.setBrowseTree.mock.calls.at(-1)?.[0];
    expect(categories?.[0]?.items?.[0]?.url).toEqual({
      uri: 'https://music.example.test/api/tracks/12%2F..%2Fprivate%3Fx%3D1%23fragment/stream',
      headers: { Cookie: 'sf_session=test' },
    });
  });

  it('publishes German-default Android Auto category names', async () => {
    mocks.getLikes.mockResolvedValueOnce([track]);
    mocks.getPlaylists.mockResolvedValueOnce([{ id: 7, name: 'Night Drive' }]);
    mocks.getPlaylist.mockResolvedValueOnce({
      id: 7,
      name: 'Night Drive',
      description: null,
      is_public: false,
      is_owner: true,
      tracks: [track],
    });

    await publishBrowseTree();

    const categories = mocks.setBrowseTree.mock.calls.at(-1)?.[0];
    expect(categories?.map((category: { title: string }) => category.title)).toEqual([
      strings.player.autoLikedSongs,
      strings.player.autoPlaylists,
    ]);
    expect(categories?.[0]).toMatchObject({
      mediaId: 'library:liked',
      items: [
        {
          mediaId: `liked:0:${track.id}`,
          title: track.title,
          artist: track.artist,
          extras: { radio: false, track },
        },
      ],
    });
    expect(categories?.[1]).toMatchObject({
      mediaId: 'library:playlists',
      items: [
        {
          mediaId: 'playlist:7',
          title: 'Night Drive',
          children: [
            {
              mediaId: `playlist:7:0:${track.id}`,
              title: track.title,
              artist: track.artist,
              extras: { radio: false, track },
            },
          ],
        },
      ],
    });
  });

  it('forwards one publication cancellation signal through every repository read', async () => {
    const controller = new AbortController();
    mocks.getPlaylists.mockResolvedValueOnce([{ id: 7, name: 'Night Drive' }]);
    mocks.getPlaylist.mockResolvedValueOnce({
      id: 7,
      name: 'Night Drive',
      description: null,
      is_public: false,
      is_owner: true,
      tracks: [],
    });

    await publishBrowseTree(controller.signal);

    expect(mocks.getLikes).toHaveBeenCalledWith(controller.signal);
    expect(mocks.getPlaylists).toHaveBeenCalledWith(controller.signal);
    expect(mocks.getPlaylist).toHaveBeenCalledWith(7, controller.signal);
  });
});
