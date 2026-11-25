import type { Playlist, Track } from '../api/types';
import { trackArtistCredits } from '../api/trackArtists';
import { isTrackLiked, normalizeIsrc } from '../data/trackIdentity';
import { isSearchableQuery, normalizeSearchInput, type SearchTab } from './searchModel';

/** Rows of the "In your library" section per tab; other tabs do not show it. */
export const SEARCH_LIBRARY_ALL_TAB_LIMIT = 5;
export const SEARCH_LIBRARY_TRACK_TAB_LIMIT = 20;

export function searchLibraryLimit(tab: SearchTab): number {
  if (tab === 'all') return SEARCH_LIBRARY_ALL_TAB_LIMIT;
  if (tab === 'track') return SEARCH_LIBRARY_TRACK_TAB_LIMIT;
  return 0;
}

/** Letters without a canonical decomposition that users still type unaccented. */
const FOLDED_LETTERS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  ı: 'i',
  þ: 'th',
};

/**
 * ASCII and common typographic punctuation. An explicit class instead of
 * `\p{P}` keeps the matcher independent of the engine's Unicode tables.
 */
const PUNCTUATION = /[!-/:-@[-`{-~¡-¿–—―…‚„“”«»‹›·•]+/g;

/**
 * Case- and diacritics-insensitive comparison form: lower case, combining
 * marks removed, apostrophes dropped, other punctuation as a word break,
 * single spaces. "Beyoncé" and "beyonce", "Straße" and "strasse", "Don't"
 * and "dont", "AC/DC" and "ac dc" compare equal.
 */
export function foldSearchText(value: string): string {
  const folded = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’‘`´]/g, '')
    .replace(/[ßæœøđðłıþ]/g, (letter) => {
      const replacement = FOLDED_LETTERS[letter];
      if (replacement === undefined) {
        throw new Error(`Search folding has no replacement for "${letter}"`);
      }
      return replacement;
    })
    .replace(PUNCTUATION, ' ');
  return normalizeSearchInput(folded);
}

export interface SearchLibrarySources {
  /** Liked tracks, newest first. */
  likes: readonly Track[];
  /** Playlist details that are already on the device; owned and collaborated ones count. */
  playlists: readonly (Pick<Playlist, 'is_owner' | 'tracks'> & { is_collaborator?: boolean })[];
  /** Tracks of the verified offline download manifest. */
  downloads: readonly Track[];
}

/** A saved track is a catalog identity, not one occurrence in a playlist. */
function catalogTrack(track: Track): Track {
  if (
    track.playlist_entry_id === undefined
    && track.added_by === undefined
    && track.added_at === undefined
  ) {
    return track;
  }
  const {
    playlist_entry_id: _entryId,
    added_by: _addedBy,
    added_at: _addedAt,
    ...catalog
  } = track;
  return catalog;
}

/**
 * Every saved track the device already knows, once per track id (or ISRC).
 * Source order (likes, own playlists, downloads) is the tie-break order.
 */
export function collectSearchLibraryTracks({
  likes,
  playlists,
  downloads,
}: SearchLibrarySources): Track[] {
  const seenIds = new Set<string>();
  const seenIsrcs = new Set<string>();
  const tracks: Track[] = [];
  const add = (track: Track, source: string) => {
    const id = String(track.id).trim();
    if (id.length === 0) throw new Error(`Saved ${source} track "${track.title}" has no id`);
    const isrc = normalizeIsrc(track.isrc);
    if (seenIds.has(id) || (isrc.length > 0 && seenIsrcs.has(isrc))) return;
    seenIds.add(id);
    if (isrc.length > 0) seenIsrcs.add(isrc);
    tracks.push(catalogTrack(track));
  };
  for (const track of likes) add(track, 'liked');
  for (const playlist of playlists) {
    if (!playlist.is_owner && !playlist.is_collaborator) continue;
    for (const track of playlist.tracks) add(track, 'playlist');
  }
  for (const track of downloads) add(track, 'downloaded');
  return tracks;
}

/** One saved track with its comparison forms, folded once per library change. */
export interface SearchLibraryEntry {
  track: Track;
  title: string;
  artists: readonly string[];
  album: string;
}

export function createSearchLibraryIndex(tracks: readonly Track[]): SearchLibraryEntry[] {
  return tracks.map((track) => ({
    track,
    title: foldSearchText(track.title),
    // The plain `artist` label can differ from the credit list on older rows.
    artists: [...new Set(
      [track.artist, ...trackArtistCredits(track).map(({ name }) => name)]
        .map(foldSearchText)
        .filter((name) => name.length > 0),
    )],
    album: foldSearchText(track.album),
  }));
}

/** Lower is better. A null rank means at least one query token is missing. */
const RANK_TITLE_EXACT = 0;
const RANK_TITLE_PREFIX = 1;
const RANK_TITLE_WORDS = 2;
const RANK_TITLE_CONTAINS = 3;
const RANK_ARTIST_PREFIX = 4;
const RANK_TITLE_AND_ARTIST = 5;
const RANK_ANY_FIELD = 6;

function everyTokenStartsAWord(text: string, tokens: readonly string[]): boolean {
  const words = text.split(' ');
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

function rankSearchLibraryEntry(
  entry: SearchLibraryEntry,
  needle: string,
  tokens: readonly string[],
): number | null {
  const inTitle = (token: string) => entry.title.includes(token);
  const inArtists = (token: string) => entry.artists.some((name) => name.includes(token));
  const inAlbum = (token: string) => entry.album.includes(token);
  if (!tokens.every((token) => inTitle(token) || inArtists(token) || inAlbum(token))) {
    return null;
  }
  if (entry.title === needle) return RANK_TITLE_EXACT;
  if (entry.title.startsWith(needle)) return RANK_TITLE_PREFIX;
  if (tokens.every(inTitle)) {
    return everyTokenStartsAWord(entry.title, tokens)
      ? RANK_TITLE_WORDS
      : RANK_TITLE_CONTAINS;
  }
  if (entry.artists.some((name) => name.startsWith(needle))) return RANK_ARTIST_PREFIX;
  if (tokens.every((token) => inTitle(token) || inArtists(token))) return RANK_TITLE_AND_ARTIST;
  return RANK_ANY_FIELD;
}

/**
 * Saved tracks matching the text currently in the search field, best first.
 * Every whitespace-separated token must occur in the title, an artist name or
 * the album. Exact and prefix title matches lead, then other title matches,
 * artists, and finally matches that need the album; equal ranks keep the
 * library order. Inputs below the search minimum match nothing.
 */
export function matchSearchLibrary(
  index: readonly SearchLibraryEntry[],
  input: string,
): Track[] {
  if (!isSearchableQuery(input)) return [];
  const needle = foldSearchText(input);
  const tokens = needle.split(' ').filter((token) => token.length > 0);
  // Input made only of punctuation names nothing.
  if (tokens.length === 0) return [];

  const ranked: { track: Track; rank: number; order: number }[] = [];
  index.forEach((entry, order) => {
    const rank = rankSearchLibraryEntry(entry, needle, tokens);
    if (rank !== null) ranked.push({ track: entry.track, rank, order });
  });
  ranked.sort((left, right) => left.rank - right.rank || left.order - right.order);
  return ranked.map(({ track }) => track);
}

/**
 * Remote tracks minus the ones the library section already shows (matching by
 * ID or recording identity when `libraryTracks` is provided). Order is
 * preserved, so the result is both the visible "Songs" list and its queue.
 */
export function withoutLibraryTracks(
  tracks: readonly Track[],
  libraryTrackIds: ReadonlySet<string>,
  libraryTracks?: readonly Track[],
): Track[] {
  if (libraryTrackIds.size === 0 && (libraryTracks === undefined || libraryTracks.length === 0)) {
    return [...tracks];
  }
  return tracks.filter((track) => {
    if (libraryTrackIds.has(track.id)) return false;
    if (libraryTracks !== undefined && libraryTracks.length > 0) {
      return !isTrackLiked(libraryTracks, track);
    }
    return true;
  });
}
