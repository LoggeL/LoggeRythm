import type { Track } from '../api/types';
import type { PlayTracksOptions } from '../player/controller';
import type {
  OfflinePlaylistControlState,
  OfflinePlaylistProgress,
} from '../components/offline/OfflinePlaylistControl';
import {
  getOfflinePlaylistBrowseDetail,
  listOfflinePlaylistSummaries,
  type OfflinePlaylistBrowseDetail,
  type OfflinePlaylistBrowseSummary,
} from '../offline/browse';
import { offlinePlaylistId } from '../offline/model';
import type { OfflineRuntimeSnapshot } from '../offline/registry';

export type OfflineScreenOperation = 'downloading' | 'removing' | null;
export type OfflineScreenFailure = 'download' | 'remove' | null;
export type AccountOfflineAvailability = 'loading' | 'ready' | 'unavailable';

export interface OfflinePlaylistControlInput {
  snapshot: OfflineRuntimeSnapshot;
  accountScope: string;
  playlistId: unknown;
  sourceTrackCount: number;
  operation?: OfflineScreenOperation;
  actionFailure?: OfflineScreenFailure;
}

function exactAccountManifest(
  snapshot: OfflineRuntimeSnapshot,
  accountScope: string,
) {
  if (
    !snapshot.hydrated
    || snapshot.scope !== accountScope
    || snapshot.manifest === null
    || snapshot.manifest.scope !== accountScope
  ) return null;
  return snapshot.manifest;
}

export function accountOfflineAvailability(
  snapshot: OfflineRuntimeSnapshot,
  accountScope: string,
): AccountOfflineAvailability {
  if (snapshot.error === 'storage-unavailable') return 'unavailable';
  if (exactAccountManifest(snapshot, accountScope) !== null) return 'ready';
  if (
    !snapshot.hydrated
    && (snapshot.scope === null || snapshot.scope === accountScope)
  ) return 'loading';
  return 'unavailable';
}

/** Fail closed: a missing, unhydrated, or cross-account snapshot exposes no local browse data. */
export function accountOfflinePlaylistDetail(
  snapshot: OfflineRuntimeSnapshot,
  accountScope: string,
  playlistId: unknown,
): OfflinePlaylistBrowseDetail | null {
  const manifest = exactAccountManifest(snapshot, accountScope);
  if (manifest === null) return null;
  return getOfflinePlaylistBrowseDetail(manifest, accountScope, playlistId);
}

/** Lists complete and partial snapshots for exactly one approved account scope. */
export function accountOfflinePlaylistSummaries(
  snapshot: OfflineRuntimeSnapshot,
  accountScope: string,
): OfflinePlaylistBrowseSummary[] {
  const manifest = exactAccountManifest(snapshot, accountScope);
  if (manifest === null) return [];
  return listOfflinePlaylistSummaries(manifest, accountScope);
}

function wholeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function detailProgress(
  detail: OfflinePlaylistBrowseDetail | null,
  sourceTrackCount: number,
): OfflinePlaylistProgress {
  if (detail === null) {
    return {
      completedTracks: 0,
      totalTracks: wholeCount(sourceTrackCount),
      failedTracks: 0,
    };
  }
  return {
    completedTracks: detail.offline.downloadedOccurrences,
    totalTracks: detail.offline.totalOccurrences,
    failedTracks: detail.offline.failedOccurrences,
  };
}

function removalProgress(done: number, total: number): OfflinePlaylistProgress {
  return {
    completedTracks: wholeCount(done),
    totalTracks: Math.max(1, wholeCount(total)),
    failedTracks: 0,
  };
}

/**
 * Maps persisted evidence plus the one active transaction into the shared
 * control. Native progress is used only to identify the active phase: the
 * manifest's occurrence counts remain authoritative when duplicate IDs exist.
 */
export function playlistOfflineControlState({
  snapshot,
  accountScope,
  playlistId,
  sourceTrackCount,
  operation = null,
  actionFailure = null,
}: OfflinePlaylistControlInput): OfflinePlaylistControlState {
  const manifest = exactAccountManifest(snapshot, accountScope);
  if (manifest === null || snapshot.error === 'storage-unavailable') {
    return { kind: 'unavailable' };
  }

  let exactPlaylistId: string;
  try {
    exactPlaylistId = offlinePlaylistId(playlistId);
  } catch {
    return { kind: 'unavailable' };
  }
  const detail = getOfflinePlaylistBrowseDetail(manifest, accountScope, exactPlaylistId);
  const progress = detailProgress(detail, sourceTrackCount);
  const nativeProgress = snapshot.progress?.playlistId === exactPlaylistId
    ? snapshot.progress
    : null;

  if (operation === 'removing' || nativeProgress?.phase === 'removing') {
    return {
      kind: 'removing',
      progress: nativeProgress === null
        ? progress
        : removalProgress(nativeProgress.done, nativeProgress.total),
    };
  }
  if (operation === 'downloading' || nativeProgress?.phase === 'downloading') {
    return { kind: 'downloading', progress };
  }
  if (
    actionFailure !== null
    || (
      snapshot.error === 'download-failed'
      && detail?.offline.failures.some(({ code }) => code === 'download-failed') === true
    )
  ) {
    return { kind: 'error', progress };
  }
  if (detail === null) return { kind: 'idle' };
  return {
    kind: detail.offline.status === 'complete' ? 'downloaded' : 'partial',
    progress,
  };
}

export function offlineRetryAction(
  failure: OfflineScreenFailure,
  retryDownload: () => void,
  retryRemove: () => void,
): () => void {
  return failure === 'remove' ? retryRemove : retryDownload;
}

export function playlistScreenPlaybackOptions(
  context: PlayTracksOptions['context'],
  localFallback: boolean,
): PlayTracksOptions {
  return { context, requireExplicitDownloads: localFallback };
}

export interface LocalPlaylistPlaybackSelection {
  tracks: Track[];
  startIndex: number;
}

/**
 * A cold-offline press can enqueue only verified occurrences. This preserves
 * source ordering and duplicate occurrences without ever introducing a remote
 * fallback item into the player transaction.
 */
export function localPlaylistPlaybackSelection(
  detail: OfflinePlaylistBrowseDetail,
  selectedOccurrenceIndex: number,
): LocalPlaylistPlaybackSelection | null {
  if (
    !Number.isInteger(selectedOccurrenceIndex)
    || selectedOccurrenceIndex < 0
    || selectedOccurrenceIndex >= detail.occurrences.length
    || detail.occurrences[selectedOccurrenceIndex]?.availability !== 'downloaded'
  ) return null;

  const downloaded = detail.occurrences.filter(
    ({ availability }) => availability === 'downloaded',
  );
  return {
    tracks: downloaded.map(({ track }) => track),
    startIndex: detail.occurrences
      .slice(0, selectedOccurrenceIndex)
      .filter(({ availability }) => availability === 'downloaded')
      .length,
  };
}

export function firstDownloadedOccurrenceIndex(
  detail: OfflinePlaylistBrowseDetail,
): number {
  return detail.occurrences.findIndex(({ availability }) => availability === 'downloaded');
}
