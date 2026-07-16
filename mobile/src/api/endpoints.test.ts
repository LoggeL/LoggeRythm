import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from './types';
import {
  addToPlaylist,
  addTracksBulk,
  approveAdminUser,
  cleanupAdminStorage,
  createAdminInvite,
  createParty,
  createPlaylist,
  deleteAdminUser,
  deletePlaylist,
  getAdminInvites,
  getAdminStatus,
  getAdminStorage,
  getAdminUsers,
  getAlbum,
  getCachedTrackIds,
  getDeezerPlaylist,
  getLyrics,
  getPlaylist,
  getPublicPlaylists,
  getRadio,
  searchAlbums,
  getTrack,
  getTrackPlayCounts,
  joinParty,
  leaveParty,
  likeTrack,
  likesContains,
  logout,
  partyAddTrack,
  partyRemoveTrack,
  partyReorder,
  partySetCurrent,
  partySetPlayback,
  preloadTrack,
  register,
  removeFromPlaylist,
  removePlaylistEntry,
  reorderPlaylistEntries,
  reorderPlaylistTracks,
  resolveExternalUrl,
  setPlaylistVisibility,
  unlikeTrack,
  updatePlaylist,
} from './endpoints';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./client', () => ({ apiRequest: mocks.apiRequest }));

describe('API endpoint URL construction', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue(undefined);
  });

  it.each([
    ['track metadata', () => getTrack('12/../admin?x=1#fragment'), '/api/tracks/12%2F..%2Fadmin%3Fx%3D1%23fragment'],
    ['album metadata', () => getAlbum('12/../admin?x=1#fragment'), '/api/albums/12%2F..%2Fadmin%3Fx%3D1%23fragment'],
    ['radio', () => getRadio('12/../admin?x=1#fragment'), '/api/radio/12%2F..%2Fadmin%3Fx%3D1%23fragment'],
    ['unlike', () => unlikeTrack('12/../admin?x=1#fragment'), '/api/me/likes/12%2F..%2Fadmin%3Fx%3D1%23fragment'],
  ])('encodes the dynamic path segment for %s', (_label, request, expectedPath) => {
    request();
    expect(mocks.apiRequest).toHaveBeenCalledWith(expectedPath, expect.any(Object));
  });

  it('encodes the track id used by the like endpoint', () => {
    const track = { id: '12/../admin?x=1#fragment' } as Track;
    likeTrack(track);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/me/likes/12%2F..%2Fadmin%3Fx%3D1%23fragment',
      { method: 'PUT', body: track },
    );
  });

  it('encodes playlist ids through the same path-segment boundary', () => {
    getPlaylist(42);
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/playlists/42', expect.any(Object));
  });

  it('encodes the complete comma-separated likes query value', () => {
    likesContains(['12', '34']);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/me/likes/contains?ids=12%2C34',
      expect.any(Object),
    );
  });
});

describe('registration endpoint', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  it('posts the exact backend body and captures the new session like login', async () => {
    const request = {
      email: 'person@example.test',
      password: 'correct horse battery staple',
      display_name: 'Person',
      invite: 'invite-code',
    };
    const user = {
      id: 7,
      email: request.email,
      display_name: request.display_name,
      is_admin: false,
      is_approved: true,
      avatar_url: null,
    };
    mocks.apiRequest.mockResolvedValueOnce(user);

    await expect(register(request)).resolves.toBe(user);
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/auth/register', {
      method: 'POST',
      body: request,
      captureSession: true,
      noAuth: true,
      decode: expect.any(Function),
    });
  });

  it('includes explicit nulls for optional backend fields', () => {
    const request = {
      email: 'person@example.test',
      password: 'password',
      display_name: null,
      invite: null,
    };

    register(request);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({ body: request }),
    );
  });
});

describe('logout endpoint', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue({ ok: true });
  });

  it('uses a bounded unauthenticated consistency call after local logout', async () => {
    await logout();
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      decode: expect.any(Function),
      noAuth: true,
      timeoutMs: 2_000,
    });
  });
});

describe('web-parity endpoint contracts', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue(undefined);
  });

  it('constructs every playlist CRUD body and encoded membership path', () => {
    const track = { id: '12', title: 'Song' };
    getPublicPlaylists();
    createPlaylist({ name: 'Mix', description: null });
    updatePlaylist(7, { name: 'Renamed' });
    deletePlaylist(7);
    addToPlaylist(7, track);
    removeFromPlaylist(7, '12/../34');
    reorderPlaylistTracks(7, ['34', '12']);
    addTracksBulk(7, [track]);
    setPlaylistVisibility(7, true);

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/playlists/public',
      expect.objectContaining({ decode: expect.any(Function) }),
    );
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, '/api/playlists', {
      method: 'POST',
      body: { name: 'Mix', description: null },
      decode: expect.any(Function),
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(3, '/api/playlists/7', {
      method: 'PATCH',
      body: { name: 'Renamed' },
      decode: expect.any(Function),
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(4, '/api/playlists/7', {
      method: 'DELETE',
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(5, '/api/playlists/7/tracks', {
      method: 'POST',
      body: track,
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      6,
      '/api/playlists/7/tracks/12%2F..%2F34',
      { method: 'DELETE' },
    );
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(7, '/api/playlists/7/tracks/order', {
      method: 'PATCH',
      body: { deezer_ids: ['34', '12'] },
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(8, '/api/playlists/7/tracks/bulk', {
      method: 'POST',
      body: [track],
      decode: expect.any(Function),
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(9, '/api/playlists/7/visibility', {
      method: 'PATCH',
      body: { is_public: true },
      decode: expect.any(Function),
    });
  });

  it('uses stable playlist-entry paths without removing the legacy contract', () => {
    removePlaylistEntry(7, 91);
    reorderPlaylistEntries(7, [92, 91]);

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/playlists/7/tracks/entries/91',
      { method: 'DELETE' },
    );
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/playlists/7/tracks/entries/order',
      { method: 'PATCH', body: { entry_ids: [92, 91] } },
    );
  });

  it('routes album search through the generated operation descriptor', () => {
    const signal = new AbortController().signal;
    searchAlbums('AC/DC & Friends', signal);

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/search?q=AC%2FDC%20%26%20Friends&type=album',
      expect.objectContaining({
        method: 'GET',
        noAuth: true,
        signal,
        successStatuses: [200],
        decode: expect.any(Function),
      }),
    );
  });

  it('encodes resolve, lyrics, import, cache, preload, and play-count requests', () => {
    resolveExternalUrl('https://example.test/list?a=1&b=2');
    getDeezerPlaylist('12/../34');
    getLyrics('AC/DC', 'One & Two', '12');
    getCachedTrackIds();
    preloadTrack('12/../34');
    getTrackPlayCounts([{ id: '12', artist: 'AC/DC', title: 'One & Two' }]);

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/resolve?url=https%3A%2F%2Fexample.test%2Flist%3Fa%3D1%26b%3D2',
      expect.objectContaining({
        decode: expect.any(Function),
        signal: undefined,
        timeoutMs: 120_000,
      }),
    );
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/deezer-playlist/12%2F..%2F34',
      expect.objectContaining({ decode: expect.any(Function) }),
    );
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      3,
      '/api/lyrics?artist=AC%2FDC&title=One%20%26%20Two&deezer_id=12',
      expect.objectContaining({ decode: expect.any(Function) }),
    );
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      4,
      '/api/cached-tracks',
      expect.objectContaining({ decode: expect.any(Function) }),
    );
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(5, '/api/tracks/12%2F..%2F34/preload', {
      method: 'POST',
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(6, '/api/track-plays', {
      method: 'POST',
      body: { tracks: [{ id: '12', artist: 'AC/DC', title: 'One & Two' }] },
      signal: undefined,
      decode: expect.any(Function),
    });
  });

  it('forwards an optional cancellation signal and bounded preload timeout', () => {
    const controller = new AbortController();
    preloadTrack('12', { signal: controller.signal, timeoutMs: 900 });

    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/tracks/12/preload', {
      method: 'POST',
      signal: controller.signal,
      timeoutMs: 900,
    });
  });

  it('constructs encoded party REST actions and authoritative playback bodies', () => {
    createParty({ name: 'Night' });
    joinParty('AB/C?');
    partyAddTrack('AB/C?', { id: '12' });
    partyRemoveTrack('AB/C?', 9);
    partyReorder('AB/C?', [9, 4]);
    partySetCurrent('AB/C?', 1);
    partySetPlayback('AB/C?', { is_playing: true, position_sec: 4.5 });
    leaveParty('AB/C?');

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, '/api/party', {
      method: 'POST',
      body: { name: 'Night' },
      decode: expect.any(Function),
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, '/api/party/AB%2FC%3F/join', {
      method: 'POST',
      decode: expect.any(Function),
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(3, '/api/party/AB%2FC%3F/tracks', {
      method: 'POST',
      body: { id: '12' },
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(4, '/api/party/AB%2FC%3F/tracks/9', {
      method: 'DELETE',
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(5, '/api/party/AB%2FC%3F/tracks/order', {
      method: 'PATCH',
      body: { ids: [9, 4] },
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(6, '/api/party/AB%2FC%3F/current', {
      method: 'PATCH',
      body: { index: 1 },
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(7, '/api/party/AB%2FC%3F/playback', {
      method: 'PATCH',
      body: { is_playing: true, position_sec: 4.5 },
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(8, '/api/party/AB%2FC%3F/leave', {
      method: 'POST',
    });
  });

  it('uses strict decoders for admin reads/results and exact mutation routes', () => {
    getAdminUsers();
    approveAdminUser(4);
    deleteAdminUser(5);
    getAdminStatus();
    getAdminStorage();
    cleanupAdminStorage();
    getAdminInvites();
    createAdminInvite();

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/admin/users',
      expect.objectContaining({ decode: expect.any(Function) }),
    );
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, '/api/admin/users/4/approve', {
      method: 'PUT',
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(3, '/api/admin/users/5', {
      method: 'DELETE',
    });
    for (const call of [4, 5, 6, 7, 8]) {
      expect(mocks.apiRequest.mock.calls[call - 1]?.[1]).toEqual(
        expect.objectContaining({ decode: expect.any(Function) }),
      );
    }
  });
});
