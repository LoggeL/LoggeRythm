import { describe, expect, it, vi } from 'vitest';
import {
  createMusicQueryOptions,
  LYRICS_STALE_TIME_MS,
  SIMILAR_TRACKS_STALE_TIME_MS,
} from './queryOptions';
import type { MusicRepository } from './repositories';
import type { AlbumCard } from '../domain/catalog';

// The option factory accepts an injected repository. Keep this pure unit test
// from loading the production React Native API client through the default.
vi.mock('./repositories', () => ({ musicRepository: {} }));

function queryContext(signal: AbortSignal): never {
  return {
    client: undefined,
    queryKey: [],
    meta: undefined,
    signal,
  } as never;
}

type MusicQueryFactories = ReturnType<typeof createMusicQueryOptions>;
type MusicQueryFactoryName = keyof MusicQueryFactories;

interface QueryOptionUnderTest {
  queryKey: readonly unknown[];
  queryFn?: unknown;
  enabled?: boolean;
  staleTime?: number;
  retry?: boolean;
}

interface ReadFactoryCase {
  factory: MusicQueryFactoryName;
  repositoryMethod: keyof MusicRepository;
  option: (queries: MusicQueryFactories) => unknown;
  expectedKey: readonly unknown[];
  expectedArguments: (signal: AbortSignal) => readonly unknown[];
  enabled?: boolean;
}

const playCountRequest = [{ id: '12', artist: 'AC/DC', title: 'One & Two' }];
const canonicalFollowInput = ['3', '1', '3'];

/**
 * Exhaustive executable contract for every read factory. The factory-name
 * assertion below intentionally fails when a new factory is added without an
 * exact key/payload/cancellation case here.
 */
const READ_FACTORY_CASES: readonly ReadFactoryCase[] = [
  {
    factory: 'searchTracks', repositoryMethod: 'searchTracks',
    option: (queries) => queries.searchTracks('  Kraftwerk  '),
    expectedKey: ['music', 'search', 'track', 'Kraftwerk'],
    expectedArguments: (signal) => ['Kraftwerk', signal], enabled: true,
  },
  {
    factory: 'searchAlbums', repositoryMethod: 'searchAlbums',
    option: (queries) => queries.searchAlbums('  Kraftwerk  '),
    expectedKey: ['music', 'search', 'album', 'Kraftwerk'],
    expectedArguments: (signal) => ['Kraftwerk', signal], enabled: true,
  },
  {
    factory: 'searchArtists', repositoryMethod: 'searchArtists',
    option: (queries) => queries.searchArtists('  Kraftwerk  '),
    expectedKey: ['music', 'search', 'artist', 'Kraftwerk'],
    expectedArguments: (signal) => ['Kraftwerk', signal], enabled: true,
  },
  {
    factory: 'searchPlaylists', repositoryMethod: 'searchPlaylists',
    option: (queries) => queries.searchPlaylists('  Kraftwerk  '),
    expectedKey: ['music', 'search', 'playlist', 'Kraftwerk'],
    expectedArguments: (signal) => ['Kraftwerk', signal], enabled: true,
  },
  {
    factory: 'charts', repositoryMethod: 'getCharts', option: (queries) => queries.charts(),
    expectedKey: ['music', 'catalog', 'charts'], expectedArguments: (signal) => [signal],
  },
  {
    factory: 'homeMixes', repositoryMethod: 'getHomeMixes',
    option: (queries) => queries.homeMixes('  account-a  '),
    expectedKey: ['music', 'home', 'scope', 'account-a', 'mixes'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'becauseYouListened', repositoryMethod: 'getBecauseYouListened',
    option: (queries) => queries.becauseYouListened('  account-a  '),
    expectedKey: ['music', 'home', 'scope', 'account-a', 'because-you-listened'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'homeChartCollections', repositoryMethod: 'getHomeChartCollections',
    option: (queries) => queries.homeChartCollections(),
    expectedKey: ['music', 'home', 'charts-collections'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'releaseRadar', repositoryMethod: 'getReleaseRadar',
    option: (queries) => queries.releaseRadar('  account-a  '),
    expectedKey: ['music', 'home', 'scope', 'account-a', 'release-radar'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'mood', repositoryMethod: 'getMood', option: (queries) => queries.mood('  chill  '),
    expectedKey: ['music', 'home', 'mood', 'chill'],
    expectedArguments: (signal) => ['chill', signal],
  },
  {
    factory: 'genres', repositoryMethod: 'getGenres', option: (queries) => queries.genres(),
    expectedKey: ['music', 'catalog', 'genres'], expectedArguments: (signal) => [signal],
  },
  {
    factory: 'genre', repositoryMethod: 'getGenre', option: (queries) => queries.genre('42'),
    expectedKey: ['music', 'catalog', 'genres', '42'],
    expectedArguments: (signal) => ['42', signal],
  },
  {
    factory: 'newReleases', repositoryMethod: 'getNewReleases',
    option: (queries) => queries.newReleases(),
    expectedKey: ['music', 'catalog', 'new-releases'], expectedArguments: (signal) => [signal],
  },
  {
    factory: 'track', repositoryMethod: 'getTrack', option: (queries) => queries.track('43'),
    expectedKey: ['music', 'catalog', 'track', '43'],
    expectedArguments: (signal) => ['43', signal],
  },
  {
    factory: 'album', repositoryMethod: 'getAlbum', option: (queries) => queries.album('44'),
    expectedKey: ['music', 'catalog', 'album', '44'],
    expectedArguments: (signal) => ['44', signal],
  },
  {
    factory: 'artist', repositoryMethod: 'getArtist', option: (queries) => queries.artist('45'),
    expectedKey: ['music', 'catalog', 'artist', '45'],
    expectedArguments: (signal) => ['45', signal],
  },
  {
    factory: 'artistAbout', repositoryMethod: 'getArtistAbout',
    option: (queries) => queries.artistAbout('  Björk  '),
    expectedKey: ['music', 'catalog', 'artist-about', 'Björk'],
    expectedArguments: (signal) => ['Björk', signal],
  },
  {
    factory: 'similarTracks', repositoryMethod: 'getRadio',
    option: (queries) => queries.similarTracks('  46  '),
    expectedKey: ['music', 'radio', 'similar', '46'],
    expectedArguments: (signal) => ['46', signal],
  },
  {
    factory: 'resolveExternalUrl', repositoryMethod: 'resolveExternalUrl',
    option: (queries) => queries.resolveExternalUrl('  https://open.spotify.com/track/abc  '),
    expectedKey: ['music', 'external', 'resolve', 'https://open.spotify.com/track/abc'],
    expectedArguments: (signal) => ['https://open.spotify.com/track/abc', signal],
  },
  {
    factory: 'deezerPlaylist', repositoryMethod: 'getDeezerPlaylist',
    option: (queries) => queries.deezerPlaylist('47'),
    expectedKey: ['music', 'external', 'deezer-playlist', '47'],
    expectedArguments: (signal) => ['47', signal],
  },
  {
    factory: 'lyrics', repositoryMethod: 'getLyrics',
    option: (queries) => queries.lyrics('  AC/DC  ', '  One & Two  ', '48'),
    expectedKey: ['music', 'lyrics', 'AC/DC', 'One & Two', '48'],
    expectedArguments: (signal) => ['AC/DC', 'One & Two', '48', signal],
  },
  {
    factory: 'cachedTrackIds', repositoryMethod: 'getCachedTrackIds',
    option: (queries) => queries.cachedTrackIds(),
    expectedKey: ['music', 'storage', 'cached-track-ids'], expectedArguments: (signal) => [signal],
  },
  {
    factory: 'trackPlayCounts', repositoryMethod: 'getTrackPlayCounts',
    option: (queries) => queries.trackPlayCounts(playCountRequest),
    expectedKey: ['music', 'plays', 'counts', [['12', 'AC/DC', 'One & Two']]],
    expectedArguments: (signal) => [playCountRequest, signal],
  },
  {
    factory: 'playlists', repositoryMethod: 'getPlaylists',
    option: (queries) => queries.playlists('  account-a  '),
    expectedKey: ['music', 'playlists', 'scope', 'account-a', 'owned'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'publicPlaylists', repositoryMethod: 'getPublicPlaylists',
    option: (queries) => queries.publicPlaylists('  account-a  '),
    expectedKey: ['music', 'playlists', 'scope', 'account-a', 'public'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'playlist', repositoryMethod: 'getPlaylist',
    option: (queries) => queries.playlist('  account-a  ', 9),
    expectedKey: ['music', 'playlists', 'scope', 'account-a', 'detail', '9'],
    expectedArguments: (signal) => [9, signal],
  },
  {
    factory: 'likes', repositoryMethod: 'getLikes',
    option: (queries) => queries.likes('  account-a  '),
    expectedKey: ['music', 'library', 'account-a', 'likes'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'following', repositoryMethod: 'getFollowingArtists',
    option: (queries) => queries.following('  account-a  '),
    expectedKey: ['music', 'follows', 'account-a', 'artists'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'followingContains', repositoryMethod: 'followingContains',
    option: (queries) => queries.followingContains('  account-a  ', canonicalFollowInput),
    expectedKey: ['music', 'follows', 'account-a', 'artists', 'contains', ['1', '3']],
    expectedArguments: (signal) => [['1', '3'], signal],
  },
  {
    factory: 'publicProfile', repositoryMethod: 'getPublicProfile',
    option: (queries) => queries.publicProfile(10),
    expectedKey: ['music', 'profile', 'public', '10'], expectedArguments: (signal) => [10, signal],
  },
  {
    factory: 'stats', repositoryMethod: 'getStats',
    option: (queries) => queries.stats('  account-a  '),
    expectedKey: ['music', 'profile', 'private', 'account-a', 'stats'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'playbackSettings', repositoryMethod: 'getPlaybackSettings',
    option: (queries) => queries.playbackSettings('  account-a  '),
    expectedKey: ['music', 'profile', 'private', 'account-a', 'settings'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'party', repositoryMethod: 'getParty',
    option: (queries) => queries.party('  account-a  ', '  ABC123  '),
    expectedKey: ['music', 'party', 'scope', 'account-a', 'ABC123'],
    expectedArguments: (signal) => ['ABC123', signal],
  },
  {
    factory: 'adminUsers', repositoryMethod: 'getAdminUsers',
    option: (queries) => queries.adminUsers('  account-a  '),
    expectedKey: ['music', 'admin', 'account-a', 'users'], expectedArguments: (signal) => [signal],
  },
  {
    factory: 'adminStatus', repositoryMethod: 'getAdminStatus',
    option: (queries) => queries.adminStatus('  account-a  '),
    expectedKey: ['music', 'admin', 'account-a', 'status'], expectedArguments: (signal) => [signal],
  },
  {
    factory: 'adminStorage', repositoryMethod: 'getAdminStorage',
    option: (queries) => queries.adminStorage('  account-a  '),
    expectedKey: ['music', 'admin', 'account-a', 'storage'], expectedArguments: (signal) => [signal],
  },
  {
    factory: 'adminInvites', repositoryMethod: 'getAdminInvites',
    option: (queries) => queries.adminInvites('  account-a  '),
    expectedKey: ['music', 'admin', 'account-a', 'invites'], expectedArguments: (signal) => [signal],
  },
];

describe('music query options', () => {
  it('accounts for every current read factory in the executable contract table', () => {
    const factories = createMusicQueryOptions({} as MusicRepository);
    expect(Object.keys(factories).sort()).toEqual(
      READ_FACTORY_CASES.map(({ factory }) => factory).sort(),
    );
    expect(new Set(READ_FACTORY_CASES.map(({ factory }) => factory)).size)
      .toBe(READ_FACTORY_CASES.length);
  });

  it.each(READ_FACTORY_CASES)(
    '$factory uses its exact key, normalized payload, and AbortSignal',
    async ({ repositoryMethod, option: buildOption, expectedKey, expectedArguments, enabled }) => {
      const repositoryCall = vi.fn(async () => []);
      const repository = { [repositoryMethod]: repositoryCall } as unknown as MusicRepository;
      const factories = createMusicQueryOptions(repository);
      const option = buildOption(factories) as QueryOptionUnderTest;
      const controller = new AbortController();

      expect(option.queryKey).toEqual(expectedKey);
      if (enabled !== undefined) expect(option.enabled).toBe(enabled);
      expect(typeof option.queryFn).toBe('function');
      const queryFn = option.queryFn as (context: never) => Promise<unknown>;
      await queryFn(queryContext(controller.signal));

      expect(repositoryCall).toHaveBeenCalledOnce();
      expect(repositoryCall).toHaveBeenCalledWith(...expectedArguments(controller.signal));
    },
  );

  it('uses normalized search text for both the key and repository request', async () => {
    const searchTracks = vi.fn(async () => []);
    const queries = createMusicQueryOptions({ searchTracks } as unknown as MusicRepository);
    const option = queries.searchTracks('  Kraftwerk  ');
    const controller = new AbortController();

    expect(option.queryKey).toEqual(['music', 'search', 'track', 'Kraftwerk']);
    expect(option.enabled).toBe(true);
    await option.queryFn!(queryContext(controller.signal));
    expect(searchTracks).toHaveBeenCalledWith('Kraftwerk', controller.signal);
  });

  it('forwards the TanStack cancellation signal through every search repository call', async () => {
    const searchTracks = vi.fn(async () => []);
    const searchAlbums = vi.fn(async () => []);
    const searchArtists = vi.fn(async () => []);
    const searchPlaylists = vi.fn(async () => []);
    const queries = createMusicQueryOptions({
      searchTracks,
      searchAlbums,
      searchArtists,
      searchPlaylists,
    } as unknown as MusicRepository);
    const controller = new AbortController();

    await queries.searchTracks('  Boards of Canada  ').queryFn!(queryContext(controller.signal));
    await queries.searchAlbums('  Boards of Canada  ').queryFn!(queryContext(controller.signal));
    await queries.searchArtists('  Boards of Canada  ').queryFn!(queryContext(controller.signal));
    await queries.searchPlaylists('  Boards of Canada  ').queryFn!(queryContext(controller.signal));

    expect(searchTracks).toHaveBeenCalledWith('Boards of Canada', controller.signal);
    expect(searchAlbums).toHaveBeenCalledWith('Boards of Canada', controller.signal);
    expect(searchArtists).toHaveBeenCalledWith('Boards of Canada', controller.signal);
    expect(searchPlaylists).toHaveBeenCalledWith('Boards of Canada', controller.signal);
  });

  it('returns repository-owned album domain cards directly to the query cache', async () => {
    const cards: AlbumCard[] = [
      { id: '42', title: 'Album', artistName: 'Artist', artworkUrl: null },
    ];
    const searchAlbums = vi.fn(async () => cards);
    const queries = createMusicQueryOptions({ searchAlbums } as unknown as MusicRepository);
    const controller = new AbortController();

    const result = await queries.searchAlbums('Album').queryFn!(queryContext(controller.signal));
    expect(result).toBe(cards);
    expect(searchAlbums).toHaveBeenCalledWith('Album', controller.signal);
  });

  it('disables empty searches instead of issuing a broad accidental request', () => {
    const queries = createMusicQueryOptions({} as MusicRepository);
    expect(queries.searchTracks('   ').enabled).toBe(false);
    expect(queries.searchAlbums('\n').enabled).toBe(false);
    expect(queries.searchArtists('\t').enabled).toBe(false);
    expect(queries.searchPlaylists(' ').enabled).toBe(false);
  });

  it('canonicalizes batch follow ids before calling the repository', async () => {
    const followingContains = vi.fn(async () => ({}));
    const queries = createMusicQueryOptions({ followingContains } as unknown as MusicRepository);
    const option = queries.followingContains('user-9', ['3', '1', '3']);
    const controller = new AbortController();

    expect(option.queryKey).toEqual([
      'music',
      'follows',
      'user-9',
      'artists',
      'contains',
      ['1', '3'],
    ]);
    await option.queryFn!(queryContext(controller.signal));
    expect(followingContains).toHaveBeenCalledWith(['1', '3'], controller.signal);
  });

  it('viewer-scopes playlist and party reads while forwarding cancellation', async () => {
    const getPlaylist = vi.fn(async () => undefined);
    const getParty = vi.fn(async () => undefined);
    const queries = createMusicQueryOptions({ getPlaylist, getParty } as unknown as MusicRepository);
    const controller = new AbortController();

    const playlist = queries.playlist('user-7', 4);
    const party = queries.party('user-7', '  ABC123  ');
    expect(playlist.queryKey).toEqual(['music', 'playlists', 'scope', 'user-7', 'detail', '4']);
    expect(party.queryKey).toEqual(['music', 'party', 'scope', 'user-7', 'ABC123']);
    await playlist.queryFn!(queryContext(controller.signal));
    await party.queryFn!(queryContext(controller.signal));
    expect(getPlaylist).toHaveBeenCalledWith(4, controller.signal);
    expect(getParty).toHaveBeenCalledWith('ABC123', controller.signal);
  });

  it('viewer-scopes likes and forwards query cancellation', async () => {
    const getLikes = vi.fn(async () => []);
    const queries = createMusicQueryOptions({ getLikes } as unknown as MusicRepository);
    const controller = new AbortController();

    const likes = queries.likes('user-7');
    expect(likes.queryKey).toEqual(['music', 'library', 'user-7', 'likes']);
    await likes.queryFn!(queryContext(controller.signal));
    expect(getLikes).toHaveBeenCalledWith(controller.signal);
  });

  it('preserves exact lyrics and play-count inputs in read queries', async () => {
    const getLyrics = vi.fn(async () => undefined);
    const getTrackPlayCounts = vi.fn(async () => ({}));
    const queries = createMusicQueryOptions({
      getLyrics,
      getTrackPlayCounts,
    } as unknown as MusicRepository);
    const controller = new AbortController();
    const tracks = [{ id: '12', artist: 'AC/DC', title: 'One & Two' }];

    const lyrics = queries.lyrics('  AC/DC  ', '  One & Two  ', '12');
    const counts = queries.trackPlayCounts(tracks);
    expect(lyrics.queryKey).toEqual(['music', 'lyrics', 'AC/DC', 'One & Two', '12']);
    expect(lyrics.staleTime).toBe(LYRICS_STALE_TIME_MS);
    expect(lyrics.retry).toBe(false);
    await lyrics.queryFn!(queryContext(controller.signal));
    await counts.queryFn!(queryContext(controller.signal));
    expect(getLyrics).toHaveBeenCalledWith('AC/DC', 'One & Two', '12', controller.signal);
    expect(getTrackPlayCounts).toHaveBeenCalledWith(tracks, controller.signal);
  });

  it('uses track identity in lyrics cache keys so a replacement cannot reuse stale actions', () => {
    const queries = createMusicQueryOptions({} as MusicRepository);
    expect(queries.lyrics('Artist A', 'Title A', '12').queryKey).not.toEqual(
      queries.lyrics('Artist B', 'Title B', '13').queryKey,
    );
  });

  it('keys Similar by seed and forwards cancellation with an exact 15-minute stale time', async () => {
    const tracks = [{ id: '99', title: 'Similar track' }];
    const getRadio = vi.fn(async () => tracks);
    const queries = createMusicQueryOptions({ getRadio } as unknown as MusicRepository);
    const controller = new AbortController();
    const option = queries.similarTracks('  42  ');

    expect(option.queryKey).toEqual(['music', 'radio', 'similar', '42']);
    expect(option.queryKey).not.toEqual(queries.similarTracks('43').queryKey);
    expect(SIMILAR_TRACKS_STALE_TIME_MS).toBe(15 * 60_000);
    expect(option.staleTime).toBe(15 * 60_000);
    await expect(option.queryFn!(queryContext(controller.signal))).resolves.toBe(tracks);
    expect(getRadio).toHaveBeenCalledOnce();
    expect(getRadio).toHaveBeenCalledWith('42', controller.signal);
  });
});
