import type {
  PlaylistSummary,
  ResolveResult,
  Track,
  UnmatchedTrack,
} from '../../api/types';

export type SpotifyImportListRow =
  | { kind: 'matched-track'; track: Track; index: number }
  | { kind: 'save-controls' }
  | { kind: 'destinations-state' }
  | { kind: 'destination'; playlist: PlaylistSummary; index: number }
  | { kind: 'unmatched-header' }
  | { kind: 'unmatched-track'; track: UnmatchedTrack; index: number };

interface SpotifyImportListRowsInput {
  result: ResolveResult;
  playlists: readonly PlaylistSummary[];
  showDestinationRows: boolean;
}

/** Flatten every potentially long import collection into one vertical owner. */
export function createSpotifyImportListRows({
  result,
  playlists,
  showDestinationRows,
}: SpotifyImportListRowsInput): SpotifyImportListRow[] {
  const rows: SpotifyImportListRow[] = result.tracks.map((track, index) => ({
    kind: 'matched-track',
    track,
    index,
  }));

  if (result.tracks.length > 0) {
    rows.push({ kind: 'save-controls' }, { kind: 'destinations-state' });
    if (showDestinationRows) {
      playlists.forEach((playlist, index) => {
        rows.push({ kind: 'destination', playlist, index });
      });
    }
  }

  if (result.unmatched.length > 0) {
    rows.push({ kind: 'unmatched-header' });
    result.unmatched.forEach((track, index) => {
      rows.push({ kind: 'unmatched-track', track, index });
    });
  }
  return rows;
}

export function spotifyImportListRowKey(row: SpotifyImportListRow): string {
  switch (row.kind) {
    case 'matched-track':
      return `matched:${row.track.id}:${row.index}`;
    case 'save-controls':
      return 'save:controls';
    case 'destinations-state':
      return 'save:destinations-state';
    case 'destination':
      return `destination:${row.playlist.id}:${row.index}`;
    case 'unmatched-header':
      return 'unmatched:header';
    case 'unmatched-track':
      return `unmatched:${row.track.title}:${row.track.artist}:${row.index}`;
  }
}
