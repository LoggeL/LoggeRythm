import { describe, expect, it } from 'vitest';
import { decodePlaylist, decodeTrack, decodeUser } from './decoders';

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

describe('API response decoders', () => {
  it('accepts the backend Track wire format without changing string ids', () => {
    expect(decodeTrack(track)).toEqual(track);
  });

  it('rejects numeric Track ids before they reach likes and player state', () => {
    expect(() => decodeTrack({ ...track, id: 3135556 })).toThrow(/Track.id must be a string/);
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
