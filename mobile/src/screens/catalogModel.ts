import type {
  AlbumDetail,
  ArtistDetail,
  ArtistSummary,
  DeezerId,
  GenreDetail,
  Track,
  TrackPlayCount,
} from '../api/types';

export interface AlbumRouteParams {
  albumId: DeezerId;
  title?: string;
}

export interface GenreRouteParams {
  genreId: DeezerId;
  name?: string;
}

export interface ArtistRouteParams {
  artistId: DeezerId;
  name?: string;
}

export interface PublicPlaylistRouteParams {
  playlistId: number;
  name: string;
}

export interface TrackCatalogRouteCallbacks {
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

export interface DiscoverRouteCallbacks extends TrackCatalogRouteCallbacks {
  onOpenGenre: (params: GenreRouteParams) => void;
  onOpenPlaylist: (params: PublicPlaylistRouteParams) => void;
}

export interface AlbumScreenContract extends AlbumRouteParams, TrackCatalogRouteCallbacks {}

export interface GenreScreenContract extends GenreRouteParams, TrackCatalogRouteCallbacks {}

export interface ArtistScreenContract extends ArtistRouteParams, TrackCatalogRouteCallbacks {}

function isCallback(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

export function requireCatalogId(value: DeezerId, label: string): DeezerId {
  const normalized = String(value).trim();
  if (normalized.length === 0) throw new Error(`${label} must not be empty`);
  return normalized;
}

export function assertDiscoverRouteCallbacks(
  value: unknown,
): asserts value is DiscoverRouteCallbacks {
  const candidate = value as Partial<DiscoverRouteCallbacks> | null;
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    !isCallback(candidate.onOpenAlbum) ||
    !isCallback(candidate.onOpenArtist) ||
    !isCallback(candidate.onOpenGenre) ||
    !isCallback(candidate.onOpenPlaylist)
  ) {
    throw new Error(
      'DiscoverScreen requires onOpenAlbum, onOpenArtist, onOpenGenre, and onOpenPlaylist route callbacks',
    );
  }
}

export function assertTrackCatalogRouteCallbacks(
  value: unknown,
  owner: string,
): asserts value is TrackCatalogRouteCallbacks {
  const candidate = value as Partial<TrackCatalogRouteCallbacks> | null;
  if (
    candidate === null
    || typeof candidate !== 'object'
    || !isCallback(candidate.onOpenAlbum)
    || !isCallback(candidate.onOpenArtist)
  ) {
    throw new Error(`${owner} requires onOpenAlbum and onOpenArtist route callbacks`);
  }
}

export function assertAlbumScreenContract(
  value: AlbumScreenContract,
): asserts value is AlbumScreenContract {
  requireCatalogId(value.albumId, 'album id');
  assertTrackCatalogRouteCallbacks(value, 'AlbumScreen');
}

export function assertGenreScreenContract(
  value: GenreScreenContract,
): asserts value is GenreScreenContract {
  requireCatalogId(value.genreId, 'genre id');
  assertTrackCatalogRouteCallbacks(value, 'GenreScreen');
}

export function assertArtistScreenContract(
  value: ArtistScreenContract,
): asserts value is ArtistScreenContract {
  requireCatalogId(value.artistId, 'artist id');
  assertTrackCatalogRouteCallbacks(value, 'ArtistScreen');
}

export interface PlaybackSelection {
  tracks: Track[];
  startIndex: number;
}

export const ARTIST_POPULAR_TRACK_LIMIT = 10;

export type ArtistTrackPlaybackSurface = 'popular' | 'search';

/** Keep Popular and query-result occurrences from claiming the same queue identity. */
export function artistTrackPlaybackContextId(
  artistId: DeezerId,
  surface: ArtistTrackPlaybackSurface,
  query = '',
): string {
  const id = requireCatalogId(artistId, 'artist id');
  if (surface === 'popular') return id;
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    throw new Error('Artist search playback context requires a query');
  }
  return `${id}:search:${normalizedQuery}`;
}

/** Match the production Artist page's visible/row-playback "Popular" context. */
export function artistPopularTracks(tracks: readonly Track[]): Track[] {
  return tracks.slice(0, ARTIST_POPULAR_TRACK_LIMIT);
}

/** Match the production Artist search's Deezer advanced-query syntax. */
export function artistSongSearchQuery(artistName: string, query: string): string | null {
  const normalizedArtist = artistName.trim();
  const normalizedQuery = query.trim();
  if (normalizedArtist.length === 0 || normalizedQuery.length === 0) return null;
  return `artist:"${normalizedArtist}" track:"${normalizedQuery}"`;
}

/**
 * Drop featured/compilation noise while preserving the backend's exact order
 * and duplicate rows. Deezer ids are authoritative; name matching is only the
 * same legacy fallback used by the production web surface.
 */
export function filterArtistTracks(
  tracks: readonly Track[],
  artistId: DeezerId,
  artistName: string,
): Track[] {
  const normalizedId = requireCatalogId(artistId, 'artist id');
  const normalizedName = artistName.trim().toLocaleLowerCase('en-US');
  return tracks.filter((track) => {
    if (String(track.artist_id) === normalizedId) return true;
    if (track.artists.some((artist) => String(artist.id) === normalizedId)) return true;
    return (
      normalizedName.length > 0 &&
      track.artist.toLocaleLowerCase('en-US').includes(normalizedName)
    );
  });
}

/** Web parity: Last.fm renders only evidence-backed positive play totals. */
export function artistTrackPlayMetadata(
  count: TrackPlayCount | undefined,
  format: (plays: number, listeners: number) => string,
): string | undefined {
  if (count === undefined || count.plays <= 0) return undefined;
  return format(count.plays, count.listeners);
}

/** Preserve the exact response order and duplicate entries used as the playback context. */
export function playbackSelection(tracks: Track[], startIndex: number): PlaybackSelection {
  if (tracks.length === 0) throw new Error('Playback context must contain at least one track');
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= tracks.length) {
    throw new Error(
      `Playback start index ${String(startIndex)} is outside a ${tracks.length}-track context`,
    );
  }
  return { tracks, startIndex };
}

export function artistSummary(detail: ArtistDetail): ArtistSummary {
  return { id: detail.id, name: detail.name, picture: detail.picture };
}

export function followingValue(
  values: Readonly<Record<string, boolean>> | undefined,
  artistId: DeezerId,
): boolean {
  return values?.[artistId] === true;
}

export function withFollowingValue(
  values: Readonly<Record<string, boolean>> | undefined,
  artistId: DeezerId,
  following: boolean,
): Record<string, boolean> {
  return { ...(values ?? {}), [artistId]: following };
}

export function releaseYear(releaseDate: string): string | null {
  const match = /^(\d{4})(?:-\d{2}-\d{2})?$/.exec(releaseDate.trim());
  return match?.[1] ?? null;
}

/** Match the production album header's rounded aggregate runtime. */
export function albumRuntimeMinutes(tracks: readonly Track[]): number | null {
  const totalSeconds = tracks.reduce((total, track) => {
    if (!Number.isFinite(track.duration_sec) || track.duration_sec < 0) {
      throw new Error(`Track ${track.id} has invalid duration ${String(track.duration_sec)}`);
    }
    return total + track.duration_sec;
  }, 0);
  return totalSeconds > 0 ? Math.round(totalSeconds / 60) : null;
}

export function catalogTestIdSegment(value: string | number): string {
  const normalized = String(value)
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'item';
}

export function trackContextKey(track: Track, index: number): string {
  return `${catalogTestIdSegment(track.id)}-${index}`;
}

export function genreHasContent(genre: GenreDetail): boolean {
  return genre.tracks.length > 0 || genre.albums.length > 0 || genre.artists.length > 0;
}

export function artistHasContent(artist: ArtistDetail): boolean {
  return artist.top.length > 0 || artist.albums.length > 0 || artist.related.length > 0;
}

export function albumHasContent(album: AlbumDetail): boolean {
  return album.tracks.length > 0;
}
