import { describe, expect, it } from 'vitest';
import { decodeAlbum, decodePlaylist, decodeTrack, decodeUser } from './decoders';

const track = {
  id: '3135556',
  title: 'Example',
  artist: 'Artist',
  artist_id: '42',
  artists: [{ id: '42', name: 'Artist' }],
  album: 'Album',
  album_id: 12,
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
};

const album = {
  id: '302127',
  title: 'Album',
  artist: 'Artist',
  artist_id: 42,
  cover: '',
  release_date: '2026-01-01',
  nb_tracks: 1,
  tracks: [track],
};

describe('API response decoders', () => {
  it('accepts the backend Track wire format without changing string ids', () => {
    expect(decodeTrack(track)).toEqual(track);
  });

  it('rejects numeric Track ids before they reach likes and player state', () => {
    expect(() => decodeTrack({ ...track, id: 3135556 })).toThrow(/Track.id must be a string/);
  });

  it.each(['', ' ', '-1', '+1', '1.5', '1e3', '12/../34', '１２'])(
    'rejects non-digit Track id %j',
    (id) => {
      expect(() => decodeTrack({ ...track, id })).toThrow(
        /Track.id must be a non-empty digit-only Deezer ID/,
      );
    },
  );

  it.each<{
    label: string;
    change: Record<string, unknown>;
    message: RegExp;
  }>([
    { label: 'artist_id', change: { artist_id: 'artist-42' }, message: /Track.artist_id/ },
    { label: 'album_id', change: { album_id: '12.5' }, message: /Track.album_id/ },
    {
      label: 'artist reference',
      change: { artists: [{ id: 'abc', name: 'Artist' }] },
      message: /Track.artists\[0\]\.id/,
    },
  ])('rejects an invalid $label', ({ change, message }) => {
    expect(() => decodeTrack({ ...track, ...change })).toThrow(message);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe numeric artist and album ids (%s)',
    (id) => {
      expect(() => decodeTrack({ ...track, artist_id: id })).toThrow(/Track.artist_id/);
      expect(() => decodeTrack({ ...track, album_id: id })).toThrow(/Track.album_id/);
      expect(() => decodeTrack({ ...track, artists: [{ id, name: 'Artist' }] })).toThrow(
        /Track.artists\[0\]\.id/,
      );
    },
  );

  it('accepts safe numeric and digit-only string artist/album ids without coercion', () => {
    expect(
      decodeTrack({
        ...track,
        artist_id: 42,
        album_id: '302127',
        artists: [{ id: 42, name: 'Artist' }],
      }),
    ).toMatchObject({
      artist_id: 42,
      album_id: '302127',
      artists: [{ id: 42, name: 'Artist' }],
    });
  });

  it('accepts empty optional artist and album references emitted by stored backend rows', () => {
    expect(
      decodeTrack({
        ...track,
        artist_id: '',
        album_id: '',
        artists: [{ id: '', name: 'Legacy Artist' }],
      }),
    ).toMatchObject({
      artist_id: '',
      album_id: '',
      artists: [{ id: '', name: 'Legacy Artist' }],
    });
    expect(decodeAlbum({ ...album, artist_id: '' }).artist_id).toBe('');
  });

  it('enforces digit-only album and album-artist ids', () => {
    expect(decodeAlbum(album)).toMatchObject({ id: '302127', artist_id: 42 });
    expect(() => decodeAlbum({ ...album, id: '' })).toThrow(/Album.id/);
    expect(() => decodeAlbum({ ...album, id: 'album-302127' })).toThrow(/Album.id/);
    expect(() => decodeAlbum({ ...album, artist_id: 'artist-42' })).toThrow(/Album.artist_id/);
  });

  it('accepts nullable user display names', () => {
    expect(
      decodeUser({
        id: 1,
        email: 'person@example.test',
        display_name: null,
        is_admin: false,
        is_approved: true,
        avatar_url: null,
      }).display_name,
    ).toBeNull();
  });

  it('validates the PlaylistDetail shape separately from PlaylistSummary', () => {
    const playlist = decodePlaylist({
      id: 7,
      name: 'Mix',
      cover_url: null,
      is_public: false,
      is_owner: true,
      owner_name: null,
      tracks: [track],
    });
    expect(playlist.tracks[0].id).toBe('3135556');
  });
});
