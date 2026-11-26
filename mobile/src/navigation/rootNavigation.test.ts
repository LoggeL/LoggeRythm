import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import {
  openAlbumInActiveTab,
  openArtistInActiveTab,
  openTrackAlbum,
  openTrackArtist,
  resolveActiveTabName,
  resolveActiveTvRoute,
} from './rootNavigation';

const navMocks = vi.hoisted(() => ({
  ready: true,
  rootState: undefined as unknown,
  navigate: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => ({
    isReady: () => navMocks.ready,
    getRootState: () => navMocks.rootState,
    navigate: navMocks.navigate,
    dispatch: navMocks.dispatch,
  }),
  StackActions: {
    push: (name: string, params?: object) => ({
      type: 'PUSH',
      payload: { name, params },
    }),
  },
}));

const validTrack: Track = {
  id: '42',
  title: 'Midnight Signal',
  artist: 'Primary Artist',
  artist_id: '7',
  artists: [{ id: '7', name: 'Primary Artist' }],
  album: 'Parity',
  album_id: '9',
  cover: '',
  duration_sec: 185,
  preview_url: null,
  rank: 0,
  release_date: '',
};

describe('rootNavigation active-tab routing', () => {
  beforeEach(() => {
    navMocks.ready = true;
    navMocks.rootState = undefined;
    navMocks.navigate.mockClear();
    navMocks.dispatch.mockClear();
  });

  it('resolves the active tab even while a transient modal is stacked above Tabs', () => {
    const state = {
      index: 1,
      routes: [
        {
          name: 'Tabs',
          state: {
            index: 4,
            routes: [
              { name: 'HomeTab' },
              { name: 'DiscoverTab' },
              { name: 'SearchTab' },
              { name: 'RadioTab' },
              {
                name: 'LibraryTab',
                state: {
                  key: 'library-stack-1',
                  index: 1,
                  routes: [
                    { name: 'Library' },
                    { name: 'Playlist', params: { kind: 'liked', name: 'Liked' } },
                  ],
                },
              },
            ],
          },
        },
        { name: 'NowPlaying' },
      ],
    };

    expect(resolveActiveTabName(state)).toBe('LibraryTab');
    expect(resolveActiveTvRoute(state)).toBe('NowPlaying');
    expect(resolveActiveTabName(undefined)).toBe('HomeTab');
    expect(resolveActiveTvRoute({
      index: 0,
      routes: [{ name: 'Tabs', state: { index: 2, routes: [{ name: 'HomeTab' }, { name: 'DiscoverTab' }, { name: 'SearchTab' }] } }],
    })).toBe('SearchTab');

    for (const profileRoute of [
      'Profile',
      'PlaybackSettings',
      'DevicesStorageSettings',
      'AccountAppSettings',
      'Insights',
    ]) {
      expect(resolveActiveTvRoute({
        index: 1,
        routes: [{ name: 'Tabs' }, { name: profileRoute }],
      })).toBe('Profile');
    }
  });

  it('pushes Album and Artist onto the active tab stack instead of forcing DiscoverTab', () => {
    navMocks.rootState = {
      index: 0,
      routes: [
        {
          name: 'Tabs',
          state: {
            index: 2,
            routes: [
              { name: 'HomeTab' },
              { name: 'DiscoverTab' },
              {
                name: 'SearchTab',
                state: {
                  key: 'search-stack-99',
                  index: 0,
                  routes: [{ name: 'Search' }],
                },
              },
            ],
          },
        },
      ],
    };

    expect(openTrackAlbum(validTrack)).toBe('opened');
    expect(navMocks.navigate).not.toHaveBeenCalled();
    expect(navMocks.dispatch).toHaveBeenCalledWith({
      type: 'PUSH',
      payload: { name: 'Album', params: { albumId: '9', title: 'Parity' } },
      target: 'search-stack-99',
    });

    navMocks.dispatch.mockClear();
    expect(openTrackArtist(validTrack)).toBe('opened');
    expect(navMocks.dispatch).toHaveBeenCalledWith({
      type: 'PUSH',
      payload: { name: 'Artist', params: { artistId: '7', name: 'Primary Artist' } },
      target: 'search-stack-99',
    });
  });

  it('dismisses NowPlaying back to the active tab and pushes detail onto that tab stack', () => {
    navMocks.rootState = {
      index: 1,
      routes: [
        {
          name: 'Tabs',
          state: {
            index: 1,
            routes: [
              { name: 'HomeTab' },
              {
                name: 'LibraryTab',
                state: {
                  key: 'library-stack-7',
                  index: 0,
                  routes: [{ name: 'Library' }],
                },
              },
            ],
          },
        },
        { name: 'NowPlaying' },
      ],
    };

    expect(openAlbumInActiveTab({ albumId: '9', title: 'Parity' })).toBe('opened');
    expect(navMocks.navigate).toHaveBeenCalledWith('Tabs', { screen: 'LibraryTab' });
    expect(navMocks.dispatch).toHaveBeenCalledWith({
      type: 'PUSH',
      payload: { name: 'Album', params: { albumId: '9', title: 'Parity' } },
      target: 'library-stack-7',
    });
  });

  it('does not push a duplicate when the active tab is already showing the same album or artist', () => {
    navMocks.rootState = {
      index: 0,
      routes: [
        {
          name: 'Tabs',
          state: {
            index: 0,
            routes: [
              {
                name: 'HomeTab',
                state: {
                  key: 'home-stack-1',
                  index: 1,
                  routes: [
                    { name: 'Home' },
                    { name: 'Album', params: { albumId: '9', title: 'Parity' } },
                  ],
                },
              },
            ],
          },
        },
      ],
    };

    expect(openAlbumInActiveTab({ albumId: '9', title: 'Parity' })).toBe('opened');
    expect(navMocks.dispatch).not.toHaveBeenCalled();
    expect(navMocks.navigate).not.toHaveBeenCalled();
  });

  it('navigates into the active tab when the section stack key is not mounted yet', () => {
    navMocks.rootState = {
      index: 0,
      routes: [
        {
          name: 'Tabs',
          state: {
            index: 1,
            routes: [{ name: 'HomeTab' }, { name: 'RadioTab' }],
          },
        },
      ],
    };

    expect(openArtistInActiveTab({ artistId: '7', name: 'Primary Artist' })).toBe('opened');
    expect(navMocks.dispatch).not.toHaveBeenCalled();
    expect(navMocks.navigate).toHaveBeenCalledWith('Tabs', {
      screen: 'RadioTab',
      params: { screen: 'Artist', params: { artistId: '7', name: 'Primary Artist' } },
    });
  });

  it('rejects invalid tracks and reports not-ready loudly', () => {
    expect(openTrackAlbum({ ...validTrack, album_id: 'invalid-id' })).toBe('invalid-track');
    expect(openTrackArtist({ ...validTrack, artist_id: 0, artists: [] })).toBe('invalid-track');

    navMocks.ready = false;
    expect(openTrackAlbum(validTrack)).toBe('not-ready');
    expect(openTrackArtist(validTrack)).toBe('not-ready');
  });
});
