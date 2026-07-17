import type { DeezerId, DeezerPlaylistTrack, Track } from '../api/types';
import { trackArtistLabel } from '../api/trackArtists';
import type { AppLocale } from '../localization';
export { recentSearchStorageKey } from '../data/accountStorage';

export const SEARCH_TABS = ['all', 'track', 'album', 'artist', 'playlist'] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];

export const SEARCH_SORTS = ['relevance', 'title', 'dur-asc', 'dur-desc'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
export type SearchEntity = Exclude<SearchTab, 'all'>;

export interface SearchAlbumRouteParams { albumId: DeezerId; title: string }
export interface SearchArtistRouteParams { artistId: DeezerId; name: string }
export interface SearchGenreRouteParams { genreId: DeezerId; name: string }

export interface SearchRouteCallbacks {
  onOpenAlbum: (params: SearchAlbumRouteParams) => void;
  onOpenArtist: (params: SearchArtistRouteParams) => void;
  onOpenGenre: (params: SearchGenreRouteParams) => void;
}

const RECENT_SEARCH_LIMIT = 8;
export const SEARCH_DEBOUNCE_MS = 280;

export function normalizeSearchInput(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function isSearchableQuery(value: string): boolean {
  return Array.from(normalizeSearchInput(value)).length >= 2;
}

/** Old cached rows and their actions are live only for the current input identity. */
export function isCurrentSearchQuery(input: string, publishedQuery: string): boolean {
  const normalized = normalizeSearchInput(input);
  return isSearchableQuery(normalized) && publishedQuery === normalized;
}

/**
 * Schedule publication of one canonical search identity. React owns the
 * resulting value; TanStack Query remains the sole owner of server state.
 * Returning the timer cleanup makes rapid input replacement deterministic.
 */
export function scheduleSearchDebounce(
  query: string,
  publish: (normalizedQuery: string) => void,
  delayMs = SEARCH_DEBOUNCE_MS,
): () => void {
  const normalized = normalizeSearchInput(query);
  if (!isSearchableQuery(normalized)) return () => undefined;

  const timer = setTimeout(() => publish(normalized), delayMs);
  return () => clearTimeout(timer);
}

export function wantedSearchEntities(tab: SearchTab): Readonly<Record<SearchEntity, boolean>> {
  return {
    track: tab === 'all' || tab === 'track',
    album: tab === 'all' || tab === 'album',
    artist: tab === 'all' || tab === 'artist',
    playlist: tab === 'all' || tab === 'playlist',
  };
}

export function sortSearchTracks(
  tracks: readonly Track[],
  sort: SearchSort,
  locale: AppLocale,
): Track[] {
  if (sort === 'relevance') return [...tracks];
  const sorted = [...tracks];
  if (sort === 'title') {
    sorted.sort((left, right) =>
      left.title.localeCompare(right.title, locale, { sensitivity: 'base' }),
    );
  } else if (sort === 'dur-asc') {
    sorted.sort((left, right) => left.duration_sec - right.duration_sec);
  } else {
    sorted.sort((left, right) => right.duration_sec - left.duration_sec);
  }
  return sorted;
}

export function resultLimit(tab: SearchTab, entity: SearchEntity): number | undefined {
  return tab === 'all' ? (entity === 'track' ? 6 : 5) : undefined;
}

/** Preserve external playlist order and duplicates before strict full-track resolution. */
export function orderedPlaylistTrackIds(
  tracks: readonly Pick<DeezerPlaylistTrack, 'id'>[],
): DeezerId[] {
  return tracks.map((track, index) => {
    const id = String(track.id).trim();
    if (id.length === 0) throw new Error(`External playlist track ${index} has no id`);
    return id;
  });
}

function localeFold(value: string, locale: AppLocale): string {
  return normalizeSearchInput(value).toLocaleLowerCase(locale);
}

export function recentSearchIdentity(value: string, locale: AppLocale): string {
  return `${locale}:${localeFold(value, locale)}`;
}

/**
 * A locale change re-decodes the same persisted JSON with different folding
 * rules. Treat it as a distinct hydration generation so an active query
 * cannot persist over history while that read is still in flight.
 */
export function recentSearchHydrationIdentity(
  historyKey: string,
  locale: AppLocale,
): string {
  return `${locale}:${historyKey}`;
}

export function addRecentSearch(
  current: readonly string[],
  query: string,
  locale: AppLocale,
): string[] {
  const normalized = normalizeSearchInput(query);
  if (!isSearchableQuery(normalized)) return [...current];
  const identity = localeFold(normalized, locale);
  return [
    normalized,
    ...current.filter((candidate) => localeFold(candidate, locale) !== identity),
  ].slice(0, RECENT_SEARCH_LIMIT);
}

export function removeRecentSearch(
  current: readonly string[],
  query: string,
  locale: AppLocale,
): string[] {
  const identity = localeFold(query, locale);
  return current.filter(
    (candidate) => localeFold(candidate, locale) !== identity,
  );
}

/** Format an API/player duration without implying that a zero value is known. */
export function formatSearchDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`Search metadata duration must be a finite non-negative number, got ${String(seconds)}`);
  }
  if (seconds === 0) return null;
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

/** Match the web client's documented Deezer-rank-to-percentage presentation. */
export function searchPopularityPercent(rank: number): number | null {
  if (!Number.isFinite(rank) || rank < 0) {
    throw new Error(`Search metadata rank must be a finite non-negative number, got ${String(rank)}`);
  }
  if (rank === 0) return null;
  return Math.max(2, Math.min(100, Math.round((rank / 1_000_000) * 100)));
}

export function searchTrackCredit(
  track: Pick<Track, 'artist' | 'album'>
    & Partial<Pick<Track, 'artist_id' | 'artists'>>,
): string {
  const artist = trackArtistLabel(track).trim();
  const album = track.album.trim();
  return [artist, album].filter((value) => value.length > 0).join(' · ');
}

export function decodeRecentSearches(raw: string | null, locale: AppLocale): string[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Recent search history is invalid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('Recent search history must be an array of strings');
  }
  const recent: string[] = [];
  for (const entry of value) {
    const normalized = normalizeSearchInput(entry);
    if (
      isSearchableQuery(normalized) &&
      !recent.some((candidate) => localeFold(candidate, locale) === localeFold(normalized, locale))
    ) {
      recent.push(normalized);
    }
  }
  return recent.slice(0, RECENT_SEARCH_LIMIT);
}

export function assertSearchRouteCallbacks(value: unknown): asserts value is SearchRouteCallbacks {
  const candidate = value as Partial<SearchRouteCallbacks> | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.onOpenAlbum !== 'function' ||
    typeof candidate.onOpenArtist !== 'function' ||
    typeof candidate.onOpenGenre !== 'function'
  ) {
    throw new Error(
      'SearchScreen requires album, artist, and genre navigation callbacks',
    );
  }
}
