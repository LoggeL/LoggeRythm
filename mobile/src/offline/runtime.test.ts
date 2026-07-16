import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Playlist, Track } from '../api/types';
import { getOfflineSnapshot } from './registry';
import {
  clearOfflineDownloads,
  downloadPlaylistForOffline,
  initializeOfflineDownloads,
  removeOfflinePlaylist,
  resetOfflineRuntimeStateForTests,
} from './runtime';

const mocks = vi.hoisted(() => ({
  authenticatedHeadersFor: vi.fn(),
  getApiBase: vi.fn(),
  hydrate: vi.fn(),
  persist: vi.fn(),
  start: vi.fn(),
  remove: vi.fn(),
  clearScope: vi.fn(),
  clearAll: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  progressListener: null as null | ((value: unknown) => void),
}));

vi.mock('../api/client', () => ({
  authenticatedHeadersFor: mocks.authenticatedHeadersFor,
}));

vi.mock('../config', () => ({
  getApiBase: mocks.getApiBase,
}));

vi.mock('./native', () => ({
  hydrateNativeOffline: mocks.hydrate,
  persistNativeOfflineManifest: mocks.persist,
  startNativePlaylistDownload: mocks.start,
  removeNativeOfflineFiles: mocks.remove,
  clearNativeOfflineScope: mocks.clearScope,
  clearAllNativeOfflineScopes: mocks.clearAll,
  subscribeNativeOfflineProgress: mocks.subscribe,
}));

const scope = 'https://music.test::user:7';
const directory = `file:///data/user/0/top.logge.loggerythm/no_backup/`
  + `loggerythm_explicit_downloads/v1/scopes/${'a'.repeat(64)}/audio/`;

function track(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    artist_id: '8',
    artists: [{ id: '8', name: 'Artist' }],
    album: 'Album',
    album_id: '9',
    cover: 'https://images.test/cover.jpg',
    duration_sec: 180,
    preview_url: null,
    rank: 50,
    release_date: '2026-01-01',
  };
}

function playlist(id: number, tracks: Track[]): Playlist {
  return {
    id,
    name: `Playlist ${id}`,
    description: 'Saved locally',
    cover_url: 'https://images.test/playlist.jpg',
    is_public: false,
    is_owner: true,
    owner_name: 'Owner',
    tracks,
  };
}

function hydration(overrides: Record<string, unknown> = {}) {
  return {
    scope,
    generation: 1,
    directoryUri: directory,
    manifestJson: null,
    availableDiskBytes: 10_000,
    files: [],
    interruptedTrackIds: [],
    invalidTrackIds: [],
    ...overrides,
  };
}

function success(trackId: string, sizeBytes = 1_000) {
  return {
    trackId,
    fileName: `${trackId}.mp3`,
    uri: `${directory}${trackId}.mp3`,
    sizeBytes,
    reused: false,
  };
}

beforeEach(() => {
  resetOfflineRuntimeStateForTests();
  vi.clearAllMocks();
  mocks.progressListener = null;
  mocks.getApiBase.mockResolvedValue('https://music.test');
  mocks.authenticatedHeadersFor.mockResolvedValue({ Cookie: 'sf_session=test-session' });
  mocks.hydrate.mockResolvedValue(hydration());
  mocks.persist.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(20_000);
  mocks.clearScope.mockResolvedValue(2);
  mocks.clearAll.mockResolvedValue({ cleanupGeneration: 2, cleared: true });
  mocks.subscribe.mockImplementation((listener: (value: unknown) => void) => {
    mocks.progressListener = listener;
    return mocks.unsubscribe;
  });
});

describe('offline runtime', () => {
  it('hydrates and persists an empty account-bound manifest before publishing it', async () => {
    await initializeOfflineDownloads(scope);

    expect(mocks.hydrate).toHaveBeenCalledExactlyOnceWith(scope);
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    expect(getOfflineSnapshot()).toMatchObject({
      scope,
      hydrated: true,
      storageBytes: 0,
      availableDiskBytes: 10_000,
      error: null,
    });
  });

  it('downloads unique files while preserving duplicate ordered source occurrences', async () => {
    const source = playlist(9, [track('42'), track('42'), track('43')]);
    mocks.start.mockResolvedValue({
      scope,
      generation: 1,
      playlistId: '9',
      successes: [success('42'), success('43', 2_000)],
      failures: [],
      availableDiskBytes: 7_000,
    });

    await initializeOfflineDownloads(scope);
    await downloadPlaylistForOffline(scope, source);

    expect(mocks.authenticatedHeadersFor).toHaveBeenCalledExactlyOnceWith(
      'https://music.test/api/tracks/42/stream',
    );
    const request = mocks.start.mock.calls[0]?.[0];
    expect(request.tracks).toEqual([
      {
        trackId: '42',
        fileName: '42.mp3',
        url: 'https://music.test/api/tracks/42/stream',
        headers: { Cookie: 'sf_session=test-session' },
      },
      {
        trackId: '43',
        fileName: '43.mp3',
        url: 'https://music.test/api/tracks/43/stream',
        headers: { Cookie: 'sf_session=test-session' },
      },
    ]);
    expect(getOfflineSnapshot().playlists[0]).toMatchObject({
      id: '9',
      sourceTrackIds: ['42', '42', '43'],
      totalOccurrences: 3,
      downloadedOccurrences: 3,
      status: 'complete',
    });
    expect(getOfflineSnapshot().downloadedTrackIds).toEqual(new Set(['42', '43']));
  });

  it('persists structured partial failures without losing cold track metadata', async () => {
    const source = playlist(9, [track('42'), track('43')]);
    mocks.start.mockResolvedValue({
      scope,
      generation: 1,
      playlistId: '9',
      successes: [success('42')],
      failures: [{ trackId: '43', code: 'network', retryable: true }],
      availableDiskBytes: 9_000,
    });

    await initializeOfflineDownloads(scope);
    await downloadPlaylistForOffline(scope, source);

    const saved = getOfflineSnapshot().playlists[0];
    expect(saved).toMatchObject({
      status: 'partial',
      downloadedOccurrences: 1,
      failedOccurrences: 1,
      failedTrackIds: ['43'],
      failures: [{ trackId: '43', code: 'network', retryable: true }],
    });
    expect(saved?.sourceTracks.map(({ track: value }) => value.title)).toEqual([
      'Track 42',
      'Track 43',
    ]);
  });

  it('reuses a verified shared file without a second auth or native download', async () => {
    mocks.start.mockResolvedValue({
      scope,
      generation: 1,
      playlistId: '9',
      successes: [success('42')],
      failures: [],
      availableDiskBytes: 9_000,
    });

    await initializeOfflineDownloads(scope);
    await downloadPlaylistForOffline(scope, playlist(9, [track('42')]));
    await downloadPlaylistForOffline(scope, playlist(10, [track('42')]));

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.authenticatedHeadersFor).toHaveBeenCalledOnce();
    expect(getOfflineSnapshot().manifest?.tracks['42']?.ownerPlaylistIds).toEqual([
      '9',
      '10',
    ]);
  });

  it('removes a shared file only after its final playlist owner is removed', async () => {
    mocks.start.mockResolvedValue({
      scope,
      generation: 1,
      playlistId: '9',
      successes: [success('42')],
      failures: [],
      availableDiskBytes: 9_000,
    });
    await initializeOfflineDownloads(scope);
    await downloadPlaylistForOffline(scope, playlist(9, [track('42')]));
    await downloadPlaylistForOffline(scope, playlist(10, [track('42')]));

    await removeOfflinePlaylist(scope, 9);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(getOfflineSnapshot().downloadedTrackIds.has('42')).toBe(true);

    await removeOfflinePlaylist(scope, 10);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(scope, 1, ['42.mp3']);
    expect(getOfflineSnapshot().downloadedTrackIds.has('42')).toBe(false);
  });

  it('retries an unpublished orphan deletion in the same process', async () => {
    mocks.start.mockResolvedValue({
      scope,
      generation: 1,
      playlistId: '9',
      successes: [success('42')],
      failures: [],
      availableDiskBytes: 9_000,
    });
    mocks.remove
      .mockRejectedValueOnce(new Error('temporary remove failure'))
      .mockResolvedValueOnce(20_000);
    await initializeOfflineDownloads(scope);
    await downloadPlaylistForOffline(scope, playlist(9, [track('42')]));

    await expect(removeOfflinePlaylist(scope, 9)).rejects.toThrow('temporary remove failure');
    expect(getOfflineSnapshot().playlists).toEqual([]);
    expect(getOfflineSnapshot().trackUris).toEqual({});

    await expect(removeOfflinePlaylist(scope, 9)).resolves.toBeUndefined();
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.remove).toHaveBeenLastCalledWith(scope, 1, ['42.mp3']);
    expect(getOfflineSnapshot().error).toBeNull();
  });

  it('invalidates a late native download result before account clear can be undone', async () => {
    let resolveDownload!: (value: unknown) => void;
    mocks.start.mockImplementation(() => new Promise((resolve) => {
      resolveDownload = resolve;
    }));
    await initializeOfflineDownloads(scope);
    const download = downloadPlaylistForOffline(scope, playlist(9, [track('42')]));
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    const persistedBeforeClear = mocks.persist.mock.calls.length;

    await clearOfflineDownloads(scope);
    resolveDownload({
      scope,
      generation: 1,
      playlistId: '9',
      successes: [success('42')],
      failures: [],
      availableDiskBytes: 9_000,
    });

    await expect(download).rejects.toThrow('invalidated');
    expect(mocks.persist).toHaveBeenCalledTimes(persistedBeforeClear);
    expect(getOfflineSnapshot()).toMatchObject({ scope: null, hydrated: false });
  });

  it('uses the all-scopes eraser when the departing account is unknown', async () => {
    await clearOfflineDownloads(null);

    expect(mocks.clearAll).toHaveBeenCalledOnce();
    expect(mocks.clearScope).not.toHaveBeenCalled();
  });

  it('logs only the safe native code when account cleanup fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.clearAll.mockRejectedValueOnce(Object.assign(new Error('private detail'), {
      code: 'storage-scope-invalid',
    }));

    await expect(clearOfflineDownloads(null)).rejects.toThrow('private detail');

    expect(warning).toHaveBeenCalledExactlyOnceWith(
      '[LoggeRythm] offline audio cleanup failed: storage-scope-invalid',
    );
    warning.mockRestore();
  });

  it('promotes a concurrent mismatched clear to the all-scopes eraser', async () => {
    let resolveScopedClear!: (value: number) => void;
    mocks.clearScope.mockImplementationOnce(() => new Promise((resolve) => {
      resolveScopedClear = resolve;
    }));
    await initializeOfflineDownloads(scope);

    const scopedClear = clearOfflineDownloads(scope);
    const globalClear = clearOfflineDownloads(null);
    resolveScopedClear(2);
    await Promise.all([scopedClear, globalClear]);

    expect(mocks.clearScope).toHaveBeenCalledExactlyOnceWith(scope);
    expect(mocks.clearAll).toHaveBeenCalledOnce();
  });

  it('repairs a native manifest-read failure with a scoped clear and fresh hydrate', async () => {
    mocks.hydrate
      .mockRejectedValueOnce(Object.assign(new Error('safe native failure'), {
        code: 'manifest-read-failed',
      }))
      .mockResolvedValueOnce(hydration({ generation: 2 }));

    await initializeOfflineDownloads(scope);

    expect(mocks.clearScope).toHaveBeenCalledExactlyOnceWith(scope);
    expect(mocks.hydrate).toHaveBeenCalledTimes(2);
    expect(getOfflineSnapshot()).toMatchObject({
      scope,
      hydrated: true,
      error: 'storage-unavailable',
    });
  });

  it('removes published file URIs immediately on an unexpected account mismatch', async () => {
    mocks.start.mockResolvedValue({
      scope,
      generation: 1,
      playlistId: '9',
      successes: [success('42')],
      failures: [],
      availableDiskBytes: 9_000,
    });
    await initializeOfflineDownloads(scope);
    await downloadPlaylistForOffline(scope, playlist(9, [track('42')]));

    await initializeOfflineDownloads('https://music.test::user:8');

    expect(getOfflineSnapshot()).toMatchObject({
      scope: 'https://music.test::user:8',
      hydrated: false,
      trackUris: {},
      error: 'storage-unavailable',
    });
  });

  it('cancels every operation queued before cleanup instead of rehydrating old audio', async () => {
    let resolveDownload!: (value: unknown) => void;
    mocks.start.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDownload = resolve;
    }));
    await initializeOfflineDownloads(scope);
    const first = downloadPlaylistForOffline(scope, playlist(9, [track('42')]));
    void first.catch(() => undefined);
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());

    const queuedInitialize = initializeOfflineDownloads(scope);
    const queuedDownload = downloadPlaylistForOffline(scope, playlist(10, [track('43')]));
    const queuedRemove = removeOfflinePlaylist(scope, 9);
    void queuedDownload.catch(() => undefined);
    void queuedRemove.catch(() => undefined);
    await clearOfflineDownloads(scope);
    const persistedBeforeResolution = mocks.persist.mock.calls.length;
    resolveDownload({
      scope,
      generation: 1,
      playlistId: '9',
      successes: [success('42')],
      failures: [],
      availableDiskBytes: 9_000,
    });

    await expect(first).rejects.toThrow('invalidated');
    await expect(queuedInitialize).resolves.toBeUndefined();
    await expect(queuedDownload).rejects.toThrow('invalidated');
    await expect(queuedRemove).rejects.toThrow('invalidated');
    expect(mocks.hydrate).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenCalledTimes(persistedBeforeResolution);
    expect(getOfflineSnapshot()).toMatchObject({ scope: null, hydrated: false });
  });

  it('keeps the online shell available when native storage cannot hydrate', async () => {
    mocks.hydrate.mockRejectedValue(new Error('native unavailable'));

    await expect(initializeOfflineDownloads(scope)).resolves.toBeUndefined();
    expect(getOfflineSnapshot()).toMatchObject({
      scope,
      hydrated: false,
      error: 'storage-unavailable',
    });
  });
});
