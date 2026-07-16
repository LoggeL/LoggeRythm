import { describe, expect, it } from 'vitest';
import type { Playlist, Track } from '../api/types';
import {
  attachDownloadedTrack,
  beginPlaylistDownload,
  createEmptyOfflineManifest,
  settlePlaylistDownload,
} from './model';
import {
  getOfflinePlaylistBrowseDetail,
  listOfflinePlaylistSummaries,
  reconstructOfflinePlaylist,
} from './browse';

const scope = 'https://music.test::user:7';
const firstTime = '2026-07-16T12:00:00.000Z';
const secondTime = '2026-07-16T13:00:00.000Z';

function track(id: string, title = `Track ${id}`): Track {
  return {
    id,
    title,
    artist: `Artist ${id}`,
    artist_id: '9',
    artists: [
      { id: '9', name: `Artist ${id}` },
      { id: '8', name: `Guest ${id}` },
    ],
    album: `Album ${id}`,
    album_id: '7',
    cover: `https://img.test/${id}.jpg`,
    duration_sec: 100 + Number(id),
    preview_url: `https://preview.test/${id}.mp3`,
    rank: 10_000 + Number(id),
    release_date: '2026-07-16',
  };
}

function playlist(id: number, name: string, tracks: Track[]): Playlist {
  return {
    id,
    name,
    description: `${name} description`,
    cover_url: `https://img.test/playlist-${id}.jpg`,
    is_public: true,
    is_owner: true,
    owner_name: 'Offline owner',
    tracks,
  };
}

describe('cold offline playlist browse selectors', () => {
  it('lists API-shaped summaries with sorted status, occurrence, size, and failure evidence', () => {
    const older = playlist(1, 'Older complete', [track('10')]);
    const newer = playlist(2, 'Newer partial', [track('20'), track('21'), track('20')]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), older, firstTime);
    manifest = attachDownloadedTrack(manifest, older.id, older.tracks[0], 1_000, firstTime);
    manifest = settlePlaylistDownload(manifest, older, firstTime);
    manifest = beginPlaylistDownload(manifest, newer, secondTime);
    manifest = attachDownloadedTrack(manifest, newer.id, newer.tracks[0], 2_000, secondTime);
    manifest = settlePlaylistDownload(manifest, newer, secondTime, [{
      trackId: '21',
      code: 'network-timeout',
      retryable: true,
    }]);

    expect(listOfflinePlaylistSummaries(manifest, scope)).toEqual([
      {
        id: 2,
        name: 'Newer partial',
        description: 'Newer partial description',
        cover_url: 'https://img.test/playlist-2.jpg',
        is_public: true,
        track_count: 3,
        owner_name: 'Offline owner',
        is_owner: true,
        offline: {
          status: 'partial',
          downloadedOccurrences: 2,
          failedOccurrences: 1,
          pendingOccurrences: 0,
          totalOccurrences: 3,
          sizeBytes: 2_000,
          failures: [{
            trackId: '21',
            code: 'network-timeout',
            retryable: true,
            failedAt: secondTime,
          }],
          failedTrackIds: ['21'],
          pendingTrackIds: [],
          completedAt: null,
          updatedAt: secondTime,
        },
      },
      expect.objectContaining({
        id: 1,
        name: 'Older complete',
        track_count: 1,
        offline: expect.objectContaining({
          status: 'complete',
          downloadedOccurrences: 1,
          totalOccurrences: 1,
          sizeBytes: 1_000,
        }),
      }),
    ]);
  });

  it('reconstructs exact ordered duplicate source occurrences with their full metadata', () => {
    const firstOccurrence = track('70', 'Original title');
    const unavailable = track('71', 'Unavailable but still browsable');
    const repeatedOccurrence = {
      ...track('70', 'Metadata captured at repeated position'),
      rank: 99_999,
    };
    const source = playlist(7, 'Cold partial', [
      firstOccurrence,
      unavailable,
      repeatedOccurrence,
    ]);
    const unrelated = playlist(8, 'Other snapshot', [track('80', 'Must not leak')]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    manifest = attachDownloadedTrack(manifest, source.id, firstOccurrence, 7_000, firstTime);
    manifest = settlePlaylistDownload(manifest, source, secondTime, [{
      trackId: '71',
      code: 'file-missing',
      retryable: true,
    }]);
    manifest = beginPlaylistDownload(manifest, unrelated, secondTime);
    manifest = attachDownloadedTrack(manifest, unrelated.id, unrelated.tracks[0], 8_000, secondTime);
    manifest = settlePlaylistDownload(manifest, unrelated, secondTime);

    const reconstructed = reconstructOfflinePlaylist(manifest, scope, 7);
    expect(reconstructed).toEqual(source);
    expect(reconstructed?.tracks.map(({ id, title, rank }) => ({ id, title, rank }))).toEqual([
      { id: '70', title: 'Original title', rank: 10_070 },
      { id: '71', title: 'Unavailable but still browsable', rank: 10_071 },
      { id: '70', title: 'Metadata captured at repeated position', rank: 99_999 },
    ]);
    expect(reconstructed?.tracks.some(({ id }) => id === '80')).toBe(false);

    reconstructed!.tracks[0].artists[0].name = 'Caller mutation';
    expect(manifest.playlists['7'].sourceTracks[0].track.artists[0].name).toBe('Artist 70');
  });

  it('exposes downloaded, failed, and pending evidence per exact occurrence', () => {
    const source = playlist(3, 'Occurrence evidence', [
      track('30'),
      track('31'),
      track('30', 'Repeated 30'),
    ]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    manifest = attachDownloadedTrack(manifest, source.id, source.tracks[0], 3_000, firstTime);

    const pending = getOfflinePlaylistBrowseDetail(manifest, scope, '3');
    expect(pending?.occurrences.map(({ position, track: value, availability, failure }) => ({
      position,
      id: value.id,
      availability,
      failure,
    }))).toEqual([
      { position: 0, id: '30', availability: 'downloaded', failure: null },
      { position: 1, id: '31', availability: 'pending', failure: null },
      { position: 2, id: '30', availability: 'downloaded', failure: null },
    ]);

    manifest = settlePlaylistDownload(manifest, source, secondTime, [{
      trackId: '31',
      code: 'download-rejected',
      retryable: false,
    }]);
    const settled = getOfflinePlaylistBrowseDetail(manifest, scope, 3);
    expect(settled?.occurrences[1]).toEqual(expect.objectContaining({
      position: 1,
      availability: 'failed',
      failure: {
        trackId: '31',
        code: 'download-rejected',
        retryable: false,
        failedAt: secondTime,
      },
    }));
    expect(settled?.playlist.tracks).toEqual(source.tracks);
  });

  it('returns null for unknown or invalid IDs and rejects cross-account reads', () => {
    const source = playlist(4, 'Known', [track('40')]);
    const manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);

    expect(reconstructOfflinePlaylist(manifest, scope, '999')).toBeNull();
    expect(reconstructOfflinePlaylist(manifest, scope, '../4')).toBeNull();
    expect(getOfflinePlaylistBrowseDetail(manifest, scope, null)).toBeNull();
    expect(() => listOfflinePlaylistSummaries(
      manifest,
      'https://music.test::user:8',
    )).toThrow('another account scope');
    expect(() => reconstructOfflinePlaylist(manifest, ' ', 4)).toThrow('non-empty exact string');
  });
});
