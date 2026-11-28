import { describe, expect, it } from 'vitest';
import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  Genre,
  GenreDetail,
  Playlist,
  PlaylistSummary,
  Track,
} from '../api/types';
import type { AlbumCard } from '../domain/catalog';
import {
  findCachedAlbumSummary,
  findCachedArtistSummary,
  findCachedGenre,
  findCachedPlaylistSummary,
} from './cacheSeed';
import { createMusicQueryClient } from './queryClient';
import { queryKeys } from './queryKeys';

function sampleTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: '101',
    title: 'Night Drive',
    artist: 'Synthwave Duo',
    artist_id: '55',
    artists: [
      { id: '55', name: 'Synthwave Duo' },
      { id: '56', name: 'Guest Vocalist' },
    ],
    album: 'Neon Roads',
    album_id: '77',
    cover: 'https://cdn.test/neon.jpg',
    duration_sec: 214,
    preview_url: null,
    rank: 500_000,
    release_date: '2025-04-01',
    ...overrides,
  };
}

describe('cacheSeed', () => {
  it('finds cached album summaries from detail, new releases, artist discography, genre, search, and scoped tracks', () => {
    const client = createMusicQueryClient();
    expect(findCachedAlbumSummary(client, '77')).toBeNull();

    // Scoped likes cache must NOT leak across accounts or without scope.
    client.setQueryData(queryKeys.library.likes('scope-a'), [sampleTrack()]);
    expect(findCachedAlbumSummary(client, '77')).toBeNull();
    expect(findCachedAlbumSummary(client, '77', 'scope-b')).toBeNull();
    expect(findCachedAlbumSummary(client, '77', 'scope-a')).toEqual({
      id: '77',
      title: 'Neon Roads',
      artist: 'Synthwave Duo',
      cover: 'https://cdn.test/neon.jpg',
      release_date: '2025-04-01',
    });

    // Search album cards stay isolated to their origin/account scope
    const albumCards: AlbumCard[] = [
      {
        id: '88',
        title: 'Solar Echoes',
        artistName: 'Orbit',
        artworkUrl: 'https://cdn.test/solar.jpg',
      },
    ];
    client.setQueryData(queryKeys.search.albums('scope-a', 'solar'), albumCards);
    expect(findCachedAlbumSummary(client, '88')).toBeNull();
    expect(findCachedAlbumSummary(client, '88', 'scope-b')).toBeNull();
    expect(findCachedAlbumSummary(client, '88', 'scope-a')).toEqual({
      id: '88',
      title: 'Solar Echoes',
      artist: 'Orbit',
      cover: 'https://cdn.test/solar.jpg',
      release_date: '',
    });

    // New releases override track-derived summaries with richer release summary
    const release: AlbumSummary = {
      id: '77',
      title: 'Neon Roads (Deluxe)',
      artist: 'Synthwave Duo',
      cover: 'https://cdn.test/neon-deluxe.jpg',
      release_date: '2025-05-01',
    };
    client.setQueryData(queryKeys.catalog.newReleases(), [release]);
    expect(findCachedAlbumSummary(client, '77', 'scope-a')).toEqual(release);

    // Album detail wins over all list caches
    const detail: AlbumDetail = {
      id: '77',
      title: 'Neon Roads (Full Detail)',
      artist: 'Synthwave Duo',
      artist_id: '55',
      cover: 'https://cdn.test/neon-hd.jpg',
      release_date: '2025-05-01',
      nb_tracks: 10,
      tracks: [],
    };
    client.setQueryData(queryKeys.catalog.album('77'), detail);
    expect(findCachedAlbumSummary(client, '77')).toEqual({
      id: '77',
      title: 'Neon Roads (Full Detail)',
      artist: 'Synthwave Duo',
      cover: 'https://cdn.test/neon-hd.jpg',
      release_date: '2025-05-01',
    });
  });

  it('finds cached artist summaries preferring pictured sources and enforcing account scope', () => {
    const client = createMusicQueryClient();
    const followed: ArtistSummary = {
      id: '55',
      name: 'Synthwave Duo',
      picture: 'https://cdn.test/artist-55.jpg',
    };
    client.setQueryData(queryKeys.follows.artists('scope-a'), [followed]);
    expect(findCachedArtistSummary(client, '55')).toBeNull();
    expect(findCachedArtistSummary(client, '55', 'scope-b')).toBeNull();
    expect(findCachedArtistSummary(client, '55', 'scope-a')).toEqual(followed);

    // Falls back to featured artist name on scoped tracks when no pictured summary exists
    client.setQueryData(queryKeys.library.likes('scope-a'), [sampleTrack()]);
    expect(findCachedArtistSummary(client, '56', 'scope-a')).toEqual({
      id: '56',
      name: 'Guest Vocalist',
      picture: '',
    });

    // Related artists in another artist's detail cache
    const otherArtist: ArtistDetail = {
      id: '99',
      name: 'Other',
      picture: 'https://cdn.test/other.jpg',
      fans: 100,
      albums_count: 2,
      top: [],
      albums: [],
      related: [{ id: '56', name: 'Guest Vocalist', picture: 'https://cdn.test/guest.jpg' }],
    };
    client.setQueryData(queryKeys.catalog.artist('99'), otherArtist);
    expect(findCachedArtistSummary(client, '56', 'scope-a')).toEqual({
      id: '56',
      name: 'Guest Vocalist',
      picture: 'https://cdn.test/guest.jpg',
    });
  });

  it('finds cached genres from detail and directory caches', () => {
    const client = createMusicQueryClient();
    const genres: Genre[] = [
      { id: '132', name: 'Pop', picture: 'https://cdn.test/pop.jpg' },
    ];
    client.setQueryData(queryKeys.catalog.genres(), genres);
    expect(findCachedGenre(client, '132')).toEqual(genres[0]);
    expect(findCachedGenre(client, '999')).toBeNull();

    const detail: GenreDetail = {
      id: '132',
      name: 'Pop Hits',
      picture: 'https://cdn.test/pop-hd.jpg',
      tracks: [],
      albums: [],
      artists: [],
    };
    client.setQueryData(queryKeys.catalog.genre('132'), detail);
    expect(findCachedGenre(client, '132')).toEqual({
      id: '132',
      name: 'Pop Hits',
      picture: 'https://cdn.test/pop-hd.jpg',
    });
  });

  it('finds cached playlist summaries strictly within the requested account scope', () => {
    const client = createMusicQueryClient();
    const owned: PlaylistSummary = {
      id: 12,
      name: 'Road Trip',
      description: 'Windows down',
      cover_url: '/covers/12.jpg',
      is_public: false,
      track_count: 24,
      owner_id: 1,
      owner_name: 'Alex',
      owner_avatar_url: null,
      is_collaborative: false,
      is_owner: true,
      is_collaborator: false,
      can_edit_tracks: true,
      collaborator_count: 0,
    };
    const community: PlaylistSummary = {
      id: 44,
      name: 'Late Night',
      description: null,
      cover_url: null,
      is_public: true,
      track_count: 15,
      owner_id: 2,
      owner_name: 'Sam',
      owner_avatar_url: null,
      is_collaborative: false,
      is_owner: false,
      is_collaborator: false,
      can_edit_tracks: false,
      collaborator_count: 0,
    };
    client.setQueryData(queryKeys.playlists.owned('scope-a'), [owned]);
    client.setQueryData(queryKeys.playlists.public('scope-a'), [community]);

    expect(findCachedPlaylistSummary(client, 'scope-a', 12)).toEqual(owned);
    expect(findCachedPlaylistSummary(client, 'scope-a', 44)).toEqual(community);
    // Strict account isolation
    expect(findCachedPlaylistSummary(client, 'scope-b', 12)).toBeNull();
    expect(findCachedPlaylistSummary(client, 'scope-b', 44)).toBeNull();

    const detail: Playlist = {
      id: 12,
      name: 'Road Trip Updated',
      description: 'Fresh mix',
      cover_url: '/covers/12-v2.jpg',
      is_public: true,
      is_owner: true,
      owner_id: 1,
      owner_name: 'Alex',
      owner_avatar_url: '/api/users/1/avatar',
      is_collaborative: true,
      is_collaborator: false,
      can_edit_tracks: true,
      collaborators: [
        {
          user_id: 2,
          display_name: 'Sam',
          avatar_url: null,
          role: 'editor',
          joined_at: '2026-11-24T09:00:00Z',
        },
      ],
      collaborator_count: 1,
      revision: 3,
      tracks: [sampleTrack()],
    };
    client.setQueryData(queryKeys.playlists.detail('scope-a', 12), detail);
    expect(findCachedPlaylistSummary(client, 'scope-a', 12)).toEqual({
      id: 12,
      name: 'Road Trip Updated',
      description: 'Fresh mix',
      cover_url: '/covers/12-v2.jpg',
      is_public: true,
      track_count: 1,
      owner_id: 1,
      owner_name: 'Alex',
      owner_avatar_url: '/api/users/1/avatar',
      is_collaborative: true,
      is_owner: true,
      is_collaborator: false,
      can_edit_tracks: true,
      collaborator_count: 1,
    });
  });

  it('fails loudly on empty or invalid identifiers', () => {
    const client = createMusicQueryClient();
    expect(() => findCachedAlbumSummary(client, '   ')).toThrow(/album id must not be empty/);
    expect(() => findCachedArtistSummary(client, '')).toThrow(/artist id must not be empty/);
    expect(() => findCachedGenre(client, '')).toThrow(/genre id must not be empty/);
    expect(() => findCachedPlaylistSummary(client, '', 1)).toThrow(/playlist scope must not be empty/);
    expect(() => findCachedPlaylistSummary(client, 'scope-a', 0)).toThrow(/positive integer/);
  });
});
