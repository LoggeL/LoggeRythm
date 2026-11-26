import type { Track } from '../api/types';
import type { CatalogQueryVisualState } from '../components/catalog/catalogQueryState';
import { resolveRemoteVisualState } from '../data/remoteState';

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
  /**
   * SectionList keys its cells by section: without one it uses the section's
   * position, so the liked block appearing or disappearing (first like, last
   * unlike) shifts every key and remounts all rows, search field included.
   */
  key: ArtistTrackSectionId;
  data: ArtistTrackListItem[];
}

/** The "your liked songs" block of one artist. */
export interface ArtistLikedTrackCollection {
  /** Every liked track crediting the artist: the block's whole playback context. */
  tracks: readonly Track[];
  /**
   * false lists no rows: the block is a one-line expander, so it never
   * repeats the Popular list right under the artist hero.
   */
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

/** The collapsed block has rows to reveal, so its heading is an expander. */
export function artistLikedTracksExpandable(likedTrackCount: number): boolean {
  if (!Number.isInteger(likedTrackCount) || likedTrackCount < 0) {
    throw new Error(`Artist liked track count ${String(likedTrackCount)} is not a row count`);
  }
  return likedTrackCount > 0;
}

/**
 * Build the Artist page's row collections for one SectionList owner: the
 * user's liked tracks by the artist (when there is such a block), Popular,
 * then Search.
 *
 * A collapsed liked block lists no rows (its heading is the expander); an
 * expanded one lists every liked track with its index in the full liked
 * context, so playing any row queues all of them.
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
    sections.push({
      id: 'liked',
      key: 'liked',
      data: (liked.expanded ? liked.tracks : []).map((track, index) => ({ kind: 'liked', track, index })),
    });
  }
  sections.push(
    {
      id: 'popular',
      key: 'popular',
      data: popularTracks.map((track, index) => ({
        kind: 'popular',
        track,
        index,
      })),
    },
    {
      id: 'search',
      key: 'search',
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
