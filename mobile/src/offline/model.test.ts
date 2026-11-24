import { describe, expect, it } from 'vitest';
import { decodeTrack } from '../api/decoders';
import type { Playlist, Track } from '../api/types';
import {
  OFFLINE_MANIFEST_VERSION,
  attachDownloadedTrack,
  attachIndividualDownloadedTrack,
  beginPlaylistDownload,
  createEmptyOfflineManifest,
  decodeOfflineManifest,
  offlineManifestStorageKey,
  offlinePlaylistViews,
  offlineStorageBytes,
  offlineTrackFileName,
  reconcileOfflineManifest,
  removeIndividualDownload,
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
    owner_id: null,
    owner_name: 'Remote owner',
    owner_avatar_url: null,
    is_collaborative: false,
    is_collaborator: false,
    can_edit_tracks: false,
    collaborators: [],
    collaborator_count: 0,
    revision: 0,
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

  it('keeps individual track ownership independent from playlist references', () => {
    const shared = track('42');
    const source = playlist(1, 'First', [shared]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    manifest = attachDownloadedTrack(manifest, source.id, shared, 1_000, firstTime);
    manifest = settlePlaylistDownload(manifest, source, firstTime);
    manifest = attachIndividualDownloadedTrack(manifest, shared, 1_000, secondTime);

    expect(manifest.tracks['42']).toEqual(expect.objectContaining({
      ownerPlaylistIds: ['1'],
      individualDownload: true,
    }));

    const playlistRemoved = removePlaylistDownload(manifest, source.id);
    expect(playlistRemoved.orphanedFiles).toEqual([]);
    expect(playlistRemoved.manifest.tracks['42']).toEqual(expect.objectContaining({
      ownerPlaylistIds: [],
      individualDownload: true,
    }));

    const individualRemoved = removeIndividualDownload(playlistRemoved.manifest, shared.id);
    expect(individualRemoved.orphanedFiles).toEqual(['42.mp3']);
    expect(individualRemoved.manifest.tracks).toEqual({});
  });

  it('upgrades legacy playlist-owned entries with explicit individual ownership disabled', () => {
    const source = playlist(1, 'Legacy', [track('42')]);
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    manifest = attachDownloadedTrack(manifest, source.id, source.tracks[0], 1_000, firstTime);
    manifest = settlePlaylistDownload(manifest, source, firstTime);
    const legacy = JSON.parse(JSON.stringify(manifest)) as {
      tracks: Record<string, { individualDownload?: boolean }>;
    };
    delete legacy.tracks['42'].individualDownload;

    expect(decodeOfflineManifest(JSON.stringify(legacy), scope).tracks['42'])
      .toEqual(expect.objectContaining({ individualDownload: false }));
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

/**
 * The API serialises the three loudness fields on every track, usually as
 * null. These fixtures mirror what a live response looks like after
 * `decodeTrack`, which is the only shape a real download ever receives.
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

describe.each(loudnessWireShapes)(
  'offline manifest with $shape loudness metadata from the wire',
  ({ loudness }) => {
    it('attaches an individually downloaded track and round-trips the manifest', () => {
      const source = wireTrack('42', loudness);
      const manifest = attachIndividualDownloadedTrack(
        createEmptyOfflineManifest(scope),
        source,
        4_096,
        firstTime,
      );

      expect(manifest.tracks['42'].track).toEqual({ ...track('42'), ...loudness });
      expect(Object.keys(manifest.tracks['42'].track).sort()).toEqual(
        Object.keys({ ...track('42'), ...loudness }).sort(),
      );
      const decoded = decodeOfflineManifest(JSON.stringify(manifest), scope);
      expect(decoded).toEqual(manifest);
      expect(JSON.stringify(decoded)).toBe(JSON.stringify(manifest));
    });

    it('snapshots, attaches, settles and round-trips a playlist download', () => {
      const source = playlist(7, 'Wire shaped', [
        wireTrack('70', loudness),
        wireTrack('71', loudness),
        wireTrack('70', loudness),
      ]);
      let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
      manifest = attachDownloadedTrack(manifest, source.id, source.tracks[0], 700, firstTime);
      manifest = attachDownloadedTrack(manifest, source.id, source.tracks[1], 710, firstTime);
      manifest = settlePlaylistDownload(manifest, source, secondTime);

      expect(manifest.playlists['7'].status).toBe('complete');
      expect(manifest.playlists['7'].sourceTracks.map(({ track: value }) => value)).toEqual([
        { ...track('70'), ...loudness },
        { ...track('71'), ...loudness },
        { ...track('70'), ...loudness },
      ]);
      expect(manifest.tracks['70'].track).toEqual({ ...track('70'), ...loudness });
      const decoded = decodeOfflineManifest(JSON.stringify(manifest), scope);
      expect(decoded).toEqual(manifest);
      expect(JSON.stringify(decoded)).toBe(JSON.stringify(manifest));

      const reconciled = reconcileOfflineManifest(
        decoded,
        { '70.mp3': 700, '71.mp3': 710 },
        thirdTime,
      );
      expect(reconciled).toEqual(manifest);
    });

    it('keeps playlist entry identity next to the loudness metadata', () => {
      const entry = decodeTrack({ ...track('70'), ...loudness, playlist_entry_id: 5 });
      const source = playlist(7, 'Entry identity', [entry]);
      let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
      manifest = attachDownloadedTrack(manifest, source.id, entry, 700, firstTime);
      manifest = settlePlaylistDownload(manifest, source, firstTime);

      expect(manifest.playlists['7'].sourceTracks[0].track).toEqual({
        ...track('70'),
        ...loudness,
        playlist_entry_id: 5,
      });
      expect(decodeOfflineManifest(JSON.stringify(manifest), scope)).toEqual(manifest);
    });
  },
);

describe('offline manifest loudness compatibility', () => {
  const nulls = { loudness_gain_db: null, loudness_lufs: null, loudness_peak: null };

  /** Hand-written to pin the persisted shape from before loudness keys were accepted. */
  function legacyManifestJson(): string {
    const legacyTrack = {
      id: '42',
      title: 'Track 42',
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
    return JSON.stringify({
      version: 2,
      scope,
      tracks: {
        '42': {
          track: legacyTrack,
          fileName: '42.mp3',
          sizeBytes: 1_000,
          ownerPlaylistIds: ['1'],
          individualDownload: true,
          downloadedAt: firstTime,
        },
      },
      playlists: {
        '1': {
          id: '1',
          name: 'Legacy',
          description: null,
          cover_url: null,
          is_public: false,
          is_owner: true,
          owner_name: null,
          sourceTrackIds: ['42', '43'],
          sourceTracks: [
            { position: 0, track: legacyTrack },
            { position: 1, track: { ...legacyTrack, id: '43', title: 'Track 43' } },
          ],
          status: 'partial',
          failures: [{ trackId: '43', code: 'network', retryable: true, failedAt: firstTime }],
          completedAt: null,
          updatedAt: firstTime,
        },
      },
    });
  }

  it('still decodes a manifest persisted without loudness keys, byte for byte', () => {
    const raw = legacyManifestJson();
    expect(raw).not.toContain('loudness');

    const decoded = decodeOfflineManifest(raw, scope);

    expect(JSON.stringify(decoded)).toBe(raw);
    expect(decoded.tracks['42'].track).toEqual(track('42'));
    expect(Object.keys(decoded.tracks['42'].track)).not.toContain('loudness_gain_db');
    expect(reconcileOfflineManifest(decoded, { '42.mp3': 1_000 }, secondTime)).toEqual(decoded);
  });

  it('retries an old snapshot with wire-shaped tracks and adds new downloads beside it', () => {
    const old = decodeOfflineManifest(legacyManifestJson(), scope);
    const source = { id: 1, name: 'Legacy', tracks: [wireTrack('42', nulls), wireTrack('43', nulls)] };

    let manifest = beginPlaylistDownload(old, source, secondTime);
    manifest = attachDownloadedTrack(manifest, 1, source.tracks[1], 2_000, secondTime);
    manifest = settlePlaylistDownload(manifest, source, secondTime);
    manifest = attachIndividualDownloadedTrack(manifest, wireTrack('44', nulls), 3_000, secondTime);

    expect(manifest.playlists['1'].status).toBe('complete');
    expect(manifest.playlists['1'].sourceTracks[0].track).toEqual({ ...track('42'), ...nulls });
    expect(manifest.tracks['43'].track).toEqual({ ...track('43'), ...nulls });
    // The deduplicated file entry keeps the metadata it was downloaded with.
    expect(manifest.tracks['42'].track).toEqual(track('42'));
    expect(decodeOfflineManifest(JSON.stringify(manifest), scope)).toEqual(manifest);
  });

  it('matches a downloaded track against its snapshot regardless of key order', () => {
    const numeric = { loudness_gain_db: -6.5, loudness_lufs: -9.25, loudness_peak: 0.98 };
    const source = playlist(7, 'Reordered', [wireTrack('70', numeric)]);
    const manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    // A track recovered from the native queue arrives with its keys in another order.
    const { loudness_peak: peak, ...rest } = wireTrack('70', numeric);
    const reordered: Track = { loudness_peak: peak, ...rest };

    expect(Object.keys(reordered)[0]).toBe('loudness_peak');
    expect(() => attachDownloadedTrack(manifest, 7, reordered, 700, firstTime)).not.toThrow();
    expect(() => attachDownloadedTrack(
      manifest,
      7,
      { ...reordered, loudness_gain_db: -1 },
      700,
      firstTime,
    )).toThrow('metadata does not match');
  });

  it('still rejects unknown track fields and malformed loudness values', () => {
    const empty = createEmptyOfflineManifest(scope);
    const source = wireTrack('42', nulls);

    expect(() => attachIndividualDownloadedTrack(
      empty,
      { ...source, loudness_extra: 1 } as Track,
      4_096,
      firstTime,
    )).toThrow('Individually downloaded track has unexpected fields');
    expect(() => beginPlaylistDownload(
      empty,
      { id: 4, name: 'Unknown field', tracks: [{ ...source, token: 'x' } as Track] },
      firstTime,
    )).toThrow('Offline source track 0 has unexpected fields');
    expect(() => attachIndividualDownloadedTrack(
      empty,
      { ...source, loudness_lufs: '-9' } as unknown as Track,
      4_096,
      firstTime,
    )).toThrow('loudness_lufs must be a finite number');

    const stored = attachIndividualDownloadedTrack(empty, source, 4_096, firstTime);
    const malformed = JSON.parse(JSON.stringify(stored)) as {
      tracks: Record<string, { track: Record<string, unknown> }>;
    };
    malformed.tracks['42'].track.loudness_peak = 'loud';
    expect(() => decodeOfflineManifest(JSON.stringify(malformed), scope)).toThrow(
      'loudness_peak must be a finite number',
    );
    const unknown = JSON.parse(JSON.stringify(stored)) as typeof malformed;
    unknown.tracks['42'].track.radar_reason = null;
    expect(() => decodeOfflineManifest(JSON.stringify(unknown), scope)).toThrow(
      'Offline track 42 metadata has unexpected fields',
    );
  });

  it('round-trips collaborative playlist metadata and track added_by/added_at fields', () => {
    const attributed: Track = {
      ...track('88'),
      playlist_entry_id: 12,
      added_by: { id: 3, display_name: 'Jule', avatar_url: null },
      added_at: '2026-11-24T09:00:00Z',
    };
    const source: Playlist = {
      ...playlist(9, 'Collab Mix', [attributed]),
      owner_id: 3,
      owner_avatar_url: '/api/users/3/avatar',
      is_collaborative: true,
      is_collaborator: true,
      can_edit_tracks: true,
      collaborator_count: 2,
    };
    let manifest = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, firstTime);
    manifest = attachDownloadedTrack(manifest, source.id, attributed, 8_000, firstTime);
    manifest = settlePlaylistDownload(manifest, source, firstTime);

    const encoded = JSON.stringify(manifest);
    const decoded = decodeOfflineManifest(encoded, scope);
    expect(decoded).toEqual(manifest);
    expect(JSON.stringify(decoded)).toBe(encoded);
    expect(decoded.playlists['9']).toMatchObject({
      owner_id: 3,
      owner_avatar_url: '/api/users/3/avatar',
      is_collaborative: true,
      is_collaborator: true,
      collaborator_count: 2,
    });
    expect(decoded.playlists['9'].sourceTracks[0].track.added_by).toEqual({
      id: 3,
      display_name: 'Jule',
      avatar_url: null,
    });
  });
});
