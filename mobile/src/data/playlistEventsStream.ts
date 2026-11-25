import { decodePlaylistLiveEvent } from '../api/decoders';
import {
  openAuthenticatedSseStream,
  type SseStreamDependencies,
  type SseStreamHandlers,
} from '../api/sseStream';
import type { PlaylistLiveEvent } from '../api/types';

/**
 * Subscribe to live collaborative playlist revisions via `GET /api/playlists/{id}/events`.
 * Emits strictly decoded `{ playlist_id, revision, event }` frames so PlaylistScreen
 * refetches on newer revisions and exits cleanly on `revoked` or `deleted`.
 */
export function openPlaylistEventsStream(
  playlistId: number,
  handlers: SseStreamHandlers<PlaylistLiveEvent>,
  dependencies?: SseStreamDependencies,
): Promise<() => void> {
  if (!Number.isSafeInteger(playlistId) || playlistId <= 0) {
    return Promise.reject(new Error(`Invalid playlist id for live events: ${String(playlistId)}`));
  }
  return openAuthenticatedSseStream(
    `/api/playlists/${encodeURIComponent(String(playlistId))}/events`,
    `Playlist ${playlistId}`,
    decodePlaylistLiveEvent,
    handlers,
    dependencies,
  );
}
