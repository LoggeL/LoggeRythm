import type {
  ArtistSummary,
  PlaylistSearchResult,
  Track,
} from '../../api/types';
import type { AlbumCard } from '../../domain/catalog';
import type { SearchTopResult } from '../../screens/searchModel';

export type SearchListRow =
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
  /** Promoted hit shown above every section; omitted outside the "all" tab. */
  topResult?: SearchTopResult | null;
}

/**
 * Flatten heterogeneous search results into one vertical-list ownership model.
 * Horizontal entity rails remain rows of that owner; only tracks become
 * individual vertical rows so long result sets are actually virtualized.
 */
export function createSearchListRows({
  artists,
  tracks,
  albums,
  playlists,
  topResult = null,
}: SearchListCollections): SearchListRow[] {
  const rows: SearchListRow[] = [];
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
