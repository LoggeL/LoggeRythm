import type { MediaItem } from './player';
import type { Track } from '../api/types';
import { trackArtistLabel } from '../api/trackArtists';
import { calculateLoudnessGain, loudnessMetadataFromTrack } from './loudness';

function isArtistRef(value: unknown): value is Track['artists'][number] {
  if (typeof value !== 'object' || value === null) return false;
  const artist = value as Record<string, unknown>;
  return (
    (typeof artist.id === 'string' || typeof artist.id === 'number') &&
    typeof artist.name === 'string'
  );
}

function normalizeArtists(value: unknown): Track['artists'] | null {
  if (Array.isArray(value)) return value.every(isArtistRef) ? value : null;
  return null;
}

function normalizeOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'null') return null;
  return undefined;
}

/**
 * Convert a backend Track into a first-party player MediaItem. The stream endpoint supports
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
  const loudnessNormalization = calculateLoudnessGain(loudnessMetadataFromTrack(track));
  return {
    mediaId: options.mediaId ?? `track:${track.id}`,
    url: explicitDownloadUri === undefined
      ? { uri: `${apiBase}/api/tracks/${track.id}/stream`, headers: streamHeaders }
      : { uri: explicitDownloadUri },
    title: track.title,
    artist: trackArtistLabel(track),
    albumTitle: track.album,
    artworkUrl: track.cover || undefined,
    duration: track.duration_sec,
    extras: {
      track: track as unknown as Record<string, unknown>,
      radio: options.radio === true,
      explicitDownload: explicitDownloadUri !== undefined,
      loudnessNormalization,
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
  const normalized = { ...candidate, artists } as Track;
  for (const key of ['loudness_gain_db', 'loudness_lufs', 'loudness_peak'] as const) {
    const value = normalizeOptionalNumber(candidate[key]);
    if (value === undefined) delete normalized[key];
    else normalized[key] = value;
  }
  return normalized;
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
