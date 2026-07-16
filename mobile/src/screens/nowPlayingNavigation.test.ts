import { describe, expect, it } from 'vitest';
import {
  nowPlayingAlbumDestination,
  nowPlayingArtistDestination,
} from './nowPlayingNavigation';

describe('Now Playing nested catalog destinations', () => {
  it('opens the current album through the Discover stack', () => {
    expect(nowPlayingAlbumDestination({ album_id: 302127, album: ' Discovery ' }))
      .toEqual({
        screen: 'DiscoverTab',
        params: {
          screen: 'Album',
          params: { albumId: '302127', title: 'Discovery' },
        },
      });
  });

  it('uses the exact selected credited artist', () => {
    const guest = { id: '00042', name: ' Guest Artist ' };
    expect(nowPlayingArtistDestination(guest)).toEqual({
      screen: 'DiscoverTab',
      params: {
        screen: 'Artist',
        params: { artistId: '00042', name: 'Guest Artist' },
      },
    });
  });

  it('rejects malformed legacy references before navigation', () => {
    expect(nowPlayingAlbumDestination({ album_id: '', album: 'Legacy' })).toBeNull();
    expect(nowPlayingArtistDestination({ id: 0, name: 'Legacy' })).toBeNull();
  });
});
