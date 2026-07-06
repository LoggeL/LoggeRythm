import type { MediaItem } from '@rntp/player';
import type { Track } from '../api/types';

/**
 * Convert a backend Track into an RNTP MediaItem. The stream endpoint is
 * unauthenticated MP3 with Range support, so a plain URL string is enough.
 * The full Track is stashed in `extras` so it can be recovered from the queue
 * (for like/record-play calls and Android Auto selections) without a re-fetch.
 */
export function trackToMediaItem(track: Track, apiBase: string): MediaItem {
  return {
    mediaId: String(track.id),
    url: `${apiBase}/api/tracks/${track.id}/stream`,
    title: track.title,
    artist: track.artist,
    albumTitle: track.album,
    artworkUrl: track.cover ?? undefined,
    duration: track.duration_sec,
    extras: { track: track as unknown as Record<string, unknown> },
  };
}

/** Recover the original Track from a MediaItem's extras, or null if absent. */
export function mediaItemToTrack(item: MediaItem | null | undefined): Track | null {
  const t = item?.extras?.track;
  return t ? (t as unknown as Track) : null;
}
