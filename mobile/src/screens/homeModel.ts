import type {
  AlbumSummary,
  DeezerId,
  Genre,
  HomeShelf,
  PlaylistSummary,
  RecentPlay,
} from '../api/types';
import { deezerReferenceIdFromRouteValue } from '../navigationLinks';
import type { QueueContext } from '../player/queueContract';

export const HOME_MOODS = [
  { key: 'top', tag: null },
  { key: 'chill', tag: 'chill' },
  { key: 'focus', tag: 'focus' },
  { key: 'workout', tag: 'workout' },
  { key: 'party', tag: 'party' },
] as const;

export type HomeMoodKey = (typeof HOME_MOODS)[number]['key'];
export type GreetingKey = 'greetingNight' | 'greetingMorning' | 'greetingDay' | 'greetingEvening';
export const HOME_RECENT_SHELF_LIMIT = 7;

export interface HomeAlbumRouteParams {
  albumId: DeezerId;
  title?: string;
}

export interface HomeArtistRouteParams {
  artistId: DeezerId;
  name?: string;
}

export interface HomeGenreRouteParams {
  genreId: DeezerId;
  name: string;
}

export interface HomePlaylistRouteParams {
  playlistId: number;
  name: string;
}

export interface HomeMixRouteParams {
  mixKey: string;
  title?: string;
}

export interface HomeRouteCallbacks {
  onOpenAlbum: (params: HomeAlbumRouteParams) => void;
  onOpenArtist: (params: HomeArtistRouteParams) => void;
  onOpenGenre: (params: HomeGenreRouteParams) => void;
  onOpenPlaylist: (params: HomePlaylistRouteParams) => void;
  onOpenMix: (params: HomeMixRouteParams) => void;
  onOpenRadar: () => void;
}

export interface RadarRelativeDateCopy {
  today: string;
  yesterday: string;
  daysAgo: (days: number) => string;
  oneWeekAgo: string;
  weeksAgo: (weeks: number) => string;
  oneMonthAgo: string;
  monthsAgo: (months: number) => string;
}

export interface RecentCatalogRoutes {
  album: HomeAlbumRouteParams | null;
  artist: HomeArtistRouteParams | null;
}

export type HomePlaybackSource =
  | { kind: 'mood'; moodKey: HomeMoodKey; label: string }
  | { kind: 'release-radar'; label: string }
  | { kind: 'because'; shelf: Pick<HomeShelf, 'key' | 'title'> }
  | { kind: 'chart-collection'; shelf: Pick<HomeShelf, 'key' | 'title'> }
  | { kind: 'charts'; label: string };

/** Preserve catalog identities instead of deriving a destination from display text. */
export function homeAlbumRoute(
  album: Pick<AlbumSummary, 'id' | 'title'>,
): HomeAlbumRouteParams {
  const albumId = normalizedId(album.id);
  if (albumId === null) throw new Error('Home album id must not be empty');
  const title = optionalLabel(album.title);
  return { albumId, ...(title === undefined ? {} : { title }) };
}

export function homeGenreRoute(genre: Pick<Genre, 'id' | 'name'>): HomeGenreRouteParams {
  const genreId = normalizedId(genre.id);
  if (genreId === null) throw new Error('Home genre id must not be empty');
  const name = genre.name.trim();
  if (name.length === 0) throw new Error('Home genre name must not be empty');
  return { genreId, name };
}

function requiredContextLabel(value: string): string {
  const label = value.trim();
  if (label.length === 0) throw new Error('Home playback context label must not be empty');
  return label;
}

/** Centralize the semantic queue identity used by every directly playable Home card. */
export function homeQueueContext(source: HomePlaybackSource): QueueContext {
  switch (source.kind) {
    case 'mood':
      if (source.moodKey === 'top') {
        throw new Error('Top is the Home discovery view, not a playable mood context');
      }
      return {
        type: 'home',
        id: `mood:${source.moodKey}`,
        label: requiredContextLabel(source.label),
      };
    case 'release-radar':
      return {
        type: 'home',
        id: 'release-radar',
        label: requiredContextLabel(source.label),
      };
    case 'because':
      return {
        type: 'home',
        id: `because:${requireHomeMixKey(source.shelf.key)}`,
        label: requiredContextLabel(source.shelf.title),
      };
    case 'chart-collection':
      return {
        type: 'chart',
        id: `collection:${requireHomeMixKey(source.shelf.key)}`,
        label: requiredContextLabel(source.shelf.title),
      };
    case 'charts':
      return {
        type: 'chart',
        id: 'home',
        label: requiredContextLabel(source.label),
      };
  }
}

/** Preserve the public-playlist identity used by the shared detail route. */
export function homePlaylistRoute(
  playlist: Pick<PlaylistSummary, 'id' | 'name'>,
): HomePlaylistRouteParams {
  if (!Number.isSafeInteger(playlist.id) || playlist.id <= 0) {
    throw new Error(`Home public playlist id must be a positive integer; received ${playlist.id}`);
  }
  const name = playlist.name.trim();
  if (name.length === 0) throw new Error('Home public playlist name must not be empty');
  return { playlistId: playlist.id, name };
}

export function requireHomeMixKey(value: string): string {
  const key = value.trim();
  if (key.length === 0) throw new Error('Home mix key must not be empty');
  return key;
}

export function homeMixRoute(shelf: Pick<HomeShelf, 'key' | 'title'>): HomeMixRouteParams {
  const title = shelf.title.trim();
  return {
    mixKey: requireHomeMixKey(shelf.key),
    ...(title.length === 0 ? {} : { title }),
  };
}

export function findHomeMix(
  shelves: readonly HomeShelf[],
  mixKey: string,
): HomeShelf | null {
  const key = requireHomeMixKey(mixKey);
  return shelves.find((shelf) => shelf.key === key) ?? null;
}

/** Match the compact web Home shelf without changing the full playback context. */
export function homeRecentShelf(
  recent: readonly RecentPlay[],
  limit = HOME_RECENT_SHELF_LIMIT,
): RecentPlay[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`Recently Heard shelf limit must be a non-negative integer; received ${limit}`);
  }
  return recent.slice(0, limit);
}

function normalizedId(value: string | number): DeezerId | null {
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function optionalLabel(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/** Resolve only catalog destinations the persisted history row can identify safely. */
export function recentCatalogRoutes(play: RecentPlay): RecentCatalogRoutes {
  const albumId = deezerReferenceIdFromRouteValue(play.album_id);
  const primaryArtistId = deezerReferenceIdFromRouteValue(play.artist_id);
  const fallbackArtist = play.artists.find(
    (artist) => deezerReferenceIdFromRouteValue(artist.id) !== null,
  );
  const artistId = primaryArtistId
    ?? deezerReferenceIdFromRouteValue(fallbackArtist?.id);
  const matchingArtist =
    artistId === null
      ? undefined
      : play.artists.find(
          (artist) => deezerReferenceIdFromRouteValue(artist.id) === artistId,
        );
  const artistName =
    primaryArtistId === null
      ? optionalLabel(fallbackArtist?.name ?? '')
      : optionalLabel(play.artist) ?? optionalLabel(matchingArtist?.name ?? '');
  const albumTitle = optionalLabel(play.album);

  return {
    album:
      albumId === null
        ? null
        : {
            albumId,
            ...(albumTitle === undefined ? {} : { title: albumTitle }),
          },
    artist:
      artistId === null
        ? null
        : {
            artistId,
            ...(artistName === undefined ? {} : { name: artistName }),
          },
  };
}

export function greetingKeyForHour(hour: number): GreetingKey {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`hour must be an integer from 0 to 23; received ${String(hour)}`);
  }
  if (hour < 5) return 'greetingNight';
  if (hour < 11) return 'greetingMorning';
  if (hour < 18) return 'greetingDay';
  return 'greetingEvening';
}

export function homeDisplayName(displayName: string | null): string | null {
  const normalized = displayName?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

/**
 * Calendar-day release recency matching the production web thresholds. Parsing
 * is strict so malformed API dates never become a misleading relative label.
 */
export function formatRadarReleaseDate(
  isoDate: string,
  now: Date,
  copy: RadarRelativeDateCopy,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (match === null || Number.isNaN(now.getTime())) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const releaseDay = Date.UTC(year, month - 1, day);
  const parsed = new Date(releaseDay);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return '';
  }
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - releaseDay) / 86_400_000);
  if (days <= 0) return copy.today;
  if (days === 1) return copy.yesterday;
  if (days < 7) return copy.daysAgo(days);
  if (days < 14) return copy.oneWeekAgo;
  if (days < 31) return copy.weeksAgo(Math.floor(days / 7));
  if (days < 61) return copy.oneMonthAgo;
  return copy.monthsAgo(Math.floor(days / 30));
}

export function testIdSegment(value: string | number): string {
  const segment = String(value)
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return segment.length > 0 ? segment : 'item';
}

export function assertHomeRouteCallbacks(value: unknown): asserts value is HomeRouteCallbacks {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as Partial<HomeRouteCallbacks>).onOpenAlbum !== 'function' ||
    typeof (value as Partial<HomeRouteCallbacks>).onOpenArtist !== 'function' ||
    typeof (value as Partial<HomeRouteCallbacks>).onOpenGenre !== 'function' ||
    typeof (value as Partial<HomeRouteCallbacks>).onOpenPlaylist !== 'function' ||
    typeof (value as Partial<HomeRouteCallbacks>).onOpenMix !== 'function' ||
    typeof (value as Partial<HomeRouteCallbacks>).onOpenRadar !== 'function'
  ) {
    throw new Error(
      'HomeScreen requires onOpenAlbum, onOpenArtist, onOpenGenre, onOpenPlaylist, onOpenMix, and onOpenRadar route callbacks',
    );
  }
}
