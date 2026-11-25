import { useCallback, useMemo, useState } from 'react';
import type { Track } from '../api/types';
import { refreshOfflineAutoBrowse } from '../components/library/autoBrowse';
import { WifiOnlyDownloadError } from './downloadSettings';
import { useOfflineDownloads } from './hooks';
import {
  downloadTracksBatchForOffline,
  removeTracksBatchOffline,
} from './runtime';

export type CollectionOfflinePhase = 'idle' | 'downloading' | 'downloaded' | 'removing';

export interface UseTrackCollectionOfflineOptions {
  scope: string | null;
  jobId: string | number | null;
  tracks: readonly Track[];
  downloadFailedMessage: string;
  removeFailedMessage: string;
  onError: (message: string) => void;
}

export interface TrackCollectionOfflineState {
  phase: CollectionOfflinePhase;
  downloadedCount: number;
  totalCount: number;
  busy: boolean;
  downloadAll: () => void;
  removeAll: () => void;
}

/**
 * Shared offline batch controller for non-playlist track collections
 * (Liked Songs and Albums). Tracks live downloaded coverage from the
 * account-scoped OfflineRuntimeSnapshot and reports Wi-Fi/download errors loudly.
 */
export function useTrackCollectionOffline({
  scope,
  jobId,
  tracks,
  downloadFailedMessage,
  removeFailedMessage,
  onError,
}: UseTrackCollectionOfflineOptions): TrackCollectionOfflineState {
  const snapshot = useOfflineDownloads();
  const [operation, setOperation] = useState<'downloading' | 'removing' | null>(null);

  const uniqueTrackIds = useMemo(
    () => [...new Set(tracks.map((track) => track.id))],
    [tracks],
  );
  const downloadedCount = useMemo(() => {
    if (scope === null || !snapshot.hydrated || snapshot.scope !== scope) return 0;
    return uniqueTrackIds.filter(
      (id) => snapshot.manifest?.tracks[id]?.individualDownload === true
        && snapshot.downloadedTrackIds.has(id),
    ).length;
  }, [scope, snapshot, uniqueTrackIds]);

  const totalCount = uniqueTrackIds.length;
  const allDownloaded = totalCount > 0 && downloadedCount === totalCount;
  const phase: CollectionOfflinePhase =
    operation === 'downloading'
      ? 'downloading'
      : operation === 'removing'
        ? 'removing'
        : allDownloaded
          ? 'downloaded'
          : 'idle';

  const downloadAll = useCallback(() => {
    if (scope === null || operation !== null || tracks.length === 0) return;
    const resolvedJobId = jobId ?? tracks[0]?.id;
    if (resolvedJobId === undefined || resolvedJobId === null) return;
    setOperation('downloading');
    void downloadTracksBatchForOffline(scope, resolvedJobId, tracks)
      .then(() => refreshOfflineAutoBrowse())
      .catch((error: unknown) => {
        if (error instanceof WifiOnlyDownloadError) {
          onError(error.message);
        } else {
          onError(downloadFailedMessage);
        }
      })
      .finally(() => setOperation(null));
  }, [downloadFailedMessage, jobId, onError, operation, scope, tracks]);

  const removeAll = useCallback(() => {
    if (scope === null || operation !== null || uniqueTrackIds.length === 0) return;
    setOperation('removing');
    void removeTracksBatchOffline(scope, uniqueTrackIds)
      .then(() => refreshOfflineAutoBrowse())
      .catch(() => {
        onError(removeFailedMessage);
      })
      .finally(() => setOperation(null));
  }, [onError, operation, removeFailedMessage, scope, uniqueTrackIds]);

  return {
    phase,
    downloadedCount,
    totalCount,
    busy: operation !== null,
    downloadAll,
    removeAll,
  };
}
