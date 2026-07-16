import type { Playlist, PlaylistSummary, Track } from '../api/types';
import {
  offlinePlaylistId,
  offlinePlaylistViews,
  type OfflineManifest,
  type OfflinePlaylistStatus,
  type OfflinePlaylistView,
  type OfflineTrackFailure,
} from './model';

export type OfflineOccurrenceAvailability = 'downloaded' | 'failed' | 'pending';

export interface OfflinePlaylistBrowseEvidence {
  status: OfflinePlaylistStatus;
  downloadedOccurrences: number;
  failedOccurrences: number;
  pendingOccurrences: number;
  totalOccurrences: number;
  sizeBytes: number;
  failures: OfflineTrackFailure[];
  failedTrackIds: string[];
  pendingTrackIds: string[];
  completedAt: string | null;
  updatedAt: string;
}

/** API-summary fields plus the ownership and local evidence needed by offline Library UI. */
export interface OfflinePlaylistBrowseSummary extends PlaylistSummary {
  is_owner: boolean;
  offline: OfflinePlaylistBrowseEvidence;
}

export interface OfflinePlaylistBrowseOccurrence {
  position: number;
  track: Track;
  availability: OfflineOccurrenceAvailability;
  failure: OfflineTrackFailure | null;
}

export interface OfflinePlaylistBrowseDetail {
  playlist: Playlist;
  occurrences: OfflinePlaylistBrowseOccurrence[];
  offline: OfflinePlaylistBrowseEvidence;
}

function assertAccountScope(manifest: OfflineManifest, expectedScope: string): void {
  if (typeof expectedScope !== 'string' || expectedScope.trim() !== expectedScope
    || expectedScope.length === 0) {
    throw new Error('Offline browse account scope must be a non-empty exact string');
  }
  if (manifest.scope !== expectedScope) {
    throw new Error('Offline browse manifest belongs to another account scope');
  }
}

function apiPlaylistId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    throw new Error('Offline playlist id cannot be represented by the API Playlist type');
  }
  return id;
}

function cloneTrack(track: Track): Track {
  return {
    ...track,
    artists: track.artists.map((artist) => ({ ...artist })),
  };
}

function cloneFailure(failure: OfflineTrackFailure): OfflineTrackFailure {
  return { ...failure };
}

function evidence(view: OfflinePlaylistView): OfflinePlaylistBrowseEvidence {
  return {
    status: view.status,
    downloadedOccurrences: view.downloadedOccurrences,
    failedOccurrences: view.failedOccurrences,
    pendingOccurrences: view.pendingOccurrences,
    totalOccurrences: view.totalOccurrences,
    sizeBytes: view.sizeBytes,
    failures: view.failures.map(cloneFailure),
    failedTrackIds: [...view.failedTrackIds],
    pendingTrackIds: [...view.pendingTrackIds],
    completedAt: view.completedAt,
    updatedAt: view.updatedAt,
  };
}

function assertExactSourceSnapshot(view: OfflinePlaylistView): void {
  if (view.sourceTracks.length !== view.sourceTrackIds.length) {
    throw new Error('Offline playlist source snapshot is not occurrence-aligned');
  }
  view.sourceTracks.forEach((occurrence, index) => {
    if (occurrence.position !== index || occurrence.track.id !== view.sourceTrackIds[index]) {
      throw new Error('Offline playlist source snapshot has inconsistent occurrence evidence');
    }
  });
}

function playlistFromView(view: OfflinePlaylistView): Playlist {
  assertExactSourceSnapshot(view);
  return {
    id: apiPlaylistId(view.id),
    name: view.name,
    description: view.description,
    cover_url: view.cover_url,
    is_public: view.is_public,
    is_owner: view.is_owner,
    owner_name: view.owner_name,
    // The source occurrence snapshot, rather than the deduplicated file table, is authoritative.
    tracks: view.sourceTracks.map(({ track }) => cloneTrack(track)),
  };
}

function viewForId(
  manifest: OfflineManifest,
  playlistIdValue: unknown,
): OfflinePlaylistView | null {
  let playlistId: string;
  try {
    playlistId = offlinePlaylistId(playlistIdValue);
  } catch {
    return null;
  }
  return offlinePlaylistViews(manifest).find(({ id }) => id === playlistId) ?? null;
}

/** Lists only playlist snapshots belonging to the explicitly supplied account scope. */
export function listOfflinePlaylistSummaries(
  manifest: OfflineManifest,
  expectedScope: string,
): OfflinePlaylistBrowseSummary[] {
  assertAccountScope(manifest, expectedScope);
  return offlinePlaylistViews(manifest).map((view) => {
    assertExactSourceSnapshot(view);
    return {
      id: apiPlaylistId(view.id),
      name: view.name,
      description: view.description,
      cover_url: view.cover_url,
      is_public: view.is_public,
      track_count: view.totalOccurrences,
      owner_name: view.owner_name,
      is_owner: view.is_owner,
      offline: evidence(view),
    };
  });
}

/** Reconstructs the complete API Playlist from its immutable source occurrence snapshot. */
export function reconstructOfflinePlaylist(
  manifest: OfflineManifest,
  expectedScope: string,
  playlistIdValue: unknown,
): Playlist | null {
  assertAccountScope(manifest, expectedScope);
  const view = viewForId(manifest, playlistIdValue);
  return view === null ? null : playlistFromView(view);
}

/** Returns the reconstructed playlist together with per-occurrence local availability evidence. */
export function getOfflinePlaylistBrowseDetail(
  manifest: OfflineManifest,
  expectedScope: string,
  playlistIdValue: unknown,
): OfflinePlaylistBrowseDetail | null {
  assertAccountScope(manifest, expectedScope);
  const view = viewForId(manifest, playlistIdValue);
  if (view === null) return null;
  const failures = new Map(view.failures.map((failure) => [failure.trackId, failure]));
  const downloaded = (trackId: string) =>
    manifest.tracks[trackId]?.ownerPlaylistIds.includes(view.id) ?? false;
  return {
    playlist: playlistFromView(view),
    occurrences: view.sourceTracks.map(({ position, track }) => {
      const failure = failures.get(track.id);
      const availability: OfflineOccurrenceAvailability = downloaded(track.id)
        ? 'downloaded'
        : failure === undefined ? 'pending' : 'failed';
      return {
        position,
        track: cloneTrack(track),
        availability,
        failure: failure === undefined ? null : cloneFailure(failure),
      };
    }),
    offline: evidence(view),
  };
}
