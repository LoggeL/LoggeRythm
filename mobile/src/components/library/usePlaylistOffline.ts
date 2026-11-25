import { useState } from 'react';
import type { Playlist } from '../../api/types';
import { musicRepository } from '../../data';
import {
  assertDownloadNetworkAllowed,
  WifiOnlyDownloadError,
} from '../../offline/downloadSettings';
import { saveOfflineLyrics } from '../../offline/lyricsCache';
import { downloadPlaylistForOffline, removeOfflinePlaylist } from '../../offline/runtime';
import { runOfflinePlaylistScreenAction } from '../../screens/offlineScreenActions';
import type {
  OfflineScreenFailure,
  OfflineScreenOperation,
} from '../../screens/offlineScreenModel';
import { refreshOfflineAutoBrowse } from './autoBrowse';

async function syncPlaylistWithManifest(scope: string, source: Playlist): Promise<void> {
  await assertDownloadNetworkAllowed();
  if (musicRepository.getPlaylistSyncManifest === undefined) {
    throw new Error('musicRepository.getPlaylistSyncManifest is not configured');
  }
  const manifest = await musicRepository.getPlaylistSyncManifest(source.id, {
    includeLyrics: true,
    preload: true,
  });
  if (manifest.lyrics !== undefined && manifest.lyrics !== null) {
    const entries = Object.entries(manifest.lyrics);
    const results = await Promise.allSettled(
      entries.map(([trackId, lyrics]) => saveOfflineLyrics(scope, trackId, lyrics)),
    );
    const failures = results
      .map((entry, idx) =>
        entry.status === 'rejected'
          ? `${entries[idx]?.[0] ?? 'unknown'}: ${entry.reason instanceof Error ? entry.reason.message : String(entry.reason)}`
          : null,
      )
      .filter((item): item is string => item !== null);
    if (failures.length > 0) {
      throw new Error(
        `Failed to persist ${failures.length} offline lyrics entries for playlist ${source.id}: ${failures.join('; ')}`,
      );
    }
  }
  await downloadPlaylistForOffline(scope, source);
}

export interface PlaylistOfflineActions {
  /** The transaction this screen started and is still waiting for. */
  operation: OfflineScreenOperation;
  /** Which of this screen's transactions failed last; shown by the offline control. */
  failure: OfflineScreenFailure;
  download: () => void;
  remove: () => void;
}

/**
 * Owns the explicit offline download/removal of one playlist. `source` is the
 * playlist to download (remote detail, or the local copy when offline) and
 * `playlistId` is null for collections that cannot be downloaded.
 */
export function usePlaylistOffline(
  scope: string,
  playlistId: number | null,
  source: Playlist | undefined,
): PlaylistOfflineActions {
  const [operation, setOperation] = useState<OfflineScreenOperation>(null);
  const [failure, setFailure] = useState<OfflineScreenFailure>(null);

  return {
    operation,
    failure,
    download: () => {
      if (playlistId === null) return;
      if (source === undefined) {
        setFailure('download');
        return;
      }
      setFailure(null);
      setOperation('downloading');
      void runOfflinePlaylistScreenAction(
        () => syncPlaylistWithManifest(scope, source),
        refreshOfflineAutoBrowse,
      )
        .catch((cause: unknown) =>
          setFailure(cause instanceof WifiOnlyDownloadError ? 'wifi-required' : 'download'),
        )
        .finally(() => setOperation(null));
    },
    remove: () => {
      if (playlistId === null) return;
      setFailure(null);
      setOperation('removing');
      void runOfflinePlaylistScreenAction(
        () => removeOfflinePlaylist(scope, playlistId),
        refreshOfflineAutoBrowse,
      )
        .catch(() => setFailure('remove'))
        .finally(() => setOperation(null));
    },
  };
}
