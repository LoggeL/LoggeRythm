import type { Track } from '../api/types';

export const ARTIST_TRACK_SECTION_ORDER = ['popular', 'search'] as const;

export type ArtistTrackSectionId = (typeof ARTIST_TRACK_SECTION_ORDER)[number];

export interface ArtistTrackListItem {
  kind: ArtistTrackSectionId;
  track: Track;
  /** The occurrence index in the exact playback context for this section. */
  index: number;
}

export interface ArtistTrackListSection {
  id: ArtistTrackSectionId;
  data: ArtistTrackListItem[];
}

export interface ArtistTrackListCollections {
  popularTracks: readonly Track[];
  searchTracks: readonly Track[];
  searchActive: boolean;
}

/**
 * Build the Artist page's two row collections for one SectionList owner.
 * Search results are removed as soon as the normalized query becomes inactive,
 * even if React Query still has a previous result in memory.
 */
export function createArtistTrackListSections({
  popularTracks,
  searchTracks,
  searchActive,
}: ArtistTrackListCollections): ArtistTrackListSection[] {
  return [
    {
      id: 'popular',
      data: popularTracks.map((track, index) => ({
        kind: 'popular',
        track,
        index,
      })),
    },
    {
      id: 'search',
      data: searchActive
        ? searchTracks.map((track, index) => ({
            kind: 'search',
            track,
            index,
          }))
        : [],
    },
  ];
}

/** Section + id + occurrence keeps duplicate backend rows distinct and repeatable. */
export function artistTrackListItemKey(item: ArtistTrackListItem): string {
  return `artist-track:${item.kind}:${encodeURIComponent(String(item.track.id))}:${item.index}`;
}
