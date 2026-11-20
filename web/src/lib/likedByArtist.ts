import { isArtistTrack } from "@/components/artistSearchModel";
import type { TrackArtistDescriptor } from "@/lib/trackArtists";

/**
 * The liked tracks that credit one artist, in likes order (most recently
 * liked first). A track counts when the artist is its primary performer or
 * any entry of its credit list; IDs are compared as strings. Likes saved
 * before performer IDs were stored carry no ID at all and match by exact
 * name instead (the rule of `isArtistTrack`).
 */
export function likedTracksByArtist<T extends TrackArtistDescriptor>(
  likes: readonly T[],
  artistId: string | number,
  artistName: string,
): T[] {
  if (String(artistId).trim() === "") {
    throw new Error("Artist id must not be empty");
  }
  return likes.filter((track) => isArtistTrack(track, artistId, artistName));
}
