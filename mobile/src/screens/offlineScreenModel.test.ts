import { describe, expect, it, vi } from 'vitest';
import type { Playlist, Track } from '../api/types';
import {
  attachDownloadedTrack,
  beginPlaylistDownload,
  createEmptyOfflineManifest,
  settlePlaylistDownload,
} from '../offline/model';
import type { OfflineRuntimeSnapshot } from '../offline/registry';
import {
  accountOfflinePlaylistDetail,
  accountOfflinePlaylistSummaries,
  accountOfflineAvailability,
  firstDownloadedOccurrenceIndex,
  localPlaylistPlaybackSelection,
  offlineRetryAction,
  playlistOfflineControlState,
  playlistScreenPlaybackOptions,
} from './offlineScreenModel';

const scope = 'https://music.test::user:7';
const otherScope = 'https://music.test::user:8';
const firstTime = '2026-07-16T12:00:00.000Z';
const secondTime = '2026-07-16T13:00:00.000Z';

function track(id: string, title = `Track ${id}`): Track {
  return {
    id,
    title,
    artist: `Artist ${id}`,
    artist_id: '9',
    artists: [{ id: '9', name: `Artist ${id}` }],
    album: `Album ${id}`,
    album_id: '7',
    cover: `https://img.test/${id}.jpg`,
    duration_sec: 100,
    preview_url: null,
    rank: 10,
    release_date: '2026-07-16',
  };
}

function playlist(id: number, tracks: Track[]): Playlist {
  return {
    id,
    name: `Playlist ${id}`,
    description: 'Cold source',
    cover_url: null,
    is_public: false,
    is_owner: true,
    owner_name: 'Owner',
    tracks,
  };
}

function snapshot(
  manifest: ReturnType<typeof createEmptyOfflineManifest>,
  overrides: Partial<OfflineRuntimeSnapshot> = {},
): OfflineRuntimeSnapshot {
  return {
    scope: manifest.scope,
    hydrated: true,
    manifest,
    directoryUri: 'file:///data/loggerythm_explicit_downloads/v1/scopes/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/audio/',
    playlists: [],
    trackUris: {},
    downloadedTrackIds: new Set(Object.keys(manifest.tracks)),
    storageBytes: 0,
    availableDiskBytes: 1_000_000,
    progress: null,
    error: null,
    ...overrides,
  };
}

function partialFixture() {
  const source = playlist(4, [
    track('40', 'First duplicate'),
    track('41', 'Unavailable'),
    track('40', 'Second duplicate'),
  ]);
  let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
  manifest = attachDownloadedTrack(manifest, source.id, source.tracks[0], 4_000, firstTime);
  manifest = settlePlaylistDownload(manifest, source, secondTime, [{
    trackId: '41',
    code: 'network-timeout',
    retryable: true,
  }]);
  return { source, manifest };
}

describe('offline screen selectors', () => {
  it('fails closed for unhydrated and cross-account snapshots', () => {
    const { manifest } = partialFixture();
    const value = snapshot(manifest);

    expect(accountOfflinePlaylistSummaries(value, otherScope)).toEqual([]);
    expect(accountOfflinePlaylistDetail(value, otherScope, 4)).toBeNull();
    expect(accountOfflinePlaylistSummaries({ ...value, hydrated: false }, scope)).toEqual([]);
    expect(accountOfflineAvailability({ ...value, hydrated: false }, scope)).toBe('loading');
    expect(accountOfflineAvailability(value, otherScope)).toBe('unavailable');
    expect(accountOfflineAvailability(value, scope)).toBe('ready');
    expect(playlistOfflineControlState({
      snapshot: value,
      accountScope: otherScope,
      playlistId: 4,
      sourceTrackCount: 3,
    })).toEqual({ kind: 'unavailable' });
  });

  it('lists both partial and complete local playlists in manifest order', () => {
    const { source, manifest: partial } = partialFixture();
    const completeSource = playlist(5, [track('50')]);
    let manifest = beginPlaylistDownload(partial, completeSource, '2026-07-16T14:00:00.000Z');
    manifest = attachDownloadedTrack(
      manifest,
      completeSource.id,
      completeSource.tracks[0],
      5_000,
      '2026-07-16T14:00:00.000Z',
    );
    manifest = settlePlaylistDownload(
      manifest,
      completeSource,
      '2026-07-16T14:00:00.000Z',
    );

    expect(accountOfflinePlaylistSummaries(snapshot(manifest), scope).map((entry) => ({
      id: entry.id,
      status: entry.offline.status,
      count: entry.track_count,
    }))).toEqual([
      { id: 5, status: 'complete', count: 1 },
      { id: source.id, status: 'partial', count: 3 },
    ]);
  });

  it('maps persisted failures and exact active phases into control states', () => {
    const { source, manifest } = partialFixture();
    const value = snapshot(manifest);
    const input = {
      snapshot: value,
      accountScope: scope,
      playlistId: 4,
      sourceTrackCount: 3,
    };

    expect(playlistOfflineControlState(input)).toEqual({
      kind: 'partial',
      progress: { completedTracks: 2, totalTracks: 3, failedTracks: 1 },
    });
    expect(playlistOfflineControlState({ ...input, operation: 'downloading' })).toEqual({
      kind: 'downloading',
      progress: { completedTracks: 2, totalTracks: 3, failedTracks: 1 },
    });
    expect(playlistOfflineControlState({
      ...input,
      snapshot: snapshot(manifest, {
        progress: {
          phase: 'removing',
          playlistId: '4',
          done: 1,
          total: 2,
          currentTrackId: null,
          bytesWritten: 0,
          totalBytes: null,
        },
      }),
    })).toEqual({
      kind: 'removing',
      progress: { completedTracks: 1, totalTracks: 2, failedTracks: 0 },
    });
    expect(playlistOfflineControlState({
      ...input,
      snapshot: snapshot(manifest, { error: 'download-failed' }),
    }).kind).toBe('partial');
    expect(playlistOfflineControlState({
      ...input,
      actionFailure: 'download',
    }).kind).toBe('error');
    expect(playlistOfflineControlState({
      ...input,
      actionFailure: 'remove',
    }).kind).toBe('error');

    let failedManifest = beginPlaylistDownload(manifest, source, secondTime);
    failedManifest = settlePlaylistDownload(failedManifest, source, secondTime, [{
      trackId: '41',
      code: 'download-failed',
      retryable: true,
    }]);
    expect(playlistOfflineControlState({
      ...input,
      snapshot: snapshot(failedManifest, { error: 'download-failed' }),
    }).kind).toBe('error');
  });

  it('selects strict cold playback and the failure-specific retry operation', () => {
    const context = { type: 'playlist' as const, id: '4', label: 'Cold source' };

    expect(playlistScreenPlaybackOptions(context, true)).toEqual({
      context,
      requireExplicitDownloads: true,
    });
    expect(playlistScreenPlaybackOptions(context, false)).toEqual({
      context,
      requireExplicitDownloads: false,
    });
    const retryDownload = vi.fn();
    const retryRemove = vi.fn();
    offlineRetryAction('remove', retryDownload, retryRemove)();
    expect(retryRemove).toHaveBeenCalledOnce();
    expect(retryDownload).not.toHaveBeenCalled();

    offlineRetryAction('download', retryDownload, retryRemove)();
    offlineRetryAction(null, retryDownload, retryRemove)();
    expect(retryDownload).toHaveBeenCalledTimes(2);
  });

  it('builds a fully local queue while preserving downloaded duplicate occurrences', () => {
    const { manifest } = partialFixture();
    const detail = accountOfflinePlaylistDetail(snapshot(manifest), scope, 4)!;

    expect(detail.playlist.tracks.map(({ title }) => title)).toEqual([
      'First duplicate',
      'Unavailable',
      'Second duplicate',
    ]);
    expect(firstDownloadedOccurrenceIndex(detail)).toBe(0);
    expect(localPlaylistPlaybackSelection(detail, 1)).toBeNull();
    expect(localPlaylistPlaybackSelection(detail, 2)).toEqual({
      tracks: [detail.playlist.tracks[0], detail.playlist.tracks[2]],
      startIndex: 1,
    });
  });
});
