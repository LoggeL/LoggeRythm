import type {
  ArtistSummary,
  PlaylistSearchResult,
  Track,
} from '../../api/types';
import type { AlbumCard } from '../../domain/catalog';
import type { SearchTopResult } from '../../screens/searchModel';

export type SearchListRow =
  | { kind: 'library-header' }
  | { kind: 'library-track'; track: Track; index: number }
  | { kind: 'library-notice' }
  | { kind: 'remote-status' }
  | { kind: 'top-result'; result: SearchTopResult }
  | { kind: 'artist-section'; artists: readonly ArtistSummary[] }
  | { kind: 'track-header' }
  | { kind: 'track'; track: Track; index: number }
  | { kind: 'album-section'; albums: readonly AlbumCard[] }
  | { kind: 'playlist-section'; playlists: readonly PlaylistSearchResult[] };

export interface SearchListCollections {
  artists: readonly ArtistSummary[];
  tracks: readonly Track[];
  albums: readonly AlbumCard[];
  playlists: readonly PlaylistSearchResult[];
  /** Promoted hit shown above every remote section; omitted outside the "all" tab. */
  topResult?: SearchTopResult | null;
  /**
   * Saved tracks matching the current input. They lead the list and need no
   * request, so they are present before, during and after the remote search.
   */
  libraryTracks?: readonly Track[];
  /**
   * A source of the library section failed to load. The notice closes the
   * section, below its tracks, and keeps the section visible without matches.
   */
  libraryNotice?: boolean;
  /**
   * Reserve the row for remote progress, failures and the empty state. It sits
   * directly below the library section, which therefore never moves when the
   * remote search settles.
   */
  remoteStatus?: boolean;
}

/**
 * Flatten heterogeneous search results into one vertical-list ownership model.
 * Horizontal entity rails remain rows of that owner; only tracks become
 * individual vertical rows so long result sets are actually virtualized.
 * Order: library matches, remote status, then the remote sections.
 */
export function createSearchListRows({
  artists,
  tracks,
  albums,
  playlists,
  topResult = null,
  libraryTracks = [],
  libraryNotice = false,
  remoteStatus = false,
}: SearchListCollections): SearchListRow[] {
  const rows: SearchListRow[] = [];
  if (libraryTracks.length > 0 || libraryNotice) {
    rows.push({ kind: 'library-header' });
    libraryTracks.forEach((track, index) => rows.push({ kind: 'library-track', track, index }));
    if (libraryNotice) rows.push({ kind: 'library-notice' });
  }
  if (remoteStatus) rows.push({ kind: 'remote-status' });
  if (topResult !== null) rows.push({ kind: 'top-result', result: topResult });
  if (artists.length > 0) rows.push({ kind: 'artist-section', artists });
  if (tracks.length > 0) {
    rows.push({ kind: 'track-header' });
    tracks.forEach((track, index) => rows.push({ kind: 'track', track, index }));
  }
  if (albums.length > 0) rows.push({ kind: 'album-section', albums });
  if (playlists.length > 0) rows.push({ kind: 'playlist-section', playlists });
  return rows;
}

export function searchListRowKey(row: SearchListRow): string {
  switch (row.kind) {
    case 'library-header':
      return 'section:library';
    case 'library-track':
      return `library-track:${row.track.id}`;
    case 'library-notice':
      return 'section:library-notice';
    case 'remote-status':
      return 'section:remote-status';
    case 'top-result':
      return 'section:top-result';
    case 'artist-section':
      return 'section:artists';
    case 'track-header':
      return 'section:tracks';
    case 'track':
      return `track:${row.track.id}:${row.index}`;
    case 'album-section':
      return 'section:albums';
    case 'playlist-section':
      return 'section:playlists';
  }
}
