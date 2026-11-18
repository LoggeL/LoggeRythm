import type { Track } from '../api/types';
import type { CatalogQueryVisualState } from '../components/catalog/catalogQueryState';
import { resolveRemoteVisualState } from '../data/remoteState';
import { ARTIST_LIKED_TRACK_PREVIEW } from './catalogModel';

export const ARTIST_TRACK_SECTION_ORDER = ['liked', 'popular', 'search'] as const;

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

/** The "your liked songs" block of one artist. */
export interface ArtistLikedTrackCollection {
  /** Every liked track crediting the artist: the block's whole playback context. */
  tracks: readonly Track[];
  /** false lists only the first `ARTIST_LIKED_TRACK_PREVIEW` rows. */
  expanded: boolean;
}

export interface ArtistTrackListCollections {
  /**
   * null leaves the liked block out of the page, heading included (see
   * `artistLikedSectionVisible`). An empty `tracks` keeps the heading, which
   * then reports why there are no rows.
   */
  liked: ArtistLikedTrackCollection | null;
  popularTracks: readonly Track[];
  searchTracks: readonly Track[];
  searchActive: boolean;
}

/**
 * Whether the liked block takes part in the Artist page.
 *
 * - While the likes are loading it is absent: most artists have no liked
 *   track, so a placeholder would usually collapse to nothing again.
 * - Once the likes are known it exists only if a liked track credits the artist.
 * - If the likes could not be loaded at all it stays, so its heading reports
 *   the failure instead of looking like "nothing liked".
 */
export function artistLikedSectionVisible(
  likes: CatalogQueryVisualState,
  likedTrackCount: number,
): boolean {
  if (!Number.isInteger(likedTrackCount) || likedTrackCount < 0) {
    throw new Error(`Artist liked track count ${String(likedTrackCount)} is not a row count`);
  }
  const { body } = resolveRemoteVisualState({
    hasData: likes.hasData,
    empty: likedTrackCount === 0,
    pending: likes.isPending,
    fetching: likes.isFetching,
    stale: likes.isStale,
    fetchStatus: likes.fetchStatus,
    error: likes.error,
  });
  return body === 'content' || body === 'offline' || body === 'hard-error';
}

/** More liked tracks exist than the collapsed block lists: it offers "show all". */
export function artistLikedTracksExpandable(likedTrackCount: number): boolean {
  return likedTrackCount > ARTIST_LIKED_TRACK_PREVIEW;
}

/**
 * Build the Artist page's row collections for one SectionList owner: the
 * user's liked tracks by the artist (when there is such a block), Popular,
 * then Search.
 *
 * A collapsed liked block lists a preview, but every row keeps its index in
 * the full liked context, so playing a previewed row queues all of them.
 * Search results are removed as soon as the normalized query becomes inactive,
 * even if React Query still has a previous result in memory.
 */
export function createArtistTrackListSections({
  liked,
  popularTracks,
  searchTracks,
  searchActive,
}: ArtistTrackListCollections): ArtistTrackListSection[] {
  const sections: ArtistTrackListSection[] = [];
  if (liked !== null) {
    const listed = liked.expanded
      ? liked.tracks
      : liked.tracks.slice(0, ARTIST_LIKED_TRACK_PREVIEW);
    sections.push({
      id: 'liked',
      data: listed.map((track, index) => ({ kind: 'liked', track, index })),
    });
  }
  sections.push(
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
  );
  return sections;
}

/** Section + id + occurrence keeps duplicate backend rows distinct and repeatable. */
export function artistTrackListItemKey(item: ArtistTrackListItem): string {
  return `artist-track:${item.kind}:${encodeURIComponent(String(item.track.id))}:${item.index}`;
}
