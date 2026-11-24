import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeTrack } from '../api/decoders';
import type { Playlist, Track } from '../api/types';
import { decodeOfflineManifest } from './model';
import { getOfflineSnapshot } from './registry';
import {
  clearOfflineDownloads,
  downloadTrackForOffline,
  downloadPlaylistForOffline,
  initializeOfflineDownloads,
  removeOfflineTrack,
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
    owner_id: 7,
    owner_name: 'Owner',
    owner_avatar_url: null,
    is_collaborative: false,
    is_collaborator: false,
    can_edit_tracks: true,
    collaborators: [],
    collaborator_count: 0,
    revision: 0,
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

  it('downloads and removes one independently owned track without a playlist snapshot', async () => {
    mocks.start.mockResolvedValue({
      scope,
      generation: 1,
      playlistId: '42',
      successes: [success('42')],
      failures: [],
      availableDiskBytes: 9_000,
    });

    await initializeOfflineDownloads(scope);
    await downloadTrackForOffline(scope, track('42'));

    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      playlistId: '42',
      tracks: [expect.objectContaining({ trackId: '42' })],
    }));
    expect(getOfflineSnapshot().playlists).toEqual([]);
    expect(getOfflineSnapshot().manifest?.tracks['42']).toEqual(expect.objectContaining({
      individualDownload: true,
      ownerPlaylistIds: [],
    }));
    expect(getOfflineSnapshot().downloadedTrackIds.has('42')).toBe(true);

    await removeOfflineTrack(scope, '42');

    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(scope, 1, ['42.mp3']);
    expect(getOfflineSnapshot().downloadedTrackIds.has('42')).toBe(false);
  });

  it('adds individual ownership to a playlist file without downloading it twice', async () => {
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
    await downloadTrackForOffline(scope, track('42'));
    await removeOfflineTrack(scope, '42');

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(getOfflineSnapshot().manifest?.tracks['42']).toEqual(expect.objectContaining({
      individualDownload: false,
      ownerPlaylistIds: ['9'],
    }));
    expect(getOfflineSnapshot().downloadedTrackIds.has('42')).toBe(true);
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

/**
 * The API serialises the three loudness fields on every track, usually as
 * null. These fixtures mirror a live response after `decodeTrack`.
 */
const loudnessWireShapes = [
  {
    shape: 'three nulls',
    loudness: { loudness_gain_db: null, loudness_lufs: null, loudness_peak: null },
  },
  {
    shape: 'all numeric',
    loudness: { loudness_gain_db: -6.5, loudness_lufs: -9.25, loudness_peak: 0.98 },
  },
  {
    shape: 'mixed null and numeric',
    loudness: { loudness_gain_db: null, loudness_lufs: -14.3, loudness_peak: 1 },
  },
  { shape: 'absent keys', loudness: {} },
] as const;

function wireTrack(id: string, loudness: Record<string, number | null>): Track {
  return decodeTrack({ ...track(id), ...loudness });
}

function storedFile(trackId: string, sizeBytes = 1_000) {
  return {
    trackId,
    fileName: `${trackId}.mp3`,
    uri: `${directory}${trackId}.mp3`,
    sizeBytes,
  };
}

function lastPersistedManifest(): string {
  const call = mocks.persist.mock.calls.at(-1);
  if (call === undefined) throw new Error('No offline manifest was persisted');
  return call[2] as string;
}

describe.each(loudnessWireShapes)(
  'offline runtime with $shape loudness metadata from the wire',
  ({ loudness }) => {
    it('downloads one track and rehydrates it on a cold start without clearing the scope', async () => {
      const source = wireTrack('42', loudness);
      mocks.start.mockResolvedValue({
        scope,
        generation: 1,
        playlistId: '42',
        successes: [success('42')],
        failures: [],
        availableDiskBytes: 9_000,
      });

      await initializeOfflineDownloads(scope);
      await downloadTrackForOffline(scope, source);

      expect(getOfflineSnapshot().error).toBeNull();
      expect(getOfflineSnapshot().downloadedTrackIds).toEqual(new Set(['42']));
      expect(getOfflineSnapshot().manifest?.tracks['42']).toEqual(expect.objectContaining({
        track: { ...track('42'), ...loudness },
        individualDownload: true,
      }));
      const persisted = lastPersistedManifest();
      expect(decodeOfflineManifest(persisted, scope).tracks['42']?.track).toEqual({
        ...track('42'),
        ...loudness,
      });

      resetOfflineRuntimeStateForTests();
      mocks.persist.mockClear();
      mocks.hydrate.mockResolvedValue(hydration({
        manifestJson: persisted,
        files: [storedFile('42')],
      }));
      await initializeOfflineDownloads(scope);

      expect(mocks.clearScope).not.toHaveBeenCalled();
      // An unchanged manifest decodes and re-serialises byte for byte.
      expect(mocks.persist).not.toHaveBeenCalled();
      expect(getOfflineSnapshot()).toMatchObject({ scope, hydrated: true, error: null });
      expect(getOfflineSnapshot().downloadedTrackIds).toEqual(new Set(['42']));
      expect(getOfflineSnapshot().manifest?.tracks['42']?.track).toEqual({
        ...track('42'),
        ...loudness,
      });
    });

    it('downloads a playlist and rehydrates it on a cold start without clearing the scope', async () => {
      const source = playlist(9, [
        wireTrack('42', loudness),
        wireTrack('42', loudness),
        wireTrack('43', loudness),
      ]);
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

      expect(mocks.start).toHaveBeenCalledOnce();
      expect(getOfflineSnapshot().error).toBeNull();
      expect(getOfflineSnapshot().playlists[0]).toMatchObject({
        id: '9',
        status: 'complete',
        downloadedOccurrences: 3,
      });
      const persisted = lastPersistedManifest();
      expect(decodeOfflineManifest(persisted, scope).playlists['9']?.sourceTracks.map(
        ({ track: value }) => value,
      )).toEqual([
        { ...track('42'), ...loudness },
        { ...track('42'), ...loudness },
        { ...track('43'), ...loudness },
      ]);

      resetOfflineRuntimeStateForTests();
      mocks.persist.mockClear();
      mocks.hydrate.mockResolvedValue(hydration({
        manifestJson: persisted,
        files: [storedFile('42'), storedFile('43', 2_000)],
      }));
      await initializeOfflineDownloads(scope);

      expect(mocks.clearScope).not.toHaveBeenCalled();
      expect(mocks.persist).not.toHaveBeenCalled();
      expect(getOfflineSnapshot()).toMatchObject({ scope, hydrated: true, error: null });
      expect(getOfflineSnapshot().downloadedTrackIds).toEqual(new Set(['42', '43']));
      expect(getOfflineSnapshot().playlists[0]).toMatchObject({ id: '9', status: 'complete' });
      expect(getOfflineSnapshot().manifest?.tracks['43']?.track).toEqual({
        ...track('43'),
        ...loudness,
      });
    });
  },
);

describe('offline runtime loudness compatibility', () => {
  const nulls = { loudness_gain_db: null, loudness_lufs: null, loudness_peak: null };

  /** Hand-written to pin the persisted shape from before loudness keys were accepted. */
  function legacyManifestJson(): string {
    return JSON.stringify({
      version: 2,
      scope,
      tracks: {
        '42': {
          track: track('42'),
          fileName: '42.mp3',
          sizeBytes: 1_000,
          ownerPlaylistIds: ['9'],
          individualDownload: false,
          downloadedAt: '2026-07-16T12:00:00.000Z',
        },
      },
      playlists: {
        '9': {
          id: '9',
          name: 'Playlist 9',
          description: null,
          cover_url: null,
          is_public: false,
          is_owner: true,
          owner_name: null,
          sourceTrackIds: ['42'],
          sourceTracks: [{ position: 0, track: track('42') }],
          status: 'complete',
          failures: [],
          completedAt: '2026-07-16T12:00:00.000Z',
          updatedAt: '2026-07-16T12:00:00.000Z',
        },
      },
    });
  }

  it('keeps an existing manifest without loudness keys and downloads wire tracks beside it', async () => {
    const legacy = legacyManifestJson();
    expect(legacy).not.toContain('loudness');
    mocks.hydrate.mockResolvedValue(hydration({
      manifestJson: legacy,
      files: [storedFile('42')],
    }));
    mocks.start.mockResolvedValue({
      scope,
      generation: 1,
      playlistId: '43',
      successes: [success('43', 2_000)],
      failures: [],
      availableDiskBytes: 7_000,
    });

    await initializeOfflineDownloads(scope);

    expect(mocks.clearScope).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(getOfflineSnapshot()).toMatchObject({ scope, hydrated: true, error: null });
    expect(getOfflineSnapshot().manifest?.tracks['42']?.track).toEqual(track('42'));

    await downloadTrackForOffline(scope, wireTrack('43', nulls));
    // The already stored file gains an individual owner from a wire-shaped track.
    await downloadTrackForOffline(scope, wireTrack('42', nulls));

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(getOfflineSnapshot().error).toBeNull();
    expect(getOfflineSnapshot().downloadedTrackIds).toEqual(new Set(['42', '43']));
    const decoded = decodeOfflineManifest(lastPersistedManifest(), scope);
    expect(decoded.tracks['43']?.track).toEqual({ ...track('43'), ...nulls });
    expect(decoded.tracks['42']).toEqual(expect.objectContaining({
      track: track('42'),
      individualDownload: true,
      ownerPlaylistIds: ['9'],
    }));
  });

  it('rejects an invalid track before any native download can leave a file behind', async () => {
    await initializeOfflineDownloads(scope);

    await expect(downloadTrackForOffline(
      scope,
      { ...wireTrack('42', nulls), radar_reason: null } as Track,
    )).rejects.toThrow('Individually downloaded track has unexpected fields');

    expect(mocks.authenticatedHeadersFor).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(getOfflineSnapshot().error).toBe('download-failed');
    expect(getOfflineSnapshot().downloadedTrackIds.size).toBe(0);
  });
});
