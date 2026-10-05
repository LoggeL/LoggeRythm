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
