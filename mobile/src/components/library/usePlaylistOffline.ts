import { useState } from 'react';
import type { Playlist } from '../../api/types';
import { downloadPlaylistForOffline, removeOfflinePlaylist } from '../../offline/runtime';
import { runOfflinePlaylistScreenAction } from '../../screens/offlineScreenActions';
import type {
  OfflineScreenFailure,
  OfflineScreenOperation,
} from '../../screens/offlineScreenModel';
import { refreshOfflineAutoBrowse } from './autoBrowse';

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
        () => downloadPlaylistForOffline(scope, source),
        refreshOfflineAutoBrowse,
      )
        .catch(() => setFailure('download'))
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
