import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogAlbumDestination,
  catalogArtistDestination,
  nowPlayingAlbumDestination,
  nowPlayingArtistDestination,
  openNowPlayingAlbum,
  openNowPlayingArtist,
  openNowPlayingCatalogAlbum,
  openNowPlayingCatalogArtist,
  resolveActiveTabScreen,
} from './nowPlayingNavigation';

const navHarness = vi.hoisted(() => ({
  openAlbumInActiveTab: vi.fn<() => 'opened' | 'not-ready'>(() => 'opened'),
  openArtistInActiveTab: vi.fn<() => 'opened' | 'not-ready'>(() => 'opened'),
}));

vi.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => ({ isReady: () => false }),
  StackActions: { push: vi.fn((screen: string, params: unknown) => ({ type: 'PUSH', payload: { name: screen, params } })) },
}));

vi.mock('../navigation/rootNavigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../navigation/rootNavigation')>()),
  openAlbumInActiveTab: navHarness.openAlbumInActiveTab,
  openArtistInActiveTab: navHarness.openArtistInActiveTab,
}));

describe('Now Playing nested catalog destinations', () => {
  beforeEach(() => {
    navHarness.openAlbumInActiveTab.mockReset().mockReturnValue('opened');
    navHarness.openArtistInActiveTab.mockReset().mockReturnValue('opened');
  });

  it('defaults to HomeTab consistently with rootNavigation and honors an explicit target tab', () => {
    expect(nowPlayingAlbumDestination({ album_id: 302127, album: ' Discovery ' }))
      .toEqual({
        screen: 'HomeTab',
        params: {
          screen: 'Album',
          params: { albumId: '302127', title: 'Discovery' },
        },
      });
    expect(nowPlayingAlbumDestination({ album_id: 302127, album: ' Discovery ' }, 'LibraryTab'))
      .toEqual({
        screen: 'LibraryTab',
        params: {
          screen: 'Album',
          params: { albumId: '302127', title: 'Discovery' },
        },
      });
  });

  it('uses the exact selected credited artist and preserves target tab', () => {
    const guest = { id: '00042', name: ' Guest Artist ' };
    expect(nowPlayingArtistDestination(guest)).toEqual({
      screen: 'HomeTab',
      params: {
        screen: 'Artist',
        params: { artistId: '00042', name: 'Guest Artist' },
      },
    });
    expect(nowPlayingArtistDestination(guest, 'SearchTab')).toEqual({
      screen: 'SearchTab',
      params: {
        screen: 'Artist',
        params: { artistId: '00042', name: 'Guest Artist' },
      },
    });
  });

  it('rejects malformed legacy references before navigation', () => {
    expect(nowPlayingAlbumDestination({ album_id: '', album: 'Legacy' })).toBeNull();
    expect(nowPlayingArtistDestination({ id: 0, name: 'Legacy' })).toBeNull();
    expect(openNowPlayingAlbum({ album_id: '', album: 'Legacy' })).toBe('invalid');
    expect(openNowPlayingArtist({ id: 0, name: 'Legacy' })).toBe('invalid');
    expect(navHarness.openAlbumInActiveTab).not.toHaveBeenCalled();
    expect(navHarness.openArtistInActiveTab).not.toHaveBeenCalled();
  });

  it('routes Album and Artist through rootNavigation openAlbumInActiveTab/openArtistInActiveTab', () => {
    expect(openNowPlayingAlbum({ album_id: 302127, album: ' Discovery ' })).toBe('opened');
    expect(navHarness.openAlbumInActiveTab).toHaveBeenCalledWith({
      albumId: '302127',
      title: 'Discovery',
    });

    expect(openNowPlayingArtist({ id: '00042', name: ' Guest Artist ' })).toBe('opened');
    expect(navHarness.openArtistInActiveTab).toHaveBeenCalledWith({
      artistId: '00042',
      name: 'Guest Artist',
    });

    navHarness.openAlbumInActiveTab.mockReturnValueOnce('not-ready');
    expect(openNowPlayingCatalogAlbum({ albumId: '1', title: 'A' })).toBe('not-ready');
    navHarness.openArtistInActiveTab.mockReturnValueOnce('not-ready');
    expect(openNowPlayingCatalogArtist({ artistId: '2', name: 'B' })).toBe('not-ready');
  });

  it('resolves the active tab via rootNavigation.resolveActiveTabName (falling back to HomeTab)', () => {
    expect(
      resolveActiveTabScreen({
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
                { name: 'LibraryTab' },
              ],
            },
          },
          { name: 'NowPlaying' },
        ],
      }),
    ).toBe('LibraryTab');

    expect(resolveActiveTabScreen(undefined)).toBe('HomeTab');
    expect(catalogAlbumDestination({ albumId: '1', title: 'A' }, 'HomeTab').screen).toBe('HomeTab');
    expect(catalogArtistDestination({ artistId: '2', name: 'B' }, 'RadioTab').screen).toBe('RadioTab');
  });
});
