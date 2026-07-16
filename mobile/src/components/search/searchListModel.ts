import type {
  ArtistSummary,
  PlaylistSearchResult,
  Track,
} from '../../api/types';
import type { AlbumCard } from '../../domain/catalog';

export type SearchListRow =
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
}: SearchListCollections): SearchListRow[] {
  const rows: SearchListRow[] = [];
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
