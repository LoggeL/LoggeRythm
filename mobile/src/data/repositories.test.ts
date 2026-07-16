import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import { musicRepository } from './repositories';

const endpoints = vi.hoisted(() => ({
  searchTracks: vi.fn(),
  searchAlbums: vi.fn(),
  searchArtists: vi.fn(),
  searchPlaylists: vi.fn(),
  getCharts: vi.fn(),
  getHomeMixes: vi.fn(),
  getBecauseYouListened: vi.fn(),
  getHomeChartCollections: vi.fn(),
  getReleaseRadar: vi.fn(),
  getMood: vi.fn(),
  getGenres: vi.fn(),
  getGenre: vi.fn(),
  getNewReleases: vi.fn(),
  getTrack: vi.fn(),
  getAlbum: vi.fn(),
  getArtist: vi.fn(),
  getArtistAbout: vi.fn(),
  getRadio: vi.fn(),
  recordPlay: vi.fn(),
  getPlaylists: vi.fn(),
  getPublicPlaylists: vi.fn(),
  getPlaylist: vi.fn(),
  createPlaylist: vi.fn(),
  updatePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  reorderPlaylistTracks: vi.fn(),
  removePlaylistEntry: vi.fn(),
  reorderPlaylistEntries: vi.fn(),
  addTracksBulk: vi.fn(),
  setPlaylistVisibility: vi.fn(),
  getLikes: vi.fn(),
  likeTrack: vi.fn(),
  unlikeTrack: vi.fn(),
  getFollowingArtists: vi.fn(),
  followingContains: vi.fn(),
  followArtist: vi.fn(),
  unfollowArtist: vi.fn(),
  getPublicProfile: vi.fn(),
  getStats: vi.fn(),
  updateMe: vi.fn(),
  deleteMe: vi.fn(),
  getPlaybackSettings: vi.fn(),
  updatePlaybackSettings: vi.fn(),
  resolveExternalUrl: vi.fn(),
  getDeezerPlaylist: vi.fn(),
  getLyrics: vi.fn(),
  getCachedTrackIds: vi.fn(),
  preloadTrack: vi.fn(),
  getTrackPlayCounts: vi.fn(),
  createParty: vi.fn(),
  getParty: vi.fn(),
  joinParty: vi.fn(),
  partyAddTrack: vi.fn(),
  partyRemoveTrack: vi.fn(),
  partyReorder: vi.fn(),
  partySetCurrent: vi.fn(),
  partySetPlayback: vi.fn(),
  leaveParty: vi.fn(),
  getAdminUsers: vi.fn(),
  approveAdminUser: vi.fn(),
  deleteAdminUser: vi.fn(),
  getAdminStatus: vi.fn(),
  getAdminStorage: vi.fn(),
  cleanupAdminStorage: vi.fn(),
  getAdminInvites: vi.fn(),
  createAdminInvite: vi.fn(),
}));

vi.mock('../api/endpoints', () => endpoints);

describe('music repository wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves identity wiring for every non-migrated endpoint', () => {
    for (const name of Object.keys(endpoints).filter(
      (candidate) => candidate !== 'searchAlbums',
    ) as (keyof typeof endpoints)[]) {
      expect(musicRepository[name]).toBe(endpoints[name]);
    }
  });

  it('maps album search wire rows while forwarding query and AbortSignal exactly', async () => {
    endpoints.searchAlbums.mockResolvedValue([
      {
        id: '11',
        title: 'Track title',
        album_id: 42,
        album: 'Album title',
        artist: 'Artist',
        cover: '',
        duration_sec: 180,
        preview_url: null,
        rank: 10,
        release_date: '',
      },
    ]);
    const signal = new AbortController().signal;

    await expect(musicRepository.searchAlbums('Kraftwerk', signal)).resolves.toStrictEqual([
      {
        id: '42',
        title: 'Album title',
        artistName: 'Artist',
        artworkUrl: null,
      },
    ]);
    expect(musicRepository.searchAlbums).not.toBe(endpoints.searchAlbums);
    expect(endpoints.searchAlbums).toHaveBeenCalledOnce();
    expect(endpoints.searchAlbums).toHaveBeenCalledWith('Kraftwerk', signal);
  });

  it('wires headless player operations with exact identity, cancellation, and timeouts', async () => {
    const tracks: Track[] = [{
      id: '99',
      title: 'Similar track',
      artist: 'Similar artist',
      artist_id: '9',
      artists: [{ id: '9', name: 'Similar artist' }],
      album: 'Similar album',
      album_id: '19',
      cover: '',
      duration_sec: 180,
      preview_url: null,
      rank: 1,
      release_date: '2026-07-16',
    }];
    endpoints.getRadio.mockResolvedValue(tracks);
    endpoints.preloadTrack.mockResolvedValue(undefined);
    endpoints.recordPlay.mockResolvedValue(undefined);
    const signal = new AbortController().signal;
    const played = tracks[0];

    await expect(musicRepository.getRadio('42', signal, 4_000)).resolves.toBe(tracks);
    await expect(
      musicRepository.preloadTrack('42', { signal, timeoutMs: 2_500 }),
    ).resolves.toBeUndefined();
    await expect(musicRepository.recordPlay(played, 4_000)).resolves.toBeUndefined();
    expect(musicRepository.getRadio).toBe(endpoints.getRadio);
    expect(musicRepository.preloadTrack).toBe(endpoints.preloadTrack);
    expect(musicRepository.recordPlay).toBe(endpoints.recordPlay);
    expect(endpoints.getRadio).toHaveBeenCalledOnce();
    expect(endpoints.getRadio).toHaveBeenCalledWith('42', signal, 4_000);
    expect(endpoints.preloadTrack).toHaveBeenCalledWith('42', { signal, timeoutMs: 2_500 });
    expect(endpoints.recordPlay).toHaveBeenCalledWith(played, 4_000);
  });
});
