import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import {
  assertLibraryRouteCallbacks,
  assertPlaylistScreenContract,
  libraryPlaybackSelection,
  libraryFollowArtistRoute,
  libraryTestIdSegment,
  likedTrackOccurrence,
  playlistCreateRequest,
  playlistTrackOccurrence,
  playlistUpdateRequest,
  recentPlayTrack,
  recentTrackOccurrence,
  reorderedPlaylistEntryIds,
} from './libraryModel';

const track = (id: string, entryId = Number(id)): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  artist_id: '9',
  artists: [{ id: '9', name: 'Artist' }],
  album: 'Album',
  album_id: '7',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 1,
  release_date: '2026-07-15',
  playlist_entry_id: entryId,
});

describe('library screen model', () => {
  it('requires explicit playlist, artist, and delete navigation callbacks', () => {
    expect(() => assertLibraryRouteCallbacks({})).toThrow('onOpenPlaylist');
    expect(() =>
      assertLibraryRouteCallbacks({ onOpenPlaylist: vi.fn(), onOpenArtist: vi.fn() }),
    ).toThrow('onOpenAlbum');
    expect(() =>
      assertLibraryRouteCallbacks({
        onOpenPlaylist: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    ).not.toThrow();
    expect(() =>
      assertPlaylistScreenContract({
        kind: 'playlist',
        playlistId: 0,
        name: 'Invalid',
        onDeleted: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    ).toThrow('positive playlistId');
    expect(() =>
      assertPlaylistScreenContract({
        kind: 'liked',
        name: 'Likes',
        onDeleted: null as never,
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    ).toThrow('onDeleted');
    expect(() =>
      assertPlaylistScreenContract({
        kind: 'liked',
        name: 'Likes',
        onDeleted: vi.fn(),
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
    ).not.toThrow();
  });

  it('normalizes create and edit forms without inventing an empty description', () => {
    expect(playlistCreateRequest('  Driving  ', '  Night music  ')).toEqual({
      name: 'Driving',
      description: 'Night music',
    });
    expect(playlistUpdateRequest(' Driving ', '   ')).toEqual({
      name: 'Driving',
      description: '',
    });
    expect(() => playlistCreateRequest('   ', 'description')).toThrow('must not be empty');
  });

  it('preserves exact playback order and duplicate ids', () => {
    const tracks = [track('1'), track('1'), track('2')];
    const selected = libraryPlaybackSelection(tracks, 1);
    expect(selected.tracks).toBe(tracks);
    expect(selected.tracks.map((item) => item.id)).toEqual(['1', '1', '2']);
    expect(selected.startIndex).toBe(1);
  });

  it('rejects invalid playback positions', () => {
    expect(() => libraryPlaybackSelection([], 0)).toThrow('at least one track');
    expect(() => libraryPlaybackSelection([track('1')], 1)).toThrow('outside');
  });

  it('builds complete immutable reorder payloads', () => {
    const tracks = [track('1'), track('2'), track('3')];
    expect(reorderedPlaylistEntryIds(tracks, 1, 'up')).toEqual([2, 1, 3]);
    expect(reorderedPlaylistEntryIds(tracks, 1, 'down')).toEqual([1, 3, 2]);
    expect(tracks.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(() => reorderedPlaylistEntryIds(tracks, 0, 'up')).toThrow('cannot move up');
    expect(() => reorderedPlaylistEntryIds([
      { ...track('1'), playlist_entry_id: undefined },
      track('2'),
    ], 0, 'down')).toThrow('stable positive entry id');
  });

  it('creates stable test id segments', () => {
    expect(libraryTestIdSegment('  My / Playlist  ')).toBe('my-playlist');
    expect(libraryTestIdSegment('***')).toBe('item');
  });

  it('creates exact occurrence identities without searching duplicate ids', () => {
    expect(likedTrackOccurrence(17, 2)).toEqual({
      queueContext: { type: 'liked', id: '17' },
      originalContextOrder: 2,
    });
    expect(recentTrackOccurrence('17', 3)).toEqual({
      queueContext: { type: 'recent', id: '17' },
      originalContextOrder: 3,
    });
    expect(playlistTrackOccurrence(9, 4)).toEqual({
      queueContext: { type: 'playlist', id: '9' },
      originalContextOrder: 4,
    });
    expect(() => likedTrackOccurrence('', 0)).toThrow('context id');
    expect(() => playlistTrackOccurrence(9, -1)).toThrow('non-negative');
  });

  it('adapts complete persisted history metadata for immediate row actions', () => {
    const history = {
      id: '42',
      title: 'History Track',
      artist: 'Primary',
      artist_id: '7',
      artists: [
        { id: '7', name: 'Primary' },
        { id: '8', name: 'Guest' },
      ],
      album: 'History Album',
      album_id: '9',
      cover: 'cover.jpg',
      duration_sec: 185,
    };
    expect(recentPlayTrack(history)).toEqual({
      ...history,
      preview_url: null,
      rank: 0,
      release_date: '',
    });
  });

  it('links followed artist rows to the canonical Artist detail route', () => {
    expect(
      libraryFollowArtistRoute({ id: '42', name: 'The Artist', picture: 'artist.jpg' }),
    ).toEqual({ artistId: '42', name: 'The Artist' });
    expect(() =>
      libraryFollowArtistRoute({ id: '   ', name: 'Broken', picture: '' }),
    ).toThrow('artist id');
  });
});
