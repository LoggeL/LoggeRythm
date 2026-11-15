import type { Track } from "../../types";

export type SearchTab = "all" | "track" | "album" | "artist" | "playlist";
export type SearchSort = "relevance" | "title" | "dur-asc" | "dur-desc";

export function sortSearchTracks(tracks: Track[], sort: SearchSort): Track[] {
  if (sort === "relevance") return tracks;
  const sorted = [...tracks];
  if (sort === "title")
    sorted.sort((a, b) => a.title.localeCompare(b.title, "de"));
  if (sort === "dur-asc")
    sorted.sort((a, b) => a.duration_sec - b.duration_sec);
  if (sort === "dur-desc")
    sorted.sort((a, b) => b.duration_sec - a.duration_sec);
  return sorted;
}

export type TopHit<T, A> = { kind: "artist"; artist: A } | { kind: "track"; track: T; index: number };

function comparable(value: string): string {
  return value.trim().toLocaleLowerCase("de");
}

/**
 * The single best match for the "Top-Treffer" card. An artist wins when the
 * query is (the start of) their name; otherwise the most relevant track does.
 */
export function pickTopHit<T extends { title: string }, A extends { name: string }>(
  query: string,
  tracks: T[],
  artists: A[],
): TopHit<T, A> | null {
  const term = comparable(query);
  const artist = artists[0];
  if (artist && term && comparable(artist.name).startsWith(term)) return { kind: "artist", artist };
  if (tracks.length > 0) return { kind: "track", track: tracks[0], index: 0 };
  return artist ? { kind: "artist", artist } : null;
}
