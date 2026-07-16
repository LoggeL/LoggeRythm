import type { Playlist, Track } from '../api/types';
import { decodeTrack } from '../api/decoders';

export const OFFLINE_MANIFEST_VERSION = 2 as const;

const FAILURE_CODE = /^[a-z][a-z0-9-]{1,63}$/;

export type OfflinePlaylistStatus = 'complete' | 'partial';

/** One source occurrence. `position` makes repeated track IDs unambiguous. */
export interface OfflineSourceTrackOccurrence {
  position: number;
  track: Track;
}

export interface OfflineTrackFailure {
  trackId: string;
  code: string;
  retryable: boolean;
  failedAt: string;
}

export interface OfflineTrackFailureInput {
  trackId: string;
  code: string;
  retryable: boolean;
}

export interface OfflineTrackEntry {
  track: Track;
  fileName: string;
  sizeBytes: number;
  ownerPlaylistIds: string[];
  downloadedAt: string;
}

export interface OfflinePlaylistEntry {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  is_owner: boolean;
  owner_name: string | null;
  /**
   * The exact, ordered source IDs are the authoritative snapshot version.
   * Do not replace this array in place when the remote playlist changes.
   */
  sourceTrackIds: string[];
  /** Exact source metadata aligned one-to-one with `sourceTrackIds`. */
  sourceTracks: OfflineSourceTrackOccurrence[];
  status: OfflinePlaylistStatus;
  failures: OfflineTrackFailure[];
  completedAt: string | null;
  updatedAt: string;
}

export interface OfflineManifest {
  version: typeof OFFLINE_MANIFEST_VERSION;
  scope: string;
  tracks: Record<string, OfflineTrackEntry>;
  playlists: Record<string, OfflinePlaylistEntry>;
}

export interface OfflineReconciliationEvidence {
  invalidTrackIds?: readonly string[];
  interruptedTrackIds?: readonly string[];
}

export interface OfflinePlaylistView extends OfflinePlaylistEntry {
  downloadedOccurrences: number;
  failedOccurrences: number;
  pendingOccurrences: number;
  totalOccurrences: number;
  sizeBytes: number;
  failedTrackIds: string[];
  pendingTrackIds: string[];
}

type OfflinePlaylistSource = Pick<Playlist, 'id' | 'name' | 'tracks'>
  & Partial<Pick<
    Playlist,
    'description' | 'cover_url' | 'is_public' | 'is_owner' | 'owner_name'
  >>;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unexpected fields`);
  }
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

/** Deezer identities are positive decimal path segments in every supported source. */
export function offlineTrackId(value: unknown): string {
  const id = nonEmpty(value, 'Offline track id');
  if (!/^[1-9][0-9]{0,31}$/.test(id)) {
    throw new Error('Offline track id must be a positive decimal Deezer id');
  }
  return id;
}

export function offlinePlaylistId(value: unknown): string {
  const id = nonEmpty(String(value), 'Offline playlist id');
  if (!/^[0-9]{1,16}$/.test(id) || /^0+$/.test(id)) {
    throw new Error('Offline playlist id must be a positive decimal id');
  }
  return id;
}

export function offlineTrackFileName(trackId: unknown): string {
  return `${offlineTrackId(trackId)}.mp3`;
}

export function offlineManifestStorageKey(accountScope: string): string {
  return `lr.offline-downloads.v2:${encodeURIComponent(nonEmpty(accountScope, 'Offline account scope'))}`;
}

export function createEmptyOfflineManifest(accountScope: string): OfflineManifest {
  return {
    version: OFFLINE_MANIFEST_VERSION,
    scope: nonEmpty(accountScope, 'Offline account scope'),
    tracks: {},
    playlists: {},
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function requireUnique(values: readonly string[], label: string): string[] {
  if (new Set(values).size !== values.length) throw new Error(`${label} must not contain duplicates`);
  return [...values];
}

function isoTimestamp(value: unknown, label: string): string {
  const timestamp = nonEmpty(value, label);
  const epoch = Date.parse(timestamp);
  if (Number.isNaN(epoch) || new Date(epoch).toISOString() !== timestamp) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function positiveSize(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive byte count`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function failureCode(value: unknown, label: string): string {
  const code = nonEmpty(value, label);
  if (!FAILURE_CODE.test(code)) throw new Error(`${label} is invalid`);
  return code;
}

function decodeStrictTrack(value: unknown, label: string): Track {
  const record = object(value, label);
  const keys = [
    'id',
    'title',
    'artist',
    'artist_id',
    'artists',
    'album',
    'album_id',
    'cover',
    'duration_sec',
    'preview_url',
    'rank',
    'release_date',
  ];
  // Offline manifest v2 predates stable playlist-entry identity. Preserve it
  // for new playlist snapshots while continuing to decode existing manifests.
  if ('playlist_entry_id' in record) keys.push('playlist_entry_id');
  exactKeys(record, keys, label);
  if (!Array.isArray(record.artists)) throw new Error(`${label}.artists must be an array`);
  record.artists.forEach((artist, index) => {
    exactKeys(object(artist, `${label}.artists[${index}]`), ['id', 'name'], `${label}.artists[${index}]`);
  });
  const track = decodeTrack(record, label);
  offlineTrackId(track.id);
  return track;
}

function tracksEqual(left: Track, right: Track): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function decodeFailure(value: unknown, label: string): OfflineTrackFailure {
  const record = object(value, label);
  exactKeys(record, ['trackId', 'code', 'retryable', 'failedAt'], label);
  return {
    trackId: offlineTrackId(record.trackId),
    code: failureCode(record.code, `${label} code`),
    retryable: boolean(record.retryable, `${label} retryable`),
    failedAt: isoTimestamp(record.failedAt, `${label} timestamp`),
  };
}

function decodeFailureInput(value: unknown, label: string): OfflineTrackFailureInput {
  const record = object(value, label);
  exactKeys(record, ['trackId', 'code', 'retryable'], label);
  return {
    trackId: offlineTrackId(record.trackId),
    code: failureCode(record.code, `${label} code`),
    retryable: boolean(record.retryable, `${label} retryable`),
  };
}

function decodeTrackEntry(key: string, value: unknown): OfflineTrackEntry {
  const record = object(value, `Offline track ${key}`);
  exactKeys(
    record,
    ['track', 'fileName', 'sizeBytes', 'ownerPlaylistIds', 'downloadedAt'],
    `Offline track ${key}`,
  );
  const track = decodeStrictTrack(record.track, `Offline track ${key} metadata`);
  const id = offlineTrackId(track.id);
  if (id !== key) throw new Error(`Offline track key ${key} does not match its payload`);
  const fileName = nonEmpty(record.fileName, `Offline track ${key} file`);
  if (fileName !== offlineTrackFileName(id)) {
    throw new Error(`Offline track ${key} has an unsafe file name`);
  }
  if (!Array.isArray(record.ownerPlaylistIds)) {
    throw new Error(`Offline track ${key} owners must be an array`);
  }
  const ownerPlaylistIds = requireUnique(
    record.ownerPlaylistIds.map((owner) => offlinePlaylistId(owner)),
    `Offline track ${key} owners`,
  );
  if (ownerPlaylistIds.length === 0) {
    throw new Error(`Offline track ${key} must have at least one playlist owner`);
  }
  return {
    track,
    fileName,
    sizeBytes: positiveSize(record.sizeBytes, `Offline track ${key} size`),
    ownerPlaylistIds,
    downloadedAt: isoTimestamp(record.downloadedAt, `Offline track ${key} timestamp`),
  };
}

function decodePlaylistEntry(key: string, value: unknown): OfflinePlaylistEntry {
  const record = object(value, `Offline playlist ${key}`);
  exactKeys(record, [
    'id',
    'name',
    'description',
    'cover_url',
    'is_public',
    'is_owner',
    'owner_name',
    'sourceTrackIds',
    'sourceTracks',
    'status',
    'failures',
    'completedAt',
    'updatedAt',
  ], `Offline playlist ${key}`);
  const id = offlinePlaylistId(record.id);
  if (id !== key) throw new Error(`Offline playlist key ${key} does not match its payload`);
  if (!Array.isArray(record.sourceTrackIds) || record.sourceTrackIds.length === 0) {
    throw new Error(`Offline playlist ${key} must contain source tracks`);
  }
  const sourceTrackIds = record.sourceTrackIds.map(offlineTrackId);
  if (!Array.isArray(record.sourceTracks) || record.sourceTracks.length !== sourceTrackIds.length) {
    throw new Error(`Offline playlist ${key} source metadata is not occurrence-aligned`);
  }
  const sourceTracks = record.sourceTracks.map((value, index) => {
    const occurrence = object(value, `Offline playlist ${key} occurrence ${index}`);
    exactKeys(
      occurrence,
      ['position', 'track'],
      `Offline playlist ${key} occurrence ${index}`,
    );
    const position = nonNegativeInteger(
      occurrence.position,
      `Offline playlist ${key} occurrence ${index} position`,
    );
    if (position !== index) {
      throw new Error(`Offline playlist ${key} source occurrence order is invalid`);
    }
    const track = decodeStrictTrack(
      occurrence.track,
      `Offline playlist ${key} occurrence ${index} track`,
    );
    if (offlineTrackId(track.id) !== sourceTrackIds[index]) {
      throw new Error(`Offline playlist ${key} source metadata does not match its ordered IDs`);
    }
    return { position, track };
  });
  if (!Array.isArray(record.failures)) {
    throw new Error(`Offline playlist ${key} failures must be an array`);
  }
  const failures = record.failures.map((failure, index) =>
    decodeFailure(failure, `Offline playlist ${key} failure ${index}`));
  requireUnique(failures.map((failure) => failure.trackId), `Offline playlist ${key} failures`);
  const expectedIds = new Set(sourceTrackIds);
  if (failures.some((failure) => !expectedIds.has(failure.trackId))) {
    throw new Error(`Offline playlist ${key} has an unrelated failed track`);
  }
  const status = record.status;
  if (status !== 'complete' && status !== 'partial') {
    throw new Error(`Offline playlist ${key} has an invalid status`);
  }
  const completedAt = record.completedAt;
  if (status === 'complete' && typeof completedAt !== 'string') {
    throw new Error(`Complete offline playlist ${key} needs a completion timestamp`);
  }
  if (status === 'partial' && completedAt !== null) {
    throw new Error(`Partial offline playlist ${key} cannot be marked complete`);
  }
  if (status === 'complete' && failures.length > 0) {
    throw new Error(`Complete offline playlist ${key} cannot contain failures`);
  }
  return {
    id,
    name: nonEmpty(record.name, `Offline playlist ${key} name`),
    description: nullableString(record.description, `Offline playlist ${key} description`),
    cover_url: nullableString(record.cover_url, `Offline playlist ${key} cover`),
    is_public: boolean(record.is_public, `Offline playlist ${key} visibility`),
    is_owner: boolean(record.is_owner, `Offline playlist ${key} ownership`),
    owner_name: nullableString(record.owner_name, `Offline playlist ${key} owner name`),
    sourceTrackIds,
    sourceTracks,
    status,
    failures,
    completedAt:
      completedAt === null ? null : isoTimestamp(completedAt, `Offline playlist ${key} completion`),
    updatedAt: isoTimestamp(record.updatedAt, `Offline playlist ${key} update`),
  };
}

export function decodeOfflineManifest(raw: string | null, expectedScope: string): OfflineManifest {
  const scope = nonEmpty(expectedScope, 'Offline account scope');
  if (raw === null) return createEmptyOfflineManifest(scope);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Offline download manifest is not valid JSON');
  }
  const record = object(value, 'Offline download manifest');
  exactKeys(record, ['version', 'scope', 'tracks', 'playlists'], 'Offline download manifest');
  if (record.version !== OFFLINE_MANIFEST_VERSION) {
    throw new Error('Offline download manifest has an unsupported version');
  }
  if (record.scope !== scope) {
    throw new Error('Offline download manifest belongs to another account scope');
  }
  const rawTracks = object(record.tracks, 'Offline download manifest tracks');
  const rawPlaylists = object(record.playlists, 'Offline download manifest playlists');
  const tracks = Object.fromEntries(
    Object.entries(rawTracks).map(([key, entry]) => {
      const id = offlineTrackId(key);
      return [id, decodeTrackEntry(id, entry)];
    }),
  );
  const playlists = Object.fromEntries(
    Object.entries(rawPlaylists).map(([key, entry]) => {
      const id = offlinePlaylistId(key);
      return [id, decodePlaylistEntry(id, entry)];
    }),
  );
  for (const [id, track] of Object.entries(tracks)) {
    for (const owner of track.ownerPlaylistIds) {
      const playlist = playlists[owner];
      if (playlist === undefined) {
        throw new Error(`Offline track ${id} references an unknown playlist owner`);
      }
      if (!playlist.sourceTrackIds.includes(id)) {
        throw new Error(`Offline track ${id} is unrelated to playlist owner ${owner}`);
      }
    }
  }
  for (const playlist of Object.values(playlists)) {
    const missing = unique(playlist.sourceTrackIds.filter((trackId) =>
      !tracks[trackId]?.ownerPlaylistIds.includes(playlist.id)));
    const missingSet = new Set(missing);
    if (playlist.failures.some((failure) => !missingSet.has(failure.trackId))) {
      throw new Error(`Offline playlist ${playlist.id} records a failure for downloaded audio`);
    }
    if (playlist.status === 'complete' && missing.length > 0) {
      throw new Error(`Complete offline playlist ${playlist.id} has an unverified track`);
    }
  }
  return { version: OFFLINE_MANIFEST_VERSION, scope, tracks, playlists };
}

function playlistSnapshot(source: OfflinePlaylistSource): OfflinePlaylistEntry {
  const id = offlinePlaylistId(source.id);
  if (!Array.isArray(source.tracks) || source.tracks.length === 0) {
    throw new Error('An empty playlist cannot be downloaded');
  }
  const sourceTracks = source.tracks.map((value, position) => ({
    position,
    track: decodeStrictTrack(value, `Offline source track ${position}`),
  }));
  return {
    id,
    name: nonEmpty(source.name, 'Offline playlist name'),
    description: source.description === undefined
      ? null
      : nullableString(source.description, 'Offline playlist description'),
    cover_url: source.cover_url === undefined
      ? null
      : nullableString(source.cover_url, 'Offline playlist cover'),
    is_public: source.is_public === undefined
      ? false
      : boolean(source.is_public, 'Offline playlist visibility'),
    is_owner: source.is_owner === undefined
      ? false
      : boolean(source.is_owner, 'Offline playlist ownership'),
    owner_name: source.owner_name === undefined
      ? null
      : nullableString(source.owner_name, 'Offline playlist owner name'),
    sourceTrackIds: sourceTracks.map(({ track }) => offlineTrackId(track.id)),
    sourceTracks,
    status: 'partial',
    failures: [],
    completedAt: null,
    updatedAt: '',
  };
}

function sameOrderedIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function trackOwnedByPlaylist(
  manifest: OfflineManifest,
  playlistId: string,
  trackId: string,
): boolean {
  return manifest.tracks[trackId]?.ownerPlaylistIds.includes(playlistId) ?? false;
}

export function attachDownloadedTrack(
  manifest: OfflineManifest,
  playlistIdValue: unknown,
  trackValue: Track,
  sizeBytes: number,
  downloadedAt: string,
): OfflineManifest {
  const playlistId = offlinePlaylistId(playlistIdValue);
  const track = decodeStrictTrack(trackValue, 'Downloaded track');
  const trackId = offlineTrackId(track.id);
  const playlist = manifest.playlists[playlistId];
  if (playlist === undefined) {
    throw new Error('Downloaded track references an unknown offline playlist');
  }
  if (!playlist.sourceTrackIds.includes(trackId)) {
    throw new Error('Downloaded track is unrelated to its offline playlist');
  }
  if (!playlist.sourceTracks.some((occurrence) => tracksEqual(occurrence.track, track))) {
    throw new Error('Downloaded track metadata does not match its offline source snapshot');
  }
  const size = positiveSize(sizeBytes, 'Downloaded track size');
  const timestamp = isoTimestamp(downloadedAt, 'Downloaded track timestamp');
  const current = manifest.tracks[trackId];
  if (current !== undefined && current.sizeBytes !== size) {
    throw new Error('Downloaded track size conflicts with the deduplicated offline file');
  }
  const ownerPlaylistIds = current?.ownerPlaylistIds.includes(playlistId)
    ? current.ownerPlaylistIds
    : [...(current?.ownerPlaylistIds ?? []), playlistId];
  const failures = playlist.failures.filter((failure) => failure.trackId !== trackId);
  const nextPlaylist = playlist.status === 'complete'
    ? playlist
    : { ...playlist, failures, updatedAt: timestamp };
  return {
    ...manifest,
    tracks: {
      ...manifest.tracks,
      [trackId]: current === undefined
        ? {
          track,
          fileName: offlineTrackFileName(trackId),
          sizeBytes: size,
          ownerPlaylistIds,
          downloadedAt: timestamp,
        }
        : { ...current, ownerPlaylistIds },
    },
    playlists: { ...manifest.playlists, [playlistId]: nextPlaylist },
  };
}

export function beginPlaylistDownload(
  manifest: OfflineManifest,
  playlist: OfflinePlaylistSource,
  updatedAt: string,
): OfflineManifest {
  const snapshot = playlistSnapshot(playlist);
  const timestamp = isoTimestamp(updatedAt, 'Offline playlist timestamp');
  const existing = manifest.playlists[snapshot.id];
  if (existing !== undefined && !sameOrderedIds(existing.sourceTrackIds, snapshot.sourceTrackIds)) {
    throw new Error('Remove the changed offline playlist snapshot before downloading it again');
  }
  const failures = existing?.failures.filter((failure) =>
    !trackOwnedByPlaylist(manifest, snapshot.id, failure.trackId)) ?? [];
  return {
    ...manifest,
    playlists: {
      ...manifest.playlists,
      [snapshot.id]: {
        ...snapshot,
        failures,
        updatedAt: timestamp,
      },
    },
  };
}

export function settlePlaylistDownload(
  manifest: OfflineManifest,
  playlist: OfflinePlaylistSource,
  updatedAt: string,
  failureValues: readonly OfflineTrackFailureInput[] = [],
): OfflineManifest {
  const snapshot = playlistSnapshot(playlist);
  const pending = manifest.playlists[snapshot.id];
  if (pending === undefined || !sameOrderedIds(pending.sourceTrackIds, snapshot.sourceTrackIds)) {
    throw new Error('Offline playlist settlement does not match the pending snapshot');
  }
  const timestamp = isoTimestamp(updatedAt, 'Offline playlist timestamp');
  const inputs = failureValues.map((failure, index) =>
    decodeFailureInput(failure, `Offline settlement failure ${index}`));
  requireUnique(inputs.map((failure) => failure.trackId), 'Offline settlement failures');
  const sourceIds = new Set(pending.sourceTrackIds);
  if (inputs.some((failure) => !sourceIds.has(failure.trackId))) {
    throw new Error('Offline playlist settlement contains an unrelated failure');
  }
  if (inputs.some((failure) =>
    trackOwnedByPlaylist(manifest, pending.id, failure.trackId))) {
    throw new Error('Offline playlist settlement failed a downloaded track');
  }
  const missing = unique(pending.sourceTrackIds.filter((trackId) =>
    !trackOwnedByPlaylist(manifest, pending.id, trackId)));
  const previous = new Map(pending.failures.map((failure) => [failure.trackId, failure]));
  const reported = new Map(inputs.map((failure) => [failure.trackId, failure]));
  const failures = missing.map((trackId): OfflineTrackFailure => {
    const input = reported.get(trackId);
    if (input !== undefined) return { ...input, failedAt: timestamp };
    return previous.get(trackId) ?? {
      trackId,
      code: 'download-incomplete',
      retryable: true,
      failedAt: timestamp,
    };
  });
  const status: OfflinePlaylistStatus = missing.length === 0 ? 'complete' : 'partial';
  return {
    ...manifest,
    playlists: {
      ...manifest.playlists,
      [pending.id]: {
        ...pending,
        status,
        failures,
        completedAt: status === 'complete' ? timestamp : null,
        updatedAt: timestamp,
      },
    },
  };
}

export function removePlaylistDownload(
  manifest: OfflineManifest,
  playlistIdValue: unknown,
): { manifest: OfflineManifest; orphanedFiles: string[] } {
  const playlistId = offlinePlaylistId(playlistIdValue);
  if (manifest.playlists[playlistId] === undefined) {
    return { manifest, orphanedFiles: [] };
  }
  const playlists = { ...manifest.playlists };
  delete playlists[playlistId];
  const tracks: Record<string, OfflineTrackEntry> = {};
  const orphanedFiles: string[] = [];
  for (const [trackId, entry] of Object.entries(manifest.tracks)) {
    const ownerPlaylistIds = entry.ownerPlaylistIds.filter((owner) => owner !== playlistId);
    if (ownerPlaylistIds.length === 0) orphanedFiles.push(entry.fileName);
    else tracks[trackId] = { ...entry, ownerPlaylistIds };
  }
  return {
    manifest: { ...manifest, tracks, playlists },
    orphanedFiles,
  };
}

function failuresEqual(
  left: readonly OfflineTrackFailure[],
  right: readonly OfflineTrackFailure[],
): boolean {
  return left.length === right.length && left.every((failure, index) => {
    const other = right[index];
    return other !== undefined
      && failure.trackId === other.trackId
      && failure.code === other.code
      && failure.retryable === other.retryable
      && failure.failedAt === other.failedAt;
  });
}

/** Reconcile persisted metadata against files actually present in app-private storage. */
export function reconcileOfflineManifest(
  manifest: OfflineManifest,
  fileSizes: Readonly<Record<string, number>>,
  updatedAt: string,
  evidence: OfflineReconciliationEvidence = {},
): OfflineManifest {
  const timestamp = isoTimestamp(updatedAt, 'Offline reconciliation timestamp');
  const invalidTrackIds = new Set((evidence.invalidTrackIds ?? []).map(offlineTrackId));
  const interruptedTrackIds = new Set(
    (evidence.interruptedTrackIds ?? []).map(offlineTrackId),
  );
  const nativeFailureCode = (trackId: string): string | null =>
    invalidTrackIds.has(trackId)
      ? 'file-integrity'
      : interruptedTrackIds.has(trackId)
        ? 'download-interrupted'
        : null;
  const removed = new Map<string, string>();
  const tracks = Object.fromEntries(
    Object.entries(manifest.tracks).flatMap(([trackId, entry]) => {
      const size = fileSizes[entry.fileName];
      if (typeof size === 'number' && Number.isSafeInteger(size) && size === entry.sizeBytes) {
        return [[trackId, entry]];
      }
      removed.set(
        trackId,
        nativeFailureCode(trackId) ?? (size === undefined ? 'file-missing' : 'file-integrity'),
      );
      return [];
    }),
  );
  const playlists = Object.fromEntries(
    Object.entries(manifest.playlists).map(([playlistId, entry]) => {
      const missing = unique(entry.sourceTrackIds.filter((trackId) =>
        !tracks[trackId]?.ownerPlaylistIds.includes(playlistId)));
      const previous = new Map(entry.failures.map((failure) => [failure.trackId, failure]));
      const failures = missing.map((trackId): OfflineTrackFailure => {
        const removalCode = removed.get(trackId);
        if (removalCode !== undefined
          && manifest.tracks[trackId]?.ownerPlaylistIds.includes(playlistId)) {
          return {
            trackId,
            code: removalCode,
            retryable: true,
            failedAt: timestamp,
          };
        }
        return previous.get(trackId) ?? {
          trackId,
          code: nativeFailureCode(trackId) ?? 'download-incomplete',
          retryable: true,
          failedAt: timestamp,
        };
      });
      const status: OfflinePlaylistStatus = missing.length === 0 ? 'complete' : 'partial';
      const completedAt = status === 'complete'
        ? (entry.completedAt ?? timestamp)
        : null;
      const changed = status !== entry.status
        || completedAt !== entry.completedAt
        || !failuresEqual(failures, entry.failures);
      return [playlistId, {
        ...entry,
        status,
        failures,
        completedAt,
        updatedAt: changed ? timestamp : entry.updatedAt,
      }];
    }),
  );
  return { ...manifest, tracks, playlists };
}

export function offlinePlaylistViews(manifest: OfflineManifest): OfflinePlaylistView[] {
  return Object.values(manifest.playlists)
    .map((playlist) => {
      const uniqueTrackIds = unique(playlist.sourceTrackIds);
      const failureIds = new Set(playlist.failures.map((failure) => failure.trackId));
      const downloaded = (trackId: string) =>
        manifest.tracks[trackId]?.ownerPlaylistIds.includes(playlist.id) ?? false;
      const pendingTrackIds = uniqueTrackIds.filter((trackId) =>
        !downloaded(trackId) && !failureIds.has(trackId));
      return {
        ...playlist,
        downloadedOccurrences: playlist.sourceTrackIds.filter(downloaded).length,
        failedOccurrences: playlist.sourceTrackIds.filter((trackId) => failureIds.has(trackId)).length,
        pendingOccurrences: playlist.sourceTrackIds.filter(
          (trackId) => !downloaded(trackId) && !failureIds.has(trackId),
        ).length,
        totalOccurrences: playlist.sourceTrackIds.length,
        sizeBytes: uniqueTrackIds.reduce(
          (total, trackId) => {
            const entry = manifest.tracks[trackId];
            return total + (entry?.ownerPlaylistIds.includes(playlist.id) ? entry.sizeBytes : 0);
          },
          0,
        ),
        failedTrackIds: playlist.failures.map((failure) => failure.trackId),
        pendingTrackIds,
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function offlineStorageBytes(manifest: OfflineManifest): number {
  return Object.values(manifest.tracks).reduce((total, entry) => total + entry.sizeBytes, 0);
}
