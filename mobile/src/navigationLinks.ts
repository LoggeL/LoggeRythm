import type { Track } from './api/types';
import type { AlbumRouteParams, ArtistRouteParams } from './screens/catalogModel';

export function playlistIdFromRouteValue(value: unknown): number | null {
  const segment = String(value ?? '').trim().split('-')[0];
  if (!/^0*[1-9]\d*$/u.test(segment)) return null;
  const id = Number(segment);
  return Number.isSafeInteger(id) ? id : null;
}

export function safeRouteLabel(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export function mixKeyFromRouteValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (key.length === 0 || key.length > 200 || /[/?#]/u.test(key)) return null;
  return key;
}

/** Normalize an optional Deezer reference into one safe, positive route segment. */
export function deezerReferenceIdFromRouteValue(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.length <= 32 && /^(?:0*[1-9]\d*)$/u.test(id) ? id : null;
}

function optionalRouteLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Build typed catalog routes only when stored track metadata has usable Deezer ids. */
export function trackAlbumRoute(
  track: Pick<Track, 'album_id' | 'album'>,
): AlbumRouteParams | null {
  const albumId = deezerReferenceIdFromRouteValue(track.album_id);
  return albumId === null
    ? null
    : { albumId, title: optionalRouteLabel(track.album) };
}

export function trackArtistRoute(
  track: Pick<Track, 'artist_id' | 'artist'>,
): ArtistRouteParams | null {
  const artistId = deezerReferenceIdFromRouteValue(track.artist_id);
  return artistId === null
    ? null
    : { artistId, name: optionalRouteLabel(track.artist) };
}
