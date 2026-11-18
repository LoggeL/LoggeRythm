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

  it('puts the promoted top result above every section and keys it uniquely', () => {
    const rows = createSearchListRows({
      artists: [artist],
      tracks: [track('1')],
      albums: [],
      playlists: [],
      topResult: { kind: 'artist', artist },
    });

    expect(rows.map(({ kind }) => kind)).toEqual([
      'top-result',
      'artist-section',
      'track-header',
      'track',
    ]);
    expect(searchListRowKey(rows[0])).toBe('section:top-result');
    expect(createSearchListRows({
      artists: [], tracks: [track('1')], albums: [], playlists: [], topResult: null,
    }).map(({ kind }) => kind)).toEqual(['track-header', 'track']);
  });

  it('leads with the library section and keeps remote status directly below it', () => {
    const rows = createSearchListRows({
      libraryTracks: [track('8'), track('9')],
      remoteStatus: true,
      artists: [artist],
      tracks: [track('1')],
      albums: [],
      playlists: [],
      topResult: { kind: 'artist', artist },
    });

    expect(rows.map(({ kind }) => kind)).toEqual([
      'library-header',
      'library-track',
      'library-track',
      'remote-status',
      'top-result',
      'artist-section',
      'track-header',
      'track',
    ]);
    expect(rows.slice(1, 3)).toEqual([
      { kind: 'library-track', track: track('8'), index: 0 },
      { kind: 'library-track', track: track('9'), index: 1 },
    ]);
    const keys = rows.map(searchListRowKey);
    expect(keys.slice(0, 4)).toEqual([
      'section:library',
      'library-track:8',
      'library-track:9',
      'section:remote-status',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the library rows identical while the remote search is still pending', () => {
    const libraryTracks = [track('8')];
    const pending = createSearchListRows({
      libraryTracks, remoteStatus: true, artists: [], tracks: [], albums: [], playlists: [],
    });
    const settled = createSearchListRows({
      libraryTracks, remoteStatus: true, artists: [], tracks: [track('1')], albums: [], playlists: [],
    });

    expect(pending.map(searchListRowKey)).toEqual([
      'section:library',
      'library-track:8',
      'section:remote-status',
    ]);
    expect(settled.slice(0, pending.length)).toEqual(pending);
  });

  it('hides the library section without matches but keeps the remote status row', () => {
    expect(createSearchListRows({
      libraryTracks: [], remoteStatus: true, artists: [], tracks: [], albums: [], playlists: [],
    })).toEqual([{ kind: 'remote-status' }]);
  });

  it('closes the library section with its notice and shows it even without matches', () => {
    const withMatches = createSearchListRows({
      libraryTracks: [track('8')],
      libraryNotice: true,
      remoteStatus: true,
      artists: [], tracks: [track('1')], albums: [], playlists: [],
    });
    expect(withMatches.map(searchListRowKey)).toEqual([
      'section:library',
      'library-track:8',
      'section:library-notice',
      'section:remote-status',
      'section:tracks',
      'track:1:0',
    ]);

    // The tracks above the notice keep their place when the notice appears.
    const withoutNotice = createSearchListRows({
      libraryTracks: [track('8')],
      remoteStatus: true,
      artists: [], tracks: [track('1')], albums: [], playlists: [],
    });
    expect(withMatches.slice(0, 2)).toEqual(withoutNotice.slice(0, 2));

    expect(createSearchListRows({
      libraryTracks: [], libraryNotice: true, remoteStatus: true,
      artists: [], tracks: [], albums: [], playlists: [],
    })).toEqual([
      { kind: 'library-header' },
      { kind: 'library-notice' },
      { kind: 'remote-status' },
    ]);
  });

  it('keys a library row and a remote row of the same track differently', () => {
    const rows = createSearchListRows({
      libraryTracks: [track('7')], artists: [], tracks: [track('7')], albums: [], playlists: [],
    });
    const keys = rows.map(searchListRowKey);

    expect(keys).toEqual(['section:library', 'library-track:7', 'section:tracks', 'track:7:0']);
  });
});
