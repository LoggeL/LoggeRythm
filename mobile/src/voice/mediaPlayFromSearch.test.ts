import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type {
  AlbumDetail,
  ArtistDetail,
  DeezerPlaylistDetail,
  GenreDetail,
  Playlist,
  Track,
} from '../api/types';
import type { UserStats } from '../domain/listeningStats';
import { strings } from '../localization';
import { UserFacingPlayerError } from '../player/errors';
import {
  executeMediaPlayFromSearch,
  type VoicePlaybackPort,
  type VoiceSearchDeps,
  type VoiceSearchRepository,
} from './mediaPlayFromSearch';
import {
  classifyMediaFocus,
  type MediaPlayFromSearchRequest,
} from './mediaPlayFromSearchIntent';

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: {},
  NativeEventEmitter: class {},
}));
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly body: string,
      message: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

function makeTrack(overrides: Partial<Track> & { id: string; title: string }): Track {
  return {
    artist: 'Default Artist',
    artist_id: '10',
    artists: [{ id: '10', name: overrides.artist ?? 'Default Artist' }],
    album: 'Default Album',
    album_id: '20',
    cover: '',
    duration_sec: 210,
    preview_url: null,
    rank: 100,
    release_date: '2024-01-01',
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<Omit<MediaPlayFromSearchRequest, 'focusKind'>> = {},
): MediaPlayFromSearchRequest {
  const mediaFocus = overrides.mediaFocus ?? null;
  return {
    query: overrides.query ?? '',
    mediaFocus,
    focusKind: classifyMediaFocus(mediaFocus),
    artist: overrides.artist ?? null,
    album: overrides.album ?? null,
    title: overrides.title ?? null,
    playlist: overrides.playlist ?? null,
    genre: overrides.genre ?? null,
  };
}

class FakeTrackRadioError extends Error {}

function createDeps() {
  const repository: VoiceSearchRepository = {
    getLikes: vi.fn(async () => []),
    getPlaylists: vi.fn(async () => []),
    getPlaylist: vi.fn(async (): Promise<Playlist> => ({
      id: 1,
      name: 'Empty',
      description: null,
      cover_url: null,
      is_public: false,
      is_owner: true,
      owner_id: 1,
      owner_name: 'Me',
      owner_avatar_url: null,
      is_collaborative: false,
      is_collaborator: false,
      can_edit_tracks: true,
      collaborators: [],
      collaborator_count: 0,
      revision: 0,
      tracks: [],
    })),
    getStats: vi.fn(async (): Promise<UserStats> => ({
      total_plays: 0,
      top_tracks: [],
      top_artists: [],
      recent: [],
      total_plays_month: 0,
      top_tracks_month: [],
      top_artists_month: [],
    })),
    getCharts: vi.fn(async () => []),
    getGenres: vi.fn(async () => []),
    getGenre: vi.fn(async (): Promise<GenreDetail> => ({
      id: '1',
      name: 'Rock',
      picture: '',
      tracks: [],
      albums: [],
      artists: [],
    })),
    searchTracks: vi.fn(async () => []),
    searchAlbums: vi.fn(async () => []),
    searchArtists: vi.fn(async () => []),
    searchPlaylists: vi.fn(async () => []),
    getAlbum: vi.fn(async (): Promise<AlbumDetail> => ({
      id: 'a1',
      title: 'Album',
      artist: 'Artist',
      artist_id: '1',
      cover: '',
      release_date: '',
      nb_tracks: 0,
      tracks: [],
    })),
    getArtist: vi.fn(async (): Promise<ArtistDetail> => ({
      id: 'ar1',
      name: 'Artist',
      picture: '',
      fans: 0,
      albums_count: 0,
      top: [],
      albums: [],
      related: [],
    })),
    getDeezerPlaylist: vi.fn(async (): Promise<DeezerPlaylistDetail> => ({
      id: 'dp1',
      name: 'Public Playlist',
      cover: '',
      tracks: [],
    })),
  };

  const player: VoicePlaybackPort = {
    hasActiveQueue: vi.fn(() => false),
    activeTrackId: vi.fn(() => null),
    isPlaying: vi.fn(() => false),
    resume: vi.fn(),
    playTracks: vi.fn(async () => undefined),
    playTrackWithRadio: vi.fn(async () => 'started-radio' as const),
    isTrackRadioError: (error) => error instanceof FakeTrackRadioError,
  };

  const onNavigateNowPlaying = vi.fn();
  const onAnnounce = vi.fn();
  const onRadioNotice = vi.fn();

  const deps: VoiceSearchDeps = {
    repository,
    player,
    onNavigateNowPlaying,
    onAnnounce,
    onRadioNotice,
  };

  return { deps, repository, player, onNavigateNowPlaying, onAnnounce, onRadioNotice };
}

describe('executeMediaPlayFromSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resumes the active queue immediately on a blank voice request', async () => {
    const { deps, player, onNavigateNowPlaying, onAnnounce } = createDeps();
    vi.mocked(player.hasActiveQueue).mockReturnValue(true);

    const outcome = await executeMediaPlayFromSearch(makeRequest(), deps);

    expect(outcome).toEqual({ kind: 'resumed' });
    expect(player.resume).toHaveBeenCalledTimes(1);
    expect(onNavigateNowPlaying).toHaveBeenCalledTimes(1);
    expect(onAnnounce).toHaveBeenCalledWith(strings.voice.resumedPlayback);
  });

  it('falls back to liked songs, then recent plays, then charts on blank requests with empty queue', async () => {
    const likedTrack = makeTrack({ id: 't1', title: 'Liked Gem' });
    const first = createDeps();
    vi.mocked(first.repository.getLikes).mockResolvedValue([likedTrack]);
    const likedOutcome = await executeMediaPlayFromSearch(makeRequest(), first.deps);
    expect(likedOutcome).toEqual({
      kind: 'played-library-fallback',
      source: 'likes',
      trackCount: 1,
    });
    expect(first.player.playTracks).toHaveBeenCalledWith([likedTrack], 0, {
      context: { type: 'liked', id: 'liked', label: strings.navigation.likedSongs },
    });

    const second = createDeps();
    vi.mocked(second.repository.getStats).mockResolvedValue({
      total_plays: 1,
      top_tracks: [],
      top_artists: [],
      recent: [
        {
          id: 'r1',
          title: 'Recent Track',
          artist: 'Artist',
          artist_id: '10',
          artists: [{ id: '10', name: 'Artist' }],
          album: 'Album',
          album_id: '20',
          cover: '',
          duration_sec: 180,
        },
      ],
      total_plays_month: 1,
      top_tracks_month: [],
      top_artists_month: [],
    });
    const recentOutcome = await executeMediaPlayFromSearch(makeRequest(), second.deps);
    expect(recentOutcome).toEqual({
      kind: 'played-library-fallback',
      source: 'recent',
      trackCount: 1,
    });

    const third = createDeps();
    const chartTrack = makeTrack({ id: 'c1', title: 'Chart Hit' });
    vi.mocked(third.repository.getCharts).mockResolvedValue([chartTrack]);
    const chartsOutcome = await executeMediaPlayFromSearch(makeRequest(), third.deps);
    expect(chartsOutcome).toEqual({
      kind: 'played-library-fallback',
      source: 'charts',
      trackCount: 1,
    });
  });

  it('fails loudly on blank requests when offline or when no library/chart music exists', async () => {
    const offline = createDeps();
    const netErr = new ApiError(0, '', 'Network request failed');
    vi.mocked(offline.repository.getLikes).mockRejectedValue(netErr);
    vi.mocked(offline.repository.getStats).mockRejectedValue(netErr);
    vi.mocked(offline.repository.getCharts).mockRejectedValue(netErr);

    await expect(executeMediaPlayFromSearch(makeRequest(), offline.deps)).rejects.toThrow(
      new UserFacingPlayerError(strings.voice.offlineUnavailable),
    );

    const empty = createDeps();
    await expect(executeMediaPlayFromSearch(makeRequest(), empty.deps)).rejects.toThrow(
      new UserFacingPlayerError(strings.voice.emptyLibrary),
    );
  });

  it('prioritizes user playlists over public playlists for playlist focus and supports public fallback', async () => {
    const track = makeTrack({ id: 'p1', title: 'Gym Anthem' });
    const { deps, repository, player } = createDeps();
    vi.mocked(repository.getPlaylists).mockResolvedValue([
      {
        id: 42,
        name: 'Workout Mix',
        description: null,
        cover_url: null,
        is_public: false,
        track_count: 1,
        owner_id: 1,
        owner_name: 'Me',
        owner_avatar_url: null,
        is_collaborative: false,
        is_owner: true,
        is_collaborator: false,
        can_edit_tracks: true,
        collaborator_count: 0,
      },
    ]);
    vi.mocked(repository.getPlaylist).mockResolvedValue({
      id: 42,
      name: 'Workout Mix',
      description: null,
      cover_url: null,
      is_public: false,
      is_owner: true,
      owner_id: 1,
      owner_name: 'Me',
      owner_avatar_url: null,
      is_collaborative: false,
      is_collaborator: false,
      can_edit_tracks: true,
      collaborators: [],
      collaborator_count: 0,
      revision: 0,
      tracks: [track],
    });

    const userResult = await executeMediaPlayFromSearch(
      makeRequest({
        query: 'Workout Mix',
        mediaFocus: 'vnd.android.cursor.item/playlist',
        playlist: 'Workout Mix',
      }),
      deps,
    );

    expect(userResult).toEqual({
      kind: 'played-playlist',
      name: 'Workout Mix',
      trackCount: 1,
      source: 'user',
    });
    expect(player.playTracks).toHaveBeenCalledWith([track], 0, {
      context: { type: 'playlist', id: '42', label: 'Workout Mix' },
    });

    const pub = createDeps();
    vi.mocked(pub.repository.searchPlaylists).mockResolvedValue([
      { id: 'dz-9', title: 'Synthwave Night', cover: '', track_count: 1 },
    ]);
    vi.mocked(pub.repository.getDeezerPlaylist).mockResolvedValue({
      id: 'dz-9',
      name: 'Synthwave Night',
      cover: '',
      tracks: [
        {
          id: 'pt1',
          title: 'Nightcall',
          artist: 'Kavinsky',
          artist_id: '5',
          artists: [{ id: '5', name: 'Kavinsky' }],
          album: 'OutRun',
          album_id: '6',
          cover: '',
          duration_sec: 258,
          preview_url: null,
          rank: 1,
        },
      ],
    });

    const publicResult = await executeMediaPlayFromSearch(
      makeRequest({
        query: 'Synthwave Night',
        mediaFocus: 'vnd.android.cursor.item/playlist',
      }),
      pub.deps,
    );

    expect(publicResult).toEqual({
      kind: 'played-playlist',
      name: 'Synthwave Night',
      trackCount: 1,
      source: 'public',
    });
  });

  it('plays full album tracks for album focus and respects artist extra for disambiguation', async () => {
    const { deps, repository, player } = createDeps();
    const albumTrack = makeTrack({ id: 'al1', title: 'Give Life Back to Music', artist: 'Daft Punk' });
    vi.mocked(repository.searchAlbums).mockResolvedValue([
      { id: 'wrong', title: 'Random Access Memories Tribute', artistName: 'Cover Band', artworkUrl: null },
      { id: 'ram', title: 'Random Access Memories', artistName: 'Daft Punk', artworkUrl: null },
    ]);
    vi.mocked(repository.getAlbum).mockResolvedValue({
      id: 'ram',
      title: 'Random Access Memories',
      artist: 'Daft Punk',
      artist_id: '27',
      cover: '',
      release_date: '2013-05-17',
      nb_tracks: 1,
      tracks: [albumTrack],
    });

    const result = await executeMediaPlayFromSearch(
      makeRequest({
        query: 'Random Access Memories Daft Punk',
        mediaFocus: 'vnd.android.cursor.item/album',
        album: 'Random Access Memories',
        artist: 'Daft Punk',
      }),
      deps,
    );

    expect(result).toEqual({
      kind: 'played-album',
      title: 'Random Access Memories',
      trackCount: 1,
    });
    expect(repository.getAlbum).toHaveBeenCalledWith('ram');
    expect(player.playTracks).toHaveBeenCalledWith([albumTrack], 0, {
      context: { type: 'album', id: 'ram', label: 'Random Access Memories' },
    });
  });

  it('plays artist top tracks for artist focus and genre tracks for genre focus', async () => {
    const artistDeps = createDeps();
    const topTrack = makeTrack({ id: 'ar-t1', title: 'One More Time', artist: 'Daft Punk' });
    vi.mocked(artistDeps.repository.searchArtists).mockResolvedValue([
      { id: '27', name: 'Daft Punk', picture: '' },
    ]);
    vi.mocked(artistDeps.repository.getArtist).mockResolvedValue({
      id: '27',
      name: 'Daft Punk',
      picture: '',
      fans: 1000,
      albums_count: 5,
      top: [topTrack],
      albums: [],
      related: [],
    });

    const artistOutcome = await executeMediaPlayFromSearch(
      makeRequest({
        query: 'Daft Punk',
        mediaFocus: 'vnd.android.cursor.item/artist',
        artist: 'Daft Punk',
      }),
      artistDeps.deps,
    );
    expect(artistOutcome).toEqual({ kind: 'played-artist', name: 'Daft Punk', trackCount: 1 });

    const genreDeps = createDeps();
    const jazzTrack = makeTrack({ id: 'g-t1', title: 'So What', artist: 'Miles Davis' });
    vi.mocked(genreDeps.repository.getGenres).mockResolvedValue([
      { id: '129', name: 'Jazz', picture: '' },
    ]);
    vi.mocked(genreDeps.repository.getGenre).mockResolvedValue({
      id: '129',
      name: 'Jazz',
      picture: '',
      tracks: [jazzTrack],
      albums: [],
      artists: [],
    });

    const genreOutcome = await executeMediaPlayFromSearch(
      makeRequest({
        query: 'Jazz',
        mediaFocus: 'vnd.android.cursor.item/genre',
        genre: 'Jazz',
      }),
      genreDeps.deps,
    );
    expect(genreOutcome).toEqual({ kind: 'played-genre', name: 'Jazz', trackCount: 1 });
  });

  it('ranks structured audio requests deterministically and starts track radio', async () => {
    const { deps, repository, player } = createDeps();
    const liveCover = makeTrack({
      id: '1',
      title: 'Bohemian Rhapsody (Live Cover)',
      artist: 'Someone Else',
    });
    const original = makeTrack({
      id: '2',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
    });
    vi.mocked(repository.searchTracks).mockResolvedValue([liveCover, original]);

    const outcome = await executeMediaPlayFromSearch(
      makeRequest({
        query: 'Bohemian Rhapsody Queen',
        mediaFocus: 'vnd.android.cursor.item/audio',
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
      }),
      deps,
    );

    expect(outcome).toEqual({ kind: 'played-track', track: original, radioAttached: true });
    expect(player.playTrackWithRadio).toHaveBeenCalledWith(original);
  });

  it('does not accidentally pause when the requested track is already playing', async () => {
    const { deps, repository, player } = createDeps();
    const track = makeTrack({ id: 'active-1', title: 'Instant Crush', artist: 'Daft Punk' });
    vi.mocked(repository.searchTracks).mockResolvedValue([track]);
    vi.mocked(player.activeTrackId).mockReturnValue('active-1');
    vi.mocked(player.isPlaying).mockReturnValue(true);

    const outcome = await executeMediaPlayFromSearch(
      makeRequest({ query: 'Instant Crush' }),
      deps,
    );

    expect(outcome).toEqual({ kind: 'played-track', track, radioAttached: false });
    expect(player.playTrackWithRadio).not.toHaveBeenCalled();
    expect(player.resume).not.toHaveBeenCalled();
  });

  it('treats TrackRadioError as non-fatal notice while keeping the seed track playing', async () => {
    const { deps, repository, player, onRadioNotice, onNavigateNowPlaying } = createDeps();
    const track = makeTrack({ id: 'seed-1', title: 'Digital Love', artist: 'Daft Punk' });
    vi.mocked(repository.searchTracks).mockResolvedValue([track]);
    vi.mocked(player.playTrackWithRadio).mockRejectedValue(
      new FakeTrackRadioError('radio unavailable'),
    );

    const outcome = await executeMediaPlayFromSearch(
      makeRequest({ query: 'Digital Love' }),
      deps,
    );

    expect(outcome).toEqual({ kind: 'played-track', track, radioAttached: false });
    expect(onRadioNotice).toHaveBeenCalledWith(
      strings.search.radioFailed,
      strings.search.radioFailed,
    );
    expect(onNavigateNowPlaying).toHaveBeenCalledTimes(1);
  });

  it('matches an exact user playlist on unstructured free-text queries', async () => {
    const { deps, repository, player } = createDeps();
    const song = makeTrack({ id: 'rt1', title: 'Highway Star' });
    vi.mocked(repository.getPlaylists).mockResolvedValue([
      {
        id: 7,
        name: 'Roadtrip',
        description: null,
        cover_url: null,
        is_public: false,
        track_count: 1,
        owner_id: 1,
        owner_name: 'Me',
        owner_avatar_url: null,
        is_collaborative: false,
        is_owner: true,
        is_collaborator: false,
        can_edit_tracks: true,
        collaborator_count: 0,
      },
    ]);
    vi.mocked(repository.getPlaylist).mockResolvedValue({
      id: 7,
      name: 'Roadtrip',
      description: null,
      cover_url: null,
      is_public: false,
      is_owner: true,
      owner_id: 1,
      owner_name: 'Me',
      owner_avatar_url: null,
      is_collaborative: false,
      is_collaborator: false,
      can_edit_tracks: true,
      collaborators: [],
      collaborator_count: 0,
      revision: 0,
      tracks: [song],
    });

    const outcome = await executeMediaPlayFromSearch(
      makeRequest({ query: 'roadtrip' }),
      deps,
    );

    expect(outcome).toEqual({
      kind: 'played-playlist',
      name: 'Roadtrip',
      trackCount: 1,
      source: 'user',
    });
    expect(player.playTracks).toHaveBeenCalledTimes(1);
  });

  it('never masks network/API failures as no-results, and reports real empty queries loudly', async () => {
    const failed = createDeps();
    vi.mocked(failed.repository.searchTracks).mockRejectedValue(
      new ApiError(0, '', 'Network request failed'),
    );
    await expect(
      executeMediaPlayFromSearch(makeRequest({ query: 'Starboy' }), failed.deps),
    ).rejects.toThrow(new UserFacingPlayerError(strings.voice.offlineUnavailable));

    const empty = createDeps();
    await expect(
      executeMediaPlayFromSearch(makeRequest({ query: 'zzzz nonexistent song' }), empty.deps),
    ).rejects.toThrow(
      new UserFacingPlayerError(strings.voice.noMatchesFor('zzzz nonexistent song')),
    );
  });
});
