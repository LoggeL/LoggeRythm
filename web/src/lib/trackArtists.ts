import type { ArtistRef, Track } from "@/types";

export type TrackArtistDescriptor = Pick<
  Track,
  "artist" | "artist_id" | "artists"
>;

/**
 * Resolve the complete ordered performer credit list. Older persisted tracks
 * may not have `artists`, so their explicit primary performer remains visible.
 */
export function trackArtistCredits(
  track: TrackArtistDescriptor,
): readonly ArtistRef[] {
  return track.artists && track.artists.length > 0
    ? track.artists
    : [{ id: track.artist_id ?? "", name: track.artist }];
}

/** Plain-text performer credit for compact UI and browser media metadata. */
export function trackArtistLabel(track: TrackArtistDescriptor): string {
  return trackArtistCredits(track).map((artist) => artist.name).join(", ");
}
