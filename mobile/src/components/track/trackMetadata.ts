import type { ArtistRef, TrackPlayCount } from '../../api/types';
import { trackAlbumRoute, trackArtistRoute } from '../../navigationLinks';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';

/**
 * The common metadata carried by both a complete Track and a persisted
 * RecentPlay. Optional reference fields keep older history rows readable.
 */
export interface TrackMetadataDescriptor {
  title: string;
  artist: string;
  artist_id?: string | number;
  artists?: readonly ArtistRef[];
  album: string;
  album_id?: string | number;
  duration_sec: number;
  rank?: number;
}

export type TrackPopularityPolicy = 'none' | 'search' | 'artist-popular';

export type TrackPopularityMetadata =
  | {
      kind: 'plays';
      plays: number;
      listeners: number;
    }
  | {
      kind: 'rank';
      rank: number;
      percent: number;
    };

export interface TrackArtistMetadata {
  /** Stable for each occurrence, including duplicate artist ids. */
  key: string;
  index: number;
  id: string | number;
  name: string;
  route: ArtistRouteParams | null;
}

export interface TrackMetadata {
  title: string;
  album: string;
  albumRoute: AlbumRouteParams | null;
  artists: TrackArtistMetadata[];
  /** Positive, evidence-backed runtime; zero and corrupt values are unknown. */
  duration: string | null;
  popularity: TrackPopularityMetadata | null;
}

export interface BuildTrackMetadataOptions {
  popularity?: TrackPopularityPolicy;
  plays?: TrackPlayCount;
}

/** Format only a positive runtime. Backend legacy zero means "unknown". */
export function formatTrackDuration(seconds: unknown): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

/** Match production's bounded Deezer-rank percentage without inventing zero. */
export function trackPopularityPercent(rank: unknown): number | null {
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank <= 0) return null;
  return Math.max(2, Math.min(100, Math.round((rank / 1_000_000) * 100)));
}

function positivePlayCount(value: TrackPlayCount | undefined): TrackPlayCount | null {
  if (
    value === undefined
    || !Number.isFinite(value.plays)
    || !Number.isFinite(value.listeners)
    || value.plays <= 0
    || value.listeners < 0
  ) {
    return null;
  }
  return value;
}

function popularityMetadata(
  descriptor: TrackMetadataDescriptor,
  policy: TrackPopularityPolicy,
  plays: TrackPlayCount | undefined,
): TrackPopularityMetadata | null {
  if (policy === 'none') return null;

  const positivePlays = positivePlayCount(plays);
  if (positivePlays !== null) {
    return {
      kind: 'plays',
      plays: positivePlays.plays,
      listeners: positivePlays.listeners,
    };
  }
  if (policy === 'artist-popular') return null;

  const percent = trackPopularityPercent(descriptor.rank);
  return percent === null
    ? null
    : { kind: 'rank', rank: descriptor.rank as number, percent };
}

function artistCredits(descriptor: TrackMetadataDescriptor): readonly ArtistRef[] {
  if (descriptor.artists !== undefined && descriptor.artists.length > 0) {
    return descriptor.artists;
  }
  return [{ id: descriptor.artist_id ?? '', name: descriptor.artist }];
}

/**
 * Build one route-safe presentation model. Invalid legacy references remain
 * visible through their labels, but cannot become catalog actions.
 */
export function buildTrackMetadata(
  descriptor: TrackMetadataDescriptor,
  options: BuildTrackMetadataOptions = {},
): TrackMetadata {
  const albumRoute = trackAlbumRoute({
    album_id: descriptor.album_id ?? '',
    album: descriptor.album,
  });
  const artists = artistCredits(descriptor).map((artist, index) => ({
    key: `artist-credit-${index}`,
    index,
    id: artist.id,
    name: artist.name,
    route: trackArtistRoute({ artist_id: artist.id, artist: artist.name }),
  }));

  return {
    title: descriptor.title,
    album: descriptor.album,
    albumRoute,
    artists,
    duration: formatTrackDuration(descriptor.duration_sec),
    popularity: popularityMetadata(
      descriptor,
      options.popularity ?? 'none',
      options.plays,
    ),
  };
}
