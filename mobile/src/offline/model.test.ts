import { describe, expect, it } from 'vitest';
import type { Playlist, Track } from '../api/types';
import {
  OFFLINE_MANIFEST_VERSION,
  attachDownloadedTrack,
  beginPlaylistDownload,
  createEmptyOfflineManifest,
  decodeOfflineManifest,
  offlineManifestStorageKey,
  offlinePlaylistViews,
  offlineStorageBytes,
  offlineTrackFileName,
  reconcileOfflineManifest,
  removePlaylistDownload,
  settlePlaylistDownload,
} from './model';

function track(id: string, title = `Track ${id}`): Track {
  return {
    id,
    title,
    artist: 'Artist',
    artist_id: '9',
    artists: [{ id: '9', name: 'Artist' }],
    album: 'Album',
    album_id: '8',
    cover: 'https://img.test/cover.jpg',
    duration_sec: 180,
    preview_url: null,
    rank: 7,
    release_date: '2026-01-01',
  };
}

function playlist(id: number, name: string, tracks: Track[]): Playlist {
  return {
    id,
    name,
    description: `${name} description`,
    cover_url: `https://img.test/${id}.jpg`,
    is_public: true,
    is_owner: false,
    owner_name: 'Remote owner',
    tracks,
  };
}

const scope = 'https://music.test::user:7';
const firstTime = '2026-07-16T12:00:00.000Z';
const secondTime = '2026-07-16T13:00:00.000Z';
const thirdTime = '2026-07-16T14:00:00.000Z';

describe('offline download manifest', () => {
  it('uses a v2 account/origin key and path-safe Deezer filenames', () => {
    expect(OFFLINE_MANIFEST_VERSION).toBe(2);
    expect(offlineManifestStorageKey(scope)).toBe(
      'lr.offline-downloads.v2:https%3A%2F%2Fmusic.test%3A%3Auser%3A7',
    );
    expect(offlineTrackFileName('42')).toBe('42.mp3');
    expect(() => offlineTrackFileName('00042')).toThrow('positive decimal Deezer id');
    expect(() => offlineTrackFileName('../42')).toThrow('positive decimal Deezer id');
    expect(() => offlineTrackFileName('0')).toThrow('positive decimal Deezer id');
    expect(() => createEmptyOfflineManifest('   ')).toThrow('non-empty string');
  });

  it('persists complete playlist metadata and occurrence-aligned duplicate source tracks', () => {
    const source = playlist(7, 'Cold partial', [
      track('70', 'First occurrence'),
      track('71', 'Unavailable on disk'),
      track('70', 'Repeated occurrence'),
    ]);
    const manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    const stored = manifest.playlists['7'];

    expect(stored).toEqual(expect.objectContaining({
      id: '7',
      name: 'Cold partial',
      description: 'Cold partial description',
      cover_url: 'https://img.test/7.jpg',
      is_public: true,
      is_owner: false,
      owner_name: 'Remote owner',
      sourceTrackIds: ['70', '71', '70'],
      failures: [],
    }));
    expect(stored.sourceTracks.map(({ position, track: value }) => ({
      position,
      id: value.id,
      title: value.title,
    }))).toEqual([
      { position: 0, id: '70', title: 'First occurrence' },
      { position: 1, id: '71', title: 'Unavailable on disk' },
      { position: 2, id: '70', title: 'Repeated occurrence' },
    ]);
    expect(offlinePlaylistViews(manifest)[0]).toEqual(expect.objectContaining({
      downloadedOccurrences: 0,
      failedOccurrences: 0,
      pendingOccurrences: 3,
      totalOccurrences: 3,
      pendingTrackIds: ['70', '71'],
    }));
    expect(decodeOfflineManifest(JSON.stringify(manifest), scope)).toEqual(manifest);
  });

  it('keeps structured failure evidence across a cold partial retry and clears it on success', () => {
    const source = playlist(7, 'Partial', [track('70'), track('71'), track('70')]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    manifest = attachDownloadedTrack(manifest, source.id, source.tracks[0], 700, firstTime);
    manifest = settlePlaylistDownload(manifest, source, secondTime, [{
      trackId: '71',
      code: 'network-timeout',
      retryable: true,
    }]);

    expect(manifest.playlists['7']).toEqual(expect.objectContaining({
      status: 'partial',
      failures: [{
        trackId: '71',
        code: 'network-timeout',
        retryable: true,
        failedAt: secondTime,
      }],
      completedAt: null,
    }));
    expect(offlinePlaylistViews(manifest)[0]).toEqual(expect.objectContaining({
      downloadedOccurrences: 2,
      failedOccurrences: 1,
      pendingOccurrences: 0,
      failedTrackIds: ['71'],
      sizeBytes: 700,
    }));

    manifest = beginPlaylistDownload(manifest, source, thirdTime);
    expect(manifest.playlists['7'].failures[0]?.failedAt).toBe(secondTime);
    manifest = attachDownloadedTrack(manifest, source.id, source.tracks[1], 710, thirdTime);
    manifest = settlePlaylistDownload(manifest, source, thirdTime);
    expect(manifest.playlists['7']).toEqual(expect.objectContaining({
      status: 'complete',
      failures: [],
      completedAt: thirdTime,
    }));
  });

  it('deduplicates shared audio while retaining bidirectional playlist ownership and refcounts', () => {
    const shared = track('42');
    const first = playlist(1, 'First', [shared, track('43')]);
    const second = playlist(2, 'Second', [shared]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), first, firstTime);
    manifest = attachDownloadedTrack(manifest, first.id, shared, 1_000, firstTime);
    manifest = attachDownloadedTrack(manifest, first.id, first.tracks[1], 2_000, firstTime);
    manifest = settlePlaylistDownload(manifest, first, firstTime);
    manifest = beginPlaylistDownload(manifest, second, secondTime);
    manifest = attachDownloadedTrack(manifest, second.id, shared, 1_000, secondTime);
    manifest = settlePlaylistDownload(manifest, second, secondTime);

    expect(manifest.tracks['42'].ownerPlaylistIds).toEqual(['1', '2']);
    expect(offlineStorageBytes(manifest)).toBe(3_000);
    expect(offlinePlaylistViews(manifest)).toEqual([
      expect.objectContaining({ id: '2', status: 'complete', sizeBytes: 1_000 }),
      expect.objectContaining({ id: '1', status: 'complete', sizeBytes: 3_000 }),
    ]);

    const removedFirst = removePlaylistDownload(manifest, 1);
    expect(removedFirst.orphanedFiles).toEqual(['43.mp3']);
    expect(removedFirst.manifest.tracks['42'].ownerPlaylistIds).toEqual(['2']);
    const removedSecond = removePlaylistDownload(removedFirst.manifest, 2);
    expect(removedSecond.orphanedFiles).toEqual(['42.mp3']);
    expect(removedSecond.manifest.tracks).toEqual({});
  });

  it('treats exact ordered source IDs, including duplicate count, as the immutable version', () => {
    const source = playlist(6, 'Original', [track('60'), track('61'), track('60')]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);

    expect(() => beginPlaylistDownload(
      manifest,
      playlist(6, 'Reordered', [track('61'), track('60'), track('60')]),
      secondTime,
    )).toThrow('Remove the changed offline playlist snapshot');
    expect(() => beginPlaylistDownload(
      manifest,
      playlist(6, 'Duplicate removed', [track('60'), track('61')]),
      secondTime,
    )).toThrow('Remove the changed offline playlist snapshot');
    expect(() => settlePlaylistDownload(
      manifest,
      playlist(6, 'Different settlement', [track('60'), track('60'), track('61')]),
      secondTime,
    )).toThrow('does not match the pending snapshot');

    manifest = beginPlaylistDownload(
      manifest,
      { ...source, name: 'Metadata may refresh without changing ID version' },
      secondTime,
    );
    expect(manifest.playlists['6'].name).toBe('Metadata may refresh without changing ID version');
    const removed = removePlaylistDownload(manifest, 6).manifest;
    expect(() => beginPlaylistDownload(
      removed,
      playlist(6, 'Replacement', [track('62')]),
      thirdTime,
    )).not.toThrow();
  });

  it('records missing versus corrupt file evidence during reconciliation without losing source data', () => {
    const source = playlist(3, 'Reconcile', [track('30'), track('31')]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    manifest = attachDownloadedTrack(manifest, 3, source.tracks[0], 300, firstTime);
    manifest = attachDownloadedTrack(manifest, 3, source.tracks[1], 310, firstTime);
    manifest = settlePlaylistDownload(manifest, source, firstTime);

    const reconciled = reconcileOfflineManifest(manifest, { '30.mp3': 333 }, secondTime);
    expect(reconciled.tracks).toEqual({});
    expect(reconciled.playlists['3']).toEqual(expect.objectContaining({
      name: 'Reconcile',
      sourceTrackIds: ['30', '31'],
      status: 'partial',
      completedAt: null,
      updatedAt: secondTime,
      failures: [
        { trackId: '30', code: 'file-integrity', retryable: true, failedAt: secondTime },
        { trackId: '31', code: 'file-missing', retryable: true, failedAt: secondTime },
      ],
    }));
    expect(reconciled.playlists['3'].sourceTracks.map(({ track: value }) => value.title)).toEqual([
      'Track 30',
      'Track 31',
    ]);

    const stable = reconcileOfflineManifest(reconciled, {}, thirdTime);
    expect(stable.playlists['3'].failures).toEqual(reconciled.playlists['3'].failures);
    expect(stable.playlists['3'].updatedAt).toBe(secondTime);
  });

  it('preserves native interrupted and invalid-file reasons during cold reconciliation', () => {
    const source = playlist(3, 'Native evidence', [track('30'), track('31')]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    manifest = attachDownloadedTrack(manifest, 3, source.tracks[0], 300, firstTime);

    const reconciled = reconcileOfflineManifest(manifest, {}, secondTime, {
      invalidTrackIds: ['30'],
      interruptedTrackIds: ['31'],
    });

    expect(reconciled.playlists['3'].failures).toEqual([
      { trackId: '30', code: 'file-integrity', retryable: true, failedAt: secondTime },
      { trackId: '31', code: 'download-interrupted', retryable: true, failedAt: secondTime },
    ]);
  });

  it('rejects duplicate, unrelated, or contradictory structured settlement failures', () => {
    const source = playlist(8, 'Failures', [track('80'), track('81')]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    manifest = attachDownloadedTrack(manifest, 8, source.tracks[0], 800, firstTime);

    expect(() => settlePlaylistDownload(manifest, source, secondTime, [
      { trackId: '81', code: 'network-timeout', retryable: true },
      { trackId: '81', code: 'http-error', retryable: true },
    ])).toThrow('must not contain duplicates');
    expect(() => settlePlaylistDownload(manifest, source, secondTime, [
      { trackId: '99', code: 'http-error', retryable: true },
    ])).toThrow('unrelated failure');
    expect(() => settlePlaylistDownload(manifest, source, secondTime, [
      { trackId: '80', code: 'http-error', retryable: true },
    ])).toThrow('failed a downloaded track');
    expect(() => settlePlaylistDownload(manifest, source, secondTime, [
      { trackId: '81', code: 'Bad Code', retryable: true },
    ])).toThrow('code is invalid');

    manifest = settlePlaylistDownload(manifest, source, secondTime);
    expect(manifest.playlists['8'].failures).toEqual([{
      trackId: '81',
      code: 'download-incomplete',
      retryable: true,
      failedAt: secondTime,
    }]);
  });

  it('requires source-bound metadata, canonical ownership, and one physical size per deduplicated ID', () => {
    const shared = track('42');
    const first = playlist(1, 'First', [shared]);
    const second = playlist(2, 'Second', [shared]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), first, firstTime);
    manifest = attachDownloadedTrack(manifest, first.id, shared, 420, firstTime);
    manifest = settlePlaylistDownload(manifest, first, firstTime);
    manifest = beginPlaylistDownload(manifest, second, secondTime);

    expect(() => attachDownloadedTrack(manifest, 99, shared, 420, secondTime)).toThrow(
      'unknown offline playlist',
    );
    expect(() => attachDownloadedTrack(manifest, second.id, track('99'), 990, secondTime)).toThrow(
      'unrelated',
    );
    expect(() => attachDownloadedTrack(
      manifest,
      second.id,
      { ...shared, title: 'Metadata injection' },
      420,
      secondTime,
    )).toThrow('metadata does not match');
    expect(() => attachDownloadedTrack(manifest, second.id, shared, 421, secondTime)).toThrow(
      'size conflicts',
    );

    const settledWithoutOwnership = settlePlaylistDownload(manifest, second, secondTime);
    expect(settledWithoutOwnership.playlists['2'].failures).toEqual([expect.objectContaining({
      trackId: '42',
      code: 'download-incomplete',
    })]);
  });

  it('strictly rejects malformed versions, fields, occurrences, failures, and cross-owner state', () => {
    const source = playlist(4, 'Stored', [track('40'), track('40')]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    manifest = attachDownloadedTrack(manifest, 4, source.tracks[0], 400, firstTime);
    manifest = settlePlaylistDownload(manifest, source, firstTime);
    expect(decodeOfflineManifest(JSON.stringify(manifest), scope)).toEqual(manifest);
    expect(() => decodeOfflineManifest(JSON.stringify(manifest), 'other::user')).toThrow(
      'another account scope',
    );

    const oldVersion = structuredClone(manifest) as unknown as Record<string, unknown>;
    oldVersion.version = 1;
    expect(() => decodeOfflineManifest(JSON.stringify(oldVersion), scope)).toThrow(
      'unsupported version',
    );
    const extraField = structuredClone(manifest) as unknown as Record<string, unknown>;
    extraField.token = 'must never be accepted';
    expect(() => decodeOfflineManifest(JSON.stringify(extraField), scope)).toThrow(
      'unexpected fields',
    );

    const wrongOccurrence = structuredClone(manifest);
    wrongOccurrence.playlists['4'].sourceTracks[1].position = 0;
    expect(() => decodeOfflineManifest(JSON.stringify(wrongOccurrence), scope)).toThrow(
      'source occurrence order is invalid',
    );
    const wrongSource = structuredClone(manifest);
    wrongSource.playlists['4'].sourceTracks[1].track = track('41');
    expect(() => decodeOfflineManifest(JSON.stringify(wrongSource), scope)).toThrow(
      'source metadata does not match its ordered IDs',
    );
    const duplicateFailure = structuredClone(manifest);
    duplicateFailure.playlists['4'].status = 'partial';
    duplicateFailure.playlists['4'].completedAt = null;
    duplicateFailure.playlists['4'].failures = [
      { trackId: '40', code: 'file-missing', retryable: true, failedAt: secondTime },
      { trackId: '40', code: 'file-missing', retryable: true, failedAt: secondTime },
    ];
    expect(() => decodeOfflineManifest(JSON.stringify(duplicateFailure), scope)).toThrow(
      'must not contain duplicates',
    );

    const duplicateOwner = structuredClone(manifest);
    duplicateOwner.tracks['40'].ownerPlaylistIds.push('4');
    expect(() => decodeOfflineManifest(JSON.stringify(duplicateOwner), scope)).toThrow(
      'must not contain duplicates',
    );
    const unknownOwner = structuredClone(manifest);
    unknownOwner.tracks['40'].ownerPlaylistIds = ['99'];
    expect(() => decodeOfflineManifest(JSON.stringify(unknownOwner), scope)).toThrow(
      'unknown playlist owner',
    );
    const contradictoryFailure = structuredClone(manifest);
    contradictoryFailure.playlists['4'].status = 'partial';
    contradictoryFailure.playlists['4'].completedAt = null;
    contradictoryFailure.playlists['4'].failures = [
      { trackId: '40', code: 'file-missing', retryable: true, failedAt: secondTime },
    ];
    expect(() => decodeOfflineManifest(JSON.stringify(contradictoryFailure), scope)).toThrow(
      'failure for downloaded audio',
    );

    const unsafe = structuredClone(manifest);
    unsafe.tracks['40'].fileName = '../session';
    expect(() => decodeOfflineManifest(JSON.stringify(unsafe), scope)).toThrow('unsafe file name');
    const nonCanonicalTime = structuredClone(manifest);
    nonCanonicalTime.tracks['40'].downloadedAt = '2026-07-16T12:00:00Z';
    expect(() => decodeOfflineManifest(JSON.stringify(nonCanonicalTime), scope)).toThrow(
      'canonical ISO timestamp',
    );
    expect(() => decodeOfflineManifest('{broken', scope)).toThrow('not valid JSON');
  });
});
