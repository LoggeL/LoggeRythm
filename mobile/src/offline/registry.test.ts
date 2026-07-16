import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import { attachDownloadedTrack, beginPlaylistDownload, createEmptyOfflineManifest, settlePlaylistDownload } from './model';
import {
  getOfflineSnapshot,
  offlineUriForTrack,
  publishOfflineManifest,
  publishOfflineProgress,
  resetOfflineSnapshot,
  subscribeOfflineDownloads,
  trackIsExplicitlyDownloaded,
} from './registry';

const scope = 'origin::user:7';
const timestamp = '2026-07-16T12:00:00.000Z';
const directoryUri = `file:///data/user/0/top.logge.loggerythm/no_backup/loggerythm_explicit_downloads/v1/scopes/${'a'.repeat(64)}/audio/`;
const track: Track = {
  id: '42',
  title: 'Downloaded',
  artist: 'Artist',
  artist_id: '9',
  artists: [{ id: '9', name: 'Artist' }],
  album: 'Album',
  album_id: '8',
  cover: '',
  duration_sec: 120,
  preview_url: null,
  rank: 1,
  release_date: '2026-01-01',
};

function manifest() {
  const playlist = { id: 5, name: 'Offline', tracks: [track] };
  let value = beginPlaylistDownload(createEmptyOfflineManifest(scope), playlist, timestamp);
  value = attachDownloadedTrack(value, playlist.id, track, 4_200, timestamp);
  return settlePlaylistDownload(value, playlist, timestamp);
}

describe('offline runtime registry', () => {
  it('publishes one account-bound downloaded set and filters untrusted URIs', () => {
    resetOfflineSnapshot(scope);
    publishOfflineManifest({
      manifest: manifest(),
      directoryUri,
      trackUris: { '42': `${directoryUri}42.mp3`, '99': 'https://remote.test' },
      availableDiskBytes: 9_000,
    });
    expect(getOfflineSnapshot()).toEqual(expect.objectContaining({
      scope,
      hydrated: true,
      storageBytes: 4_200,
      availableDiskBytes: 9_000,
    }));
    expect(getOfflineSnapshot().playlists[0]).toEqual(expect.objectContaining({
      id: '5',
      status: 'complete',
    }));
    expect(offlineUriForTrack('42')).toBe(`${directoryUri}42.mp3`);
    expect(offlineUriForTrack('99')).toBeNull();
    expect(trackIsExplicitlyDownloaded('42')).toBe(true);
  });

  it('notifies a single shared subscriber for aggregate progress', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOfflineDownloads(listener);
    publishOfflineProgress({
      phase: 'downloading',
      playlistId: '5',
      done: 0,
      total: 1,
      currentTrackId: '42',
      bytesWritten: 10,
      totalBytes: 100,
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(getOfflineSnapshot().progress).toEqual(expect.objectContaining({ bytesWritten: 10 }));
    unsubscribe();
  });

  it('clears every URI before another account can become active', () => {
    resetOfflineSnapshot('origin::user:8');
    expect(getOfflineSnapshot()).toEqual(expect.objectContaining({
      scope: 'origin::user:8',
      hydrated: false,
      storageBytes: 0,
    }));
    expect(offlineUriForTrack('42')).toBeNull();
    expect(trackIsExplicitlyDownloaded('42')).toBe(false);
  });

  it('refuses missing, renamed, or out-of-scope native files', () => {
    resetOfflineSnapshot(scope);
    expect(() => publishOfflineManifest({
      manifest: manifest(),
      directoryUri,
      trackUris: {},
      availableDiskBytes: 1,
    })).toThrow('not bound to its verified native file');
    expect(trackIsExplicitlyDownloaded('42')).toBe(false);

    expect(() => publishOfflineManifest({
      manifest: manifest(),
      directoryUri,
      trackUris: { '42': `${directoryUri}43.mp3` },
      availableDiskBytes: 1,
    })).toThrow('not bound to its verified native file');
    expect(() => publishOfflineManifest({
      manifest: manifest(),
      directoryUri: 'file:///private/offline/',
      trackUris: { '42': 'file:///private/offline/42.mp3' },
      availableDiskBytes: 1,
    })).toThrow('outside the controlled scope');
  });

  it('cannot replace the active account scope without a reset barrier', () => {
    resetOfflineSnapshot(scope);
    publishOfflineManifest({
      manifest: manifest(),
      directoryUri,
      trackUris: { '42': `${directoryUri}42.mp3` },
      availableDiskBytes: 1,
    });
    const other = { ...manifest(), scope: 'origin::user:8' };
    expect(() => publishOfflineManifest({
      manifest: other,
      directoryUri,
      trackUris: { '42': `${directoryUri}42.mp3` },
      availableDiskBytes: 1,
    })).toThrow('another active account scope');
    expect(getOfflineSnapshot().scope).toBe(scope);
  });
});
