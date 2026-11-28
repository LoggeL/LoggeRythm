import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/error';
import {
  createMusicQueryOptions,
  LYRICS_STALE_TIME_MS,
  SIMILAR_TRACKS_STALE_TIME_MS,
} from './queryOptions';
import type { MusicRepository } from './repositories';
import type { AlbumCard } from '../domain/catalog';

const offlineLyricsMocks = vi.hoisted(() => ({
  scope: null as string | null,
  readOfflineLyrics: vi.fn(),
  saveOfflineLyrics: vi.fn(async () => undefined),
}));

// The option factory accepts an injected repository. Keep this pure unit test
// from loading the production React Native API client through the default.
vi.mock('./repositories', () => ({ musicRepository: {} }));
vi.mock('../offline/registry', () => ({
  getOfflineSnapshot: () => ({ scope: offlineLyricsMocks.scope }),
  trackIsExplicitlyDownloaded: () => false,
}));
vi.mock('../offline/lyricsCache', () => ({
  readOfflineLyrics: offlineLyricsMocks.readOfflineLyrics,
  saveOfflineLyrics: offlineLyricsMocks.saveOfflineLyrics,
}));

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
    option: (queries) => queries.searchTracks('  account-a  ', '  Kraftwerk  '),
    expectedKey: ['music', 'search', 'scope', 'account-a', 'track', 'Kraftwerk'],
    expectedArguments: (signal) => ['Kraftwerk', signal], enabled: true,
  },
  {
    factory: 'searchAlbums', repositoryMethod: 'searchAlbums',
    option: (queries) => queries.searchAlbums('  account-a  ', '  Kraftwerk  '),
    expectedKey: ['music', 'search', 'scope', 'account-a', 'album', 'Kraftwerk'],
    expectedArguments: (signal) => ['Kraftwerk', signal], enabled: true,
  },
  {
    factory: 'searchArtists', repositoryMethod: 'searchArtists',
    option: (queries) => queries.searchArtists('  account-a  ', '  Kraftwerk  '),
    expectedKey: ['music', 'search', 'scope', 'account-a', 'artist', 'Kraftwerk'],
    expectedArguments: (signal) => ['Kraftwerk', signal], enabled: true,
  },
  {
    factory: 'searchPlaylists', repositoryMethod: 'searchPlaylists',
    option: (queries) => queries.searchPlaylists('  account-a  ', '  Kraftwerk  '),
    expectedKey: ['music', 'search', 'scope', 'account-a', 'playlist', 'Kraftwerk'],
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
    factory: 'personalMixes', repositoryMethod: 'getPersonalMixes',
    option: (queries) => queries.personalMixes('  account-a  '),
    expectedKey: ['music', 'home', 'scope', 'account-a', 'personal-mixes'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'audioMeta', repositoryMethod: 'getTrackAudioMeta',
    option: (queries) => queries.audioMeta('42'),
    expectedKey: ['music', 'catalog', 'audio-meta', '42'],
    expectedArguments: (signal) => ['42', signal],
  },
  {
    factory: 'playlistDuplicates', repositoryMethod: 'getPlaylistDuplicates',
    option: (queries) => queries.playlistDuplicates('account-a', 7),
    expectedKey: ['music', 'playlists', 'scope', 'account-a', 'detail', '7', 'duplicates'],
    expectedArguments: (signal) => [7, signal],
  },
  {
    factory: 'statsInsights', repositoryMethod: 'getStatsInsights',
    option: (queries) => queries.statsInsights('account-a', '30d'),
    expectedKey: ['music', 'profile', 'private', 'account-a', 'insights', '30d'],
    expectedArguments: (signal) => ['30d', signal],
  },
  {
    factory: 'statsWrapped', repositoryMethod: 'getStatsWrapped',
    option: (queries) => queries.statsWrapped('account-a', '90d'),
    expectedKey: ['music', 'profile', 'private', 'account-a', 'wrapped', '90d'],
    expectedArguments: (signal) => ['90d', signal],
  },
  {
    factory: 'socialActivity', repositoryMethod: 'getSocialActivity',
    option: (queries) => queries.socialActivity('account-a'),
    expectedKey: ['music', 'social', 'account-a', 'activity'],
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
    factory: 'releaseRadarEntries', repositoryMethod: 'getReleaseRadar',
    option: (queries) => queries.releaseRadarEntries('  account-a  '),
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
    factory: 'importJobs', repositoryMethod: 'getImportJobs',
    option: (queries) => queries.importJobs('account-a'),
    expectedKey: ['music', 'external', 'import-jobs', 'account-a'],
    expectedArguments: (signal) => [signal],
  },
  {
    factory: 'importJob', repositoryMethod: 'getImportJob',
    option: (queries) => queries.importJob('account-a', 'job-1'),
    expectedKey: ['music', 'external', 'import-jobs', 'account-a', 'job-1'],
    expectedArguments: (signal) => ['job-1', signal],
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
    factory: 'playlistOutgoingInvitations', repositoryMethod: 'getPlaylistOutgoingInvitations',
    option: (queries) => queries.playlistOutgoingInvitations('  account-a  ', 9),
    expectedKey: ['music', 'playlists', 'scope', 'account-a', 'detail', '9', 'invitations'],
    expectedArguments: (signal) => [9, signal],
  },
  {
    factory: 'playlistInviteCandidates', repositoryMethod: 'searchPlaylistInviteCandidates',
    option: (queries) => queries.playlistInviteCandidates('  account-a  ', 9, '  Jule  '),
    expectedKey: [
      'music', 'playlists', 'scope', 'account-a', 'detail', '9', 'invite-candidates', 'Jule',
    ],
    expectedArguments: (signal) => [9, 'Jule', signal],
  },
  {
    factory: 'incomingPlaylistInvitations', repositoryMethod: 'getMyPlaylistInvitations',
    option: (queries) => queries.incomingPlaylistInvitations('  account-a  '),
    expectedKey: ['music', 'playlists', 'scope', 'account-a', 'invitations'],
    expectedArguments: (signal) => [signal],
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
  {
    factory: 'adminUsage', repositoryMethod: 'getAdminUsage',
    option: (queries) => queries.adminUsage('  account-a  ', '7d'),
    expectedKey: ['music', 'admin', 'account-a', 'usage', '7d'],
    expectedArguments: (signal) => ['7d', signal],
  },
  {
    factory: 'adminUserUsage', repositoryMethod: 'getAdminUserUsage',
    option: (queries) => queries.adminUserUsage('  account-a  ', 42, '30d'),
    expectedKey: ['music', 'admin', 'account-a', 'usage-user', '42', '30d'],
    expectedArguments: (signal) => [42, '30d', signal],
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

  it('serves the radar as plain tracks and as reasoned entries from one cache entry', async () => {
    const track = { id: '12', title: 'New Song' };
    const entries = [{
      track,
      radar_reason: { kind: 'played', artist_id: '7', artist_name: 'Known Artist', play_count: 4 },
    }];
    const getReleaseRadar = vi.fn(async () => entries);
    const queries = createMusicQueryOptions({ getReleaseRadar } as unknown as MusicRepository);
    const tracksOption = queries.releaseRadar('account-a');
    const entriesOption = queries.releaseRadarEntries('account-a');

    // Same key: Home (tracks) and the Radar screen (entries) share one request.
    expect(entriesOption.queryKey).toEqual(tracksOption.queryKey);
    const cached = await (tracksOption.queryFn as (context: never) => Promise<unknown>)(
      queryContext(new AbortController().signal),
    );
    expect(cached).toBe(entries);

    // The entries option exposes the cache as-is, reason included.
    expect('select' in entriesOption).toBe(false);
    // The tracks option hands out the very same Track objects, without the reason.
    const select = tracksOption.select;
    if (select === undefined) throw new Error('releaseRadar must select plain tracks');
    const tracks = select(entries as never);
    expect(tracks).toEqual([track]);
    expect(tracks[0]).toBe(track);
    // A stable selector keeps React Query's memoized array identity across renders.
    expect(queries.releaseRadar('account-a').select).toBe(select);
  });

  it('uses outer-trimmed scoped search text for both the key and repository request', async () => {
    const searchTracks = vi.fn(async () => []);
    const queries = createMusicQueryOptions({ searchTracks } as unknown as MusicRepository);
    const option = queries.searchTracks('account-a', '  Kraftwerk  ');
    const controller = new AbortController();

    expect(option.queryKey).toEqual(['music', 'search', 'scope', 'account-a', 'track', 'Kraftwerk']);
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

    await queries.searchTracks('account-a', '  Boards of Canada  ').queryFn!(queryContext(controller.signal));
    await queries.searchAlbums('account-a', '  Boards of Canada  ').queryFn!(queryContext(controller.signal));
    await queries.searchArtists('account-a', '  Boards of Canada  ').queryFn!(queryContext(controller.signal));
    await queries.searchPlaylists('account-a', '  Boards of Canada  ').queryFn!(queryContext(controller.signal));

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

    const result = await queries.searchAlbums('account-a', 'Album').queryFn!(queryContext(controller.signal));
    expect(result).toBe(cards);
    expect(searchAlbums).toHaveBeenCalledWith('Album', controller.signal);
  });

  it('disables empty searches instead of issuing a broad accidental request', () => {
    const queries = createMusicQueryOptions({} as MusicRepository);
    expect(queries.searchTracks('account-a', '   ').enabled).toBe(false);
    expect(queries.searchAlbums('account-a', '\n').enabled).toBe(false);
    expect(queries.searchArtists('account-a', '\t').enabled).toBe(false);
    expect(queries.searchPlaylists('account-a', ' ').enabled).toBe(false);
    expect(queries.playlistInviteCandidates('account-a', 9, '  ').enabled).toBe(false);
    expect(queries.playlistInviteCandidates('account-a', 9, ' Ju ').enabled).toBe(true);
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

  it('falls back to offline lyrics only on transport failures, never on 401/403 or abort', async () => {
    const cached = { lines: [{ t: 1, text: 'Cached' }], synced: true, source: 'lrclib', ai_generated: false, cached: true };
    offlineLyricsMocks.scope = 'https://music.example.test::user:7';
    offlineLyricsMocks.readOfflineLyrics.mockReset();
    offlineLyricsMocks.readOfflineLyrics.mockResolvedValue(cached);

    try {
      const getLyrics = vi.fn();
      const queries = createMusicQueryOptions({ getLyrics } as unknown as MusicRepository);
      const option = queries.lyrics('Artist', 'Title', '42');

      // 401 must propagate and never serve cached lyrics.
      const authError = new ApiError(401, '', 'Unauthorized');
      getLyrics.mockRejectedValueOnce(authError);
      await expect(option.queryFn!(queryContext(new AbortController().signal))).rejects.toBe(authError);
      expect(offlineLyricsMocks.readOfflineLyrics).not.toHaveBeenCalled();

      // Aborted signal must propagate and never serve cached lyrics.
      const aborted = new AbortController();
      aborted.abort();
      const cancelError = new ApiError(0, '', 'Cancelled');
      getLyrics.mockRejectedValueOnce(cancelError);
      await expect(option.queryFn!(queryContext(aborted.signal))).rejects.toBe(cancelError);
      expect(offlineLyricsMocks.readOfflineLyrics).not.toHaveBeenCalled();

      // Transport failure (status 0) serves verified offline lyrics.
      getLyrics.mockRejectedValueOnce(new ApiError(0, '', 'Network offline'));
      await expect(option.queryFn!(queryContext(new AbortController().signal))).resolves.toEqual(cached);
      expect(offlineLyricsMocks.readOfflineLyrics).toHaveBeenCalledWith(
        'https://music.example.test::user:7',
        '42',
      );
    } finally {
      offlineLyricsMocks.scope = null;
    }
  });
});
