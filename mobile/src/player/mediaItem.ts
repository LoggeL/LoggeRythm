import type { MediaItem } from '@rntp/player';
import type { Track } from '../api/types';

/**
 * Convert a backend Track into an RNTP MediaItem. The stream endpoint supports
 * HTTP Range requests and receives the account cookie through native URL headers.
 * The full Track is stashed in `extras` so it can be recovered from the queue
 * (for like/record-play calls and Android Auto selections) without a re-fetch.
 */
export function trackToMediaItem(
  track: Track,
  apiBase: string,
  streamHeaders: Record<string, string>,
  options: { mediaId?: string; radio?: boolean } = {},
): MediaItem {
  return {
    mediaId: options.mediaId ?? `track:${track.id}`,
    url: { uri: `${apiBase}/api/tracks/${track.id}/stream`, headers: streamHeaders },
    title: track.title,
    artist: track.artist,
    albumTitle: track.album,
    artworkUrl: track.cover || undefined,
    duration: track.duration_sec,
    extras: {
      track: track as unknown as Record<string, unknown>,
      radio: options.radio === true,
    },
  };
}

/** Recover the original Track from a MediaItem's extras, or null if absent. */
export function mediaItemToTrack(item: MediaItem | null | undefined): Track | null {
  if (item == null) return null;
  const t = item?.extras?.track;
  if (typeof t !== 'object' || t === null) {
    throw new Error(`Media item ${String(item.mediaId)} is missing Track metadata in extras.track`);
  }
  const candidate = t as Partial<Track>;
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || typeof candidate.artist !== 'string') {
    throw new Error(`Media item ${String(item.mediaId)} contains invalid Track metadata`);
  }
  return candidate as Track;
}

export function mediaItemIsRadio(item: MediaItem | null | undefined): boolean {
  return item?.extras?.radio === true;
}
