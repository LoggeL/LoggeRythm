/**
 * Instant search over the songs the client already knows the user saved.
 * Pure and synchronous: it runs on every keystroke, before any request.
 */

/** The track fields a library match reads; `Track` satisfies it. */
export type LibraryMatchTrack = {
  id: string | number;
  title: string;
  artist: string;
  artists?: readonly { name: string }[];
  album: string;
  isrc?: string;
  duration_sec?: number;
};

function normalizeIsrc(raw?: string): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  return cleaned.length < 4 || /^0+$/.test(cleaned) ? "" : cleaned;
}

export type LibraryEntry<T> = {
  track: T;
  title: string;
  artists: string[];
  /** Title, every credited artist and the album, one per line. */
  text: string;
};

/** Letters Unicode decomposition leaves untouched but people type without. */
const PLAIN_LETTERS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  ł: "l",
  þ: "th",
  ı: "i",
};

/**
 * Comparable form of a title, name or query: lower case, no diacritics, no
 * apostrophes, any other punctuation as a word break, single spaces.
 */
export function foldSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[ßæœøđðłþı]/g, (letter) => PLAIN_LETTERS[letter])
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Prepares saved tracks for matching. The first occurrence of a track id (or
 * matching ISRC recording) wins, so list the sources in the order their tracks
 * should rank on a tie.
 */
export function indexLibraryTracks<T extends LibraryMatchTrack>(tracks: readonly T[]): LibraryEntry<T>[] {
  const seenIds = new Set<string>();
  const seenIsrcs = new Set<string>();
  const entries: LibraryEntry<T>[] = [];
  for (const track of tracks) {
    const id = String(track.id);
    const isrc = normalizeIsrc(track.isrc);
    if (seenIds.has(id) || (isrc && seenIsrcs.has(isrc))) continue;
    seenIds.add(id);
    if (isrc) seenIsrcs.add(isrc);
    const title = foldSearchText(track.title);
    const artists = [...new Set([track.artist, ...(track.artists ?? []).map((artist) => artist.name)].map(foldSearchText))].filter(Boolean);
    entries.push({ track, title, artists, text: [title, ...artists, foldSearchText(track.album)].join("\n") });
  }
  return entries;
}

const NO_MATCH = -1;

/** Lower is better; `NO_MATCH` when a query word is missing from the track. */
function matchRank(entry: LibraryEntry<unknown>, term: string, words: string[]): number {
  if (!words.every((word) => entry.text.includes(word))) return NO_MATCH;
  if (entry.title === term) return 0;
  if (entry.title.startsWith(term)) return 1;
  const titleWords = entry.title.split(" ");
  if (words.every((word) => titleWords.some((titleWord) => titleWord.startsWith(word)))) return 2;
  if (words.every((word) => entry.title.includes(word))) return 3;
  if (entry.artists.some((artist) => artist.startsWith(term))) return 4;
  return 5;
}

/**
 * Saved tracks matching what is typed, best first. Every whitespace-separated
 * word of the input must occur in the title, a credited artist or the album.
 * An exact title leads, then titles starting with the input, titles whose
 * words start with the input's words, titles containing them, artists starting
 * with the input, and finally matches spread over artist and album. Ties keep
 * the index order. Input without a letter or digit matches nothing.
 */
export function matchLibraryTracks<T>(index: readonly LibraryEntry<T>[], input: string): T[] {
  const term = foldSearchText(input);
  if (!term) return [];
  const words = term.split(" ");
  const ranked: { track: T; rank: number }[] = [];
  for (const entry of index) {
    const rank = matchRank(entry, term, words);
    if (rank !== NO_MATCH) ranked.push({ track: entry.track, rank });
  }
  // Array.prototype.sort is stable: equal ranks stay in index order.
  return ranked.sort((a, b) => a.rank - b.rank).map(({ track }) => track);
}

/**
 * `tracks` without those already shown elsewhere, in unchanged order. Returns
 * the same array when nothing is removed, so positions in it stay valid.
 */
export function withoutTracks<T extends { id: string | number; isrc?: string }>(
  tracks: T[],
  shown: readonly { id: string | number; isrc?: string }[],
): T[] {
  if (shown.length === 0) return tracks;
  const hiddenIds = new Set(shown.map((track) => String(track.id)));
  const hiddenIsrcs = new Set(
    shown.map((track) => normalizeIsrc(track.isrc)).filter(Boolean),
  );
  const rest = tracks.filter((track) => {
    if (hiddenIds.has(String(track.id))) return false;
    const isrc = normalizeIsrc(track.isrc);
    return !(isrc && hiddenIsrcs.has(isrc));
  });
  return rest.length === tracks.length ? tracks : rest;
}
