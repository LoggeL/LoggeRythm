import { describe, expect, it } from 'vitest';
import type { PlaylistSummary, ResolveResult, Track } from '../../api/types';
import {
  createSpotifyImportListRows,
  spotifyImportListRowKey,
} from './spotifyImportListModel';

const track = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  artist_id: 'artist-1',
  artists: [{ id: 'artist-1', name: 'Artist' }],
  album: 'Album',
  album_id: 'album-1',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
});

const playlist = (id: number): PlaylistSummary => ({
  id,
  name: `Playlist ${id}`,
  description: null,
  cover_url: null,
  is_public: false,
  track_count: 2,
  owner_name: null,
});

function result(): ResolveResult {
  const duplicate = track('7');
  return {
    type: 'playlist',
    name: 'Import',
    image: '',
    total: 4,
    source_total: 4,
    matched: 2,
    tracks: [duplicate, duplicate],
    unmatched: [
      { title: 'Missing', artist: 'Unknown' },
      { title: 'Missing', artist: 'Unknown' },
    ],
  };
}

describe('Spotify import vertical-list model', () => {
  it('flattens matched, save, destination, and unmatched flows in product order', () => {
    const rows = createSpotifyImportListRows({
      result: result(),
      playlists: [playlist(1), playlist(2)],
      showDestinationRows: true,
    });

    expect(rows.map(({ kind }) => kind)).toEqual([
      'matched-track',
      'matched-track',
      'save-controls',
      'destinations-state',
      'destination',
      'destination',
      'unmatched-header',
      'unmatched-track',
      'unmatched-track',
    ]);
  });

  it('uses occurrence-aware keys across duplicate matched, destination, and unmatched rows', () => {
    const duplicatePlaylist = playlist(1);
    const rows = createSpotifyImportListRows({
      result: result(),
      playlists: [duplicatePlaylist, duplicatePlaylist],
      showDestinationRows: true,
    });
    const keys = rows.map(spotifyImportListRowKey);

    expect(keys).toContain('matched:7:0');
    expect(keys).toContain('matched:7:1');
    expect(keys).toContain('destination:1:0');
    expect(keys).toContain('destination:1:1');
    expect(keys).toContain('unmatched:Missing:Unknown:0');
    expect(keys).toContain('unmatched:Missing:Unknown:1');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('withholds destination rows until their remote body has last-good content', () => {
    const rows = createSpotifyImportListRows({
      result: result(),
      playlists: [playlist(1)],
      showDestinationRows: false,
    });

    expect(rows.some(({ kind }) => kind === 'destinations-state')).toBe(true);
    expect(rows.some(({ kind }) => kind === 'destination')).toBe(false);
  });
});
