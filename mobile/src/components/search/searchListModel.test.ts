import { describe, expect, it } from 'vitest';
import type {
  ArtistSummary,
  PlaylistSearchResult,
  Track,
} from '../../api/types';
import type { AlbumCard } from '../../domain/catalog';
import { createSearchListRows, searchListRowKey } from './searchListModel';

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

const artist: ArtistSummary = { id: 'artist-1', name: 'Artist', picture: '' };
const album: AlbumCard = {
  id: 'album-1',
  title: 'Album',
  artistName: 'Artist',
  artworkUrl: null,
};
const playlist: PlaylistSearchResult = {
  id: 'playlist-1',
  title: 'Playlist',
  cover: '',
  track_count: 2,
};

describe('search vertical-list model', () => {
  it('keeps product section order while making every track its own virtual row', () => {
    const rows = createSearchListRows({
      artists: [artist],
      tracks: [track('1'), track('2')],
      albums: [album],
      playlists: [playlist],
    });

    expect(rows.map(({ kind }) => kind)).toEqual([
      'artist-section',
      'track-header',
      'track',
      'track',
      'album-section',
      'playlist-section',
    ]);
  });

  it('uses occurrence-aware keys for duplicate search tracks', () => {
    const duplicate = track('7');
    const rows = createSearchListRows({
      artists: [],
      tracks: [duplicate, duplicate],
      albums: [],
      playlists: [],
    });
    const keys = rows.map(searchListRowKey);

    expect(keys).toEqual(['section:tracks', 'track:7:0', 'track:7:1']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not manufacture empty section rows', () => {
    expect(createSearchListRows({ artists: [], tracks: [], albums: [], playlists: [] }))
      .toEqual([]);
  });
});
