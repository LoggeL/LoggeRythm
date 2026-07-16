import type { MediaItem } from '@rntp/player';
import type { Track } from '../api/types';

function isArtistRef(value: unknown): value is Track['artists'][number] {
  if (typeof value !== 'object' || value === null) return false;
  const artist = value as Record<string, unknown>;
  return (
    (typeof artist.id === 'string' || typeof artist.id === 'number') &&
    typeof artist.name === 'string'
  );
}

/**
 * RNTP's Android extras bridge preserves an array's entries in numeric keys and
 * records its length separately. Rebuild that native representation before an
 * item is sent back to JSON APIs such as play history.
 */
function normalizeArtists(value: unknown): Track['artists'] | null {
  if (Array.isArray(value)) return value.every(isArtistRef) ? value : null;
  if (typeof value !== 'object' || value === null) return null;

  const arrayLike = value as Record<string, unknown>;
  const length = arrayLike.__rntp_array_length;
  if (!Number.isInteger(length) || (length as number) < 0) return null;

  const artists = Array.from({ length: length as number }, (_, index) => arrayLike[String(index)]);
  return artists.every(isArtistRef) ? artists : null;
}

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
  options: { mediaId?: string; radio?: boolean; explicitDownloadUri?: string } = {},
): MediaItem {
  const explicitDownloadUri = options.explicitDownloadUri?.trim();
  if (explicitDownloadUri !== undefined && !explicitDownloadUri.startsWith('file://')) {
    throw new Error(`Explicit download for track ${track.id} must use an app-private file URI`);
  }
  return {
    mediaId: options.mediaId ?? `track:${track.id}`,
    url: explicitDownloadUri === undefined
      ? { uri: `${apiBase}/api/tracks/${track.id}/stream`, headers: streamHeaders }
      : { uri: explicitDownloadUri },
    title: track.title,
    artist: track.artist,
    albumTitle: track.album,
    artworkUrl: track.cover || undefined,
    duration: track.duration_sec,
    extras: {
      track: track as unknown as Record<string, unknown>,
      radio: options.radio === true,
      explicitDownload: explicitDownloadUri !== undefined,
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
  const artists = normalizeArtists(candidate.artists);
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.artist !== 'string' ||
    artists === null
  ) {
    throw new Error(`Media item ${String(item.mediaId)} contains invalid Track metadata`);
  }
  return { ...candidate, artists } as Track;
}

export function mediaItemIsRadio(item: MediaItem | null | undefined): boolean {
  return item?.extras?.radio === true;
}

/** True only for queue entries assembled from the verified explicit-download registry. */
export function mediaItemUsesExplicitDownload(item: MediaItem | null | undefined): boolean {
  const uri = typeof item?.url === 'object' && item.url !== null ? item.url.uri : null;
  return item?.extras?.explicitDownload === true
    && typeof uri === 'string'
    && uri.startsWith('file://');
}
