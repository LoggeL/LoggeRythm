import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlbumDetail, AlbumSummary, ArtistDetail, ArtistSummary, Genre, PlaylistSummary, Track } from '../api/types';
import { byTestId, queryByTestId } from '../test/render';
import AlbumScreen from './AlbumScreen';
import ArtistScreen from './ArtistScreen';
import DiscoverScreen from './DiscoverScreen';
import GenreScreen from './GenreScreen';
import LibraryScreen from './LibraryScreen';
import PartyScreen from './PartyScreen';
import PlaylistScreen from './PlaylistScreen';
import RadioScreen from './RadioScreen';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  useOfflineDownloads: vi.fn(),
  usePlaylistMutations: vi.fn(),
  usePlaylistEditForm: vi.fn(),
  usePlaylistOffline: vi.fn(),
  useCreatePlaylist: vi.fn(),
  useArtistFollow: vi.fn(),
  useArtistSongSearch: vi.fn(),
  useBackHandler: vi.fn(),
  useTvFocusReturn: vi.fn(),
  isFocused: true,
  playTracks: vi.fn(),
  playTrackRow: vi.fn(),
  toggleShuffle: vi.fn(),
  findCachedAlbumSummary: vi.fn(),
  findCachedArtistSummary: vi.fn(),
  findCachedGenre: vi.fn(),
  findCachedPlaylistSummary: vi.fn(),
  reducedMotion: false,
  stateSlot: 0,
  stateValues: [] as unknown[],
  stateSetters: [] as ReturnType<typeof vi.fn>[],
  scrollRef: { current: { scrollTo: vi.fn() } },
  tvEnv: {
    isTv: false,
    contentWidth: 360,
    splitPrimaryRatio: 0.44,
    gridColumns: 2,
    gridGap: 14,
    cardSize: 148,
    contentPaddingHorizontal: 20,
    sectionGap: 28,
    overscan: { top: 0, right: 0, bottom: 0, left: 0 },
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: <T,>(initial: T | (() => T)) => {
      const slot = mocks.stateSlot++;
      if (slot >= mocks.stateValues.length) {
        mocks.stateValues[slot] =
          typeof initial === 'function' ? (initial as () => T)() : initial;
        mocks.stateSetters[slot] = vi.fn((next: T | ((prev: T) => T)) => {
          mocks.stateValues[slot] =
            typeof next === 'function'
              ? (next as (prev: T) => T)(mocks.stateValues[slot] as T)
              : next;
        });
      }
      return [mocks.stateValues[slot] as T, mocks.stateSetters[slot]];
    },
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T,>(fn: T) => fn,
    useEffect: vi.fn(),
    useRef: <T,>(initial: T) => (initial === null ? mocks.scrollRef : { current: initial }),
  };
});

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  FlatList: 'FlatList',
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  SectionList: 'SectionList',
  Share: { share: vi.fn() },
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('../components/party/PartyParts', () => ({
  PartyHeader: 'PartyHeader',
  PartyMembers: 'PartyMembers',
  PartyNotice: 'PartyNotice',
  PartyQueueRow: 'PartyQueueRow',
  PartySearchResultRow: 'PartySearchResultRow',
}));
vi.mock('../components/search/SpotifyImportForm', () => ({
  spotifyImportInputStyle: {},
}));
vi.mock('../data/repositories', () => ({
  musicRepository: {
    searchTracks: vi.fn(),
    partyAddTrack: vi.fn(),
    partySetCurrent: vi.fn(),
    partyReorder: vi.fn(),
    partyRemoveTrack: vi.fn(),
  },
}));
vi.mock('../party/partyErrors', () => ({
  partyErrorDetail: (error: unknown) => String(error),
}));
vi.mock('../party/partyModel', () => ({
  movedPartyIds: () => [],
  partyDisplayName: () => 'Friday Mix',
  partyInviteUrl: () => 'https://music.example.test/party/ABCD',
}));
vi.mock('../party/partyRuntime', () => ({
  partySession: () => ({ enter: vi.fn(), retryJoin: vi.fn(), leave: vi.fn(), reload: vi.fn(), rejoinPlayback: vi.fn() }),
  usePartySession: () => ({
    code: 'ABCD',
    phase: 'connected',
    detached: false,
    error: null,
    playbackError: null,
    party: {
      code: 'ABCD',
      name: 'Friday Mix',
      is_host: true,
      host_name: 'Logge',
      current_index: 0,
      tracks: [],
      members: [],
    },
  }),
}));
vi.mock('../player/player', () => ({
  PlaybackState: { Buffering: 'buffering', Playing: 'playing', Paused: 'paused' },
  usePlaybackState: () => 'playing',
}));
vi.mock('../components/radio/RadioCards', () => ({
  RadioQueryStation: 'RadioQueryStation',
  RadioSection: 'RadioSection',
  RadioStationCard: 'RadioStationCard',
}));
vi.mock('../components/radio/RadioHero', () => ({ RadioHero: 'RadioHero' }));
vi.mock('../components/radio/useOnAirStation', () => ({ useOnAirStation: () => null }));
vi.mock('../components/radio/useRadioStations', () => ({
  radioStationKey: {
    personal: (id: string) => `personal:${id}`,
    mood: (tag: string) => `mood:${tag}`,
    genre: (id: string) => `genre:${id}`,
  },
  useRadioStations: () => ({
    startingKey: null,
    refreshing: false,
    refresh: vi.fn(),
    startError: null,
    dismissStartError: vi.fn(),
    personal: [],
    personalState: 'empty',
    personalBusy: false,
    retryPersonal: vi.fn(),
    startPersonal: vi.fn(),
    moods: [],
    startMood: vi.fn(),
    genres: [],
    genreState: 'empty',
    genresBusy: false,
    retryGenres: vi.fn(),
    startGenre: vi.fn(),
  }),
}));

vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => mocks.isFocused,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../config', () => ({
  getApiBase: vi.fn(async () => 'https://music.example.test'),
  getCurrentApiBase: () => 'https://music.example.test',
}));
vi.mock('../hooks/useBottomInset', () => ({ useBottomInset: () => 96 }));
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mocks.reducedMotion,
  getReducedMotionSnapshot: () => mocks.reducedMotion,
}));
vi.mock('../hooks/useBackHandler', () => ({ useBackHandler: mocks.useBackHandler }));
vi.mock('../tv', () => ({
  TvFocusScope: 'TvFocusScope',
  tvFocusRegistry: { pushCheckpoint: vi.fn(), popAndRestore: vi.fn() },
  useTvEnvironment: () => mocks.tvEnv,
  useTvFocusReturn: mocks.useTvFocusReturn,
}));
vi.mock('../components/AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  BottomSheet: 'BottomSheet',
  CardRailSkeleton: 'CardRailSkeleton',
  DetailHeroSkeleton: 'DetailHeroSkeleton',
  PressableScale: 'PressableScale',
  Skeleton: 'Skeleton',
  TrackRowSkeleton: 'TrackRowSkeleton',
}));
vi.mock('../components/track/StandardTrackRow', () => ({ default: 'StandardTrackRow' }));
vi.mock('../components/track/TrackShelfCard', () => ({ default: 'TrackShelfCard' }));
vi.mock('../components/trackActions', () => ({ showTrackActions: vi.fn() }));
vi.mock('../components/search/GenreTiles', () => ({ GenreTileGrid: 'GenreTileGrid' }));
vi.mock('../components/library/LibraryVirtualizedList', () => ({
  LibraryVirtualizedList: 'LibraryVirtualizedList',
}));
vi.mock('../components/library/LibraryCreatePlaylistSheet', () => ({
  LibraryCreatePlaylistSheet: 'LibraryCreatePlaylistSheet',
}));
vi.mock('../components/library/PlaylistActionsSheet', () => ({
  PlaylistActionsSheet: 'PlaylistActionsSheet',
}));
vi.mock('../components/library/PlaylistEditSheet', () => ({
  PlaylistEditSheet: 'PlaylistEditSheet',
  usePlaylistEditForm: mocks.usePlaylistEditForm,
}));
vi.mock('../components/library/PlaylistDeleteSheet', () => ({
  PlaylistDeleteSheet: 'PlaylistDeleteSheet',
}));
vi.mock('../components/library/useCreatePlaylist', () => ({
  useCreatePlaylist: mocks.useCreatePlaylist,
}));
vi.mock('../components/library/usePlaylistMutations', () => ({
  usePlaylistMutations: mocks.usePlaylistMutations,
}));
vi.mock('../components/library/usePlaylistOffline', () => ({
  usePlaylistOffline: mocks.usePlaylistOffline,
}));
vi.mock('../components/library/autoBrowse', () => ({
  refreshAutoBrowse: vi.fn(async () => undefined),
  refreshOfflineAutoBrowse: vi.fn(async () => undefined),
}));
vi.mock('../components/catalog/CatalogCollectionPage', () => ({
  CatalogCollectionPage: 'CatalogCollectionPage',
}));
vi.mock('../components/catalog/CatalogTrackList', () => ({
  CatalogTrackList: 'CatalogTrackList',
}));
vi.mock('../components/catalog/ArtistVirtualizedList', () => ({
  ArtistVirtualizedList: 'ArtistVirtualizedList',
}));
vi.mock('../components/catalog/ArtistFooter', () => ({ ArtistFooter: 'ArtistFooter' }));
vi.mock('../components/catalog/ArtistLikedTracksHeader', () => ({
  ArtistLikedTracksHeader: 'ArtistLikedTracksHeader',
}));
vi.mock('../components/catalog/ArtistSongSearchHeader', () => ({
  ArtistSongSearchHeader: 'ArtistSongSearchHeader',
}));
vi.mock('./useArtistFollow', () => ({ useArtistFollow: mocks.useArtistFollow }));
vi.mock('./useArtistSongSearch', () => ({ useArtistSongSearch: mocks.useArtistSongSearch }));
vi.mock('../offline/hooks', () => ({ useOfflineDownloads: mocks.useOfflineDownloads }));
vi.mock('../data', () => ({
  findCachedAlbumSummary: mocks.findCachedAlbumSummary,
  findCachedArtistSummary: mocks.findCachedArtistSummary,
  findCachedGenre: mocks.findCachedGenre,
  findCachedPlaylistSummary: mocks.findCachedPlaylistSummary,
  musicCacheScope: (origin: string, id: number) => `${origin}::user:${id}`,
  musicQueries: {
    album: (id: string) => ({ queryKey: ['album', id] }),
    artist: (id: string) => ({ queryKey: ['artist', id] }),
    artistAbout: (name: string) => ({ queryKey: ['artistAbout', name] }),
    trackPlayCounts: () => ({ queryKey: ['trackPlayCounts'] }),
    genre: (id: string) => ({ queryKey: ['genre', id] }),
    charts: () => ({ queryKey: ['charts'] }),
    genres: () => ({ queryKey: ['genres'] }),
    newReleases: () => ({ queryKey: ['newReleases'] }),
    playlists: (scope: string) => ({ queryKey: ['playlists', scope] }),
    publicPlaylists: (scope: string) => ({ queryKey: ['publicPlaylists', scope] }),
    playlist: (scope: string, id: number) => ({ queryKey: ['playlist', scope, id] }),
    likes: (scope: string) => ({ queryKey: ['likes', scope] }),
    stats: (scope: string) => ({ queryKey: ['stats', scope] }),
    following: (scope: string) => ({ queryKey: ['following', scope] }),
    track: (id: string) => ({ queryKey: ['track', id] }),
  },
}));
vi.mock('../player/controller', () => ({
  playTracks: mocks.playTracks,
  playTrackRow: mocks.playTrackRow,
  toggleShuffle: mocks.toggleShuffle,
}));

const sampleTrack: Track = {
  id: '101',
  title: 'Night Signal',
  artist: 'Solstice',
  artist_id: '7',
  artists: [{ id: '7', name: 'Solstice' }],
  album: 'Horizon',
  album_id: '55',
  cover: 'https://img.example.test/c.jpg',
  duration_sec: 210,
  preview_url: null,
  rank: 100,
  release_date: '2026-01-01',
};

function queryResult<T>(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined as T | undefined,
    error: null,
    isPending: true,
    isFetching: true,
    isStale: false,
    fetchStatus: 'fetching' as const,
    refetch: vi.fn(async () => undefined),
    ...overrides,
  };
}

function resetState(values: unknown[] = []) {
  mocks.stateSlot = 0;
  mocks.stateValues = [...values];
  mocks.stateSetters = values.map((_, idx) =>
    vi.fn((next: unknown) => {
      mocks.stateValues[idx] =
        typeof next === 'function'
          ? (next as (prev: unknown) => unknown)(mocks.stateValues[idx])
          : next;
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  mocks.isFocused = true;
  mocks.reducedMotion = false;
  mocks.tvEnv = {
    isTv: false,
    contentWidth: 360,
    splitPrimaryRatio: 0.44,
    gridColumns: 2,
    gridGap: 14,
    cardSize: 148,
    contentPaddingHorizontal: 20,
    sectionGap: 28,
    overscan: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  mocks.useAuth.mockReturnValue({ user: { id: 7 } });
  mocks.useQueryClient.mockReturnValue({ fetchQuery: vi.fn() });
  mocks.useOfflineDownloads.mockReturnValue({
    hydrated: true,
    unavailable: false,
    playlists: {},
    tracks: {},
  });
  mocks.usePlaylistMutations.mockReturnValue({
    pending: false,
    error: null,
    resetErrors: vi.fn(),
    visibility: { mutate: vi.fn() },
    update: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null },
    removeTrack: { mutateAsync: vi.fn() },
    reorder: { mutate: vi.fn() },
    remove: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null },
  });
  mocks.usePlaylistEditForm.mockReturnValue({
    visible: false,
    open: vi.fn(),
    close: vi.fn(),
    submit: vi.fn(),
  });
  mocks.usePlaylistOffline.mockReturnValue({
    operation: null,
    failure: null,
    download: vi.fn(),
    remove: vi.fn(),
  });
  mocks.useCreatePlaylist.mockReturnValue({
    visible: false,
    open: vi.fn(),
    close: vi.fn(),
  });
  mocks.useArtistFollow.mockReturnValue({
    state: queryResult({ data: { '7': false }, isPending: false, isFetching: false, fetchStatus: 'idle' }),
    following: false,
    updating: false,
    toggle: vi.fn(),
  });
  mocks.useArtistSongSearch.mockReturnValue({
    input: '',
    setInput: vi.fn(),
    query: '',
    active: false,
    enabled: false,
    results: [],
    search: queryResult({ isPending: false, isFetching: false, fetchStatus: 'idle' }),
  });
  mocks.findCachedAlbumSummary.mockReturnValue(null);
  mocks.findCachedArtistSummary.mockReturnValue(null);
  mocks.findCachedGenre.mockReturnValue(null);
  mocks.findCachedPlaylistSummary.mockReturnValue(null);
  mocks.playTracks.mockResolvedValue(undefined);
  mocks.playTrackRow.mockResolvedValue('started-context');
  mocks.toggleShuffle.mockResolvedValue(true);
});

describe('LibraryScreen & PlaylistScreen modernization', () => {
  it('seeds PlaylistScreen hero immediately from cacheSeed instead of a blank page skeleton', () => {
    const seeded: PlaylistSummary = {
      id: 42,
      name: 'Late Night',
      description: 'Cached vibes',
      cover_url: '/covers/42.jpg',
      is_public: true,
      track_count: 4,
      owner_name: 'Logge',
    };
    mocks.findCachedPlaylistSummary.mockReturnValue(seeded);
    mocks.useQuery
      .mockReturnValueOnce(queryResult({ isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(queryResult());

    const tree = PlaylistScreen({
      kind: 'playlist',
      playlistId: 42,
      name: 'Late Night',
      onDeleted: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    expect(byTestId(tree, 'playlist-screen')).toBeDefined();
    const list = byTestId(tree, 'playlist-list');
    const header = list.props.ListHeaderComponent as React.ReactNode;
    const empty = list.props.ListEmptyComponent as React.ReactElement<{ testID: string }>;
    expect(byTestId(header, 'playlist-title').props.children).toBe('Late Night');
    expect(empty.type).toBe('TrackRowSkeleton');
    expect(empty.props.testID).toBe('playlist-loading');
    expect(queryByTestId(header, 'playlist-empty')).toBeNull();
  });

  it('renders a 16:9 side-by-side TV split and direct D-Pad reorder toggle on PlaylistScreen without double overscan', () => {
    mocks.tvEnv = {
      ...mocks.tvEnv,
      isTv: true,
      contentWidth: 700,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
    };
    const loadedPlaylist = queryResult({
      data: {
        id: 42,
        name: 'Late Night',
        description: null,
        cover_url: null,
        is_public: false,
        is_owner: true,
        owner_name: 'Logge',
        tracks: [{ ...sampleTrack, playlist_entry_id: 9 }],
      },
      isPending: false,
      isFetching: false,
      fetchStatus: 'idle',
    });
    mocks.useQuery
      .mockReturnValueOnce(queryResult({ isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(loadedPlaylist);

    const tree = PlaylistScreen({
      kind: 'playlist',
      playlistId: 42,
      name: 'Late Night',
      onDeleted: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    const screen = byTestId(tree, 'playlist-screen');
    expect(JSON.stringify(screen.props.style)).not.toContain('"paddingTop":27');
    expect(JSON.stringify(screen.props.style)).not.toContain('"paddingRight":48');
    const heroPane = byTestId(tree, 'playlist-tv-hero-pane');
    expect(heroPane.props.contentContainerStyle).toEqual({ paddingBottom: 96 });
    const tracksPane = byTestId(tree, 'playlist-tv-tracks-pane');
    expect(byTestId(tracksPane, 'playlist-list').props.removeClippedSubviews).toBe(false);
    expect(byTestId(heroPane, 'playlist-tv-reorder')).toBeDefined();
    expect(byTestId(heroPane, 'playlist-play-all').props.hasTVPreferredFocus).toBe(true);
    expect(mocks.useTvFocusReturn).toHaveBeenLastCalledWith({
      scope: 'playlist',
      active: true,
      enabled: true,
    });

    // Unfocused PlaylistScreen must not steal Android Back or TV preferred focus.
    resetState([null, null, true, false]);
    mocks.isFocused = false;
    mocks.useQuery
      .mockReturnValueOnce(queryResult({ isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(loadedPlaylist);
    const unfocused = PlaylistScreen({
      kind: 'playlist',
      playlistId: 42,
      name: 'Late Night',
      onDeleted: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    expect(mocks.useBackHandler).toHaveBeenLastCalledWith(false, expect.any(Function));
    expect(byTestId(byTestId(unfocused, 'playlist-tv-hero-pane'), 'playlist-play-all').props.hasTVPreferredFocus)
      .toBeUndefined();
    expect(mocks.useTvFocusReturn).toHaveBeenLastCalledWith({
      scope: 'playlist',
      active: false,
      enabled: true,
    });
  });

  it('keeps PlaylistQueryGate loud on offline/error and wires BackHandler + RefreshControl hygiene + playTrackRow', () => {
    // 1. Offline/hard-error still blocks loudly even with a cache seed.
    mocks.findCachedPlaylistSummary.mockReturnValue({
      id: 42,
      name: 'Late Night',
      description: null,
      cover_url: null,
      is_public: false,
      track_count: 1,
      owner_name: null,
    });
    mocks.useQuery
      .mockReturnValueOnce(queryResult({ isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(queryResult({ isPending: false, isFetching: false, fetchStatus: 'idle', error: new Error('500') }));

    const errored = PlaylistScreen({
      kind: 'playlist',
      playlistId: 42,
      name: 'Late Night',
      onDeleted: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    expect(byTestId(errored, 'playlist-error')).toBeDefined();

    // 2. Loaded playlist: background refetch does NOT drop RefreshControl; Back exits reorder; row tap uses playTrackRow.
    resetState([null, null, true, false]); // runtimeError, sheet, reordering=true, manualRefreshing=false
    mocks.useQuery
      .mockReturnValueOnce(queryResult({ isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(queryResult({
        data: {
          id: 42,
          name: 'Late Night',
          description: null,
          cover_url: null,
          is_public: false,
          is_owner: true,
          owner_name: 'Logge',
          tracks: [{ ...sampleTrack, playlist_entry_id: 9 }],
        },
        isPending: false,
        isFetching: true,
        fetchStatus: 'fetching',
      }));

    const loaded = PlaylistScreen({
      kind: 'playlist',
      playlistId: 42,
      name: 'Late Night',
      onDeleted: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    const list = byTestId(loaded, 'playlist-list');
    expect(list.props.refreshing).toBe(false);
    expect(list.props.initialNumToRender).toBe(12);
    expect(list.props.removeClippedSubviews).toBe(false);

    // Back handler is enabled while reordering and resets reordering to false.
    expect(mocks.useBackHandler).toHaveBeenLastCalledWith(true, expect.any(Function));
    const backFn = mocks.useBackHandler.mock.calls.at(-1)?.[1] as () => boolean;
    expect(backFn()).toBe(true);
    expect(mocks.stateSetters[2]).toHaveBeenCalledWith(false);

    // Row play delegates to playTrackRow.
    const row = (list.props.renderItem as (info: { item: Track; index: number }) => React.ReactElement)({
      item: sampleTrack,
      index: 0,
    });
    (row.props as { onPlay: () => void }).onPlay();
    expect(mocks.playTrackRow).toHaveBeenCalledOnce();
  });

  it('wires Android Back to reset Library filter and isolates RefreshControl from background Like refetches', () => {
    resetState(['liked', null, false, null]); // filter='liked', runtimeError, manualRefreshing=false, recentPlaybackIndex
    const fetchingLikes = queryResult({
      data: [sampleTrack],
      isPending: false,
      isFetching: true,
      fetchStatus: 'fetching',
    });
    const settled = queryResult({ data: [], isPending: false, isFetching: false, fetchStatus: 'idle' });
    mocks.useQuery
      .mockReturnValueOnce(settled)
      .mockReturnValueOnce(fetchingLikes)
      .mockReturnValueOnce(queryResult({ data: { recent: [] }, isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(settled);

    const tree = LibraryScreen({
      onOpenPlaylist: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    // Background likes refetch must NOT activate RefreshControl.
    const list = (tree.props.children as React.ReactElement<{ children: React.ReactElement[] }>).props.children[0];
    expect((list.props as { refreshing: boolean }).refreshing).toBe(false);

    // Android Back resets filter !== 'all' back to 'all' while focused.
    expect(mocks.useBackHandler).toHaveBeenLastCalledWith(true, expect.any(Function));
    const backFn = mocks.useBackHandler.mock.calls.at(-1)?.[1] as () => boolean;
    expect(backFn()).toBe(true);
    expect(mocks.stateSetters[0]).toHaveBeenCalledWith('all');

    // Unfocused LibraryScreen stays mounted across tabs and must NOT hijack Android Back.
    resetState(['liked', null, false, null]);
    mocks.isFocused = false;
    mocks.useQuery
      .mockReturnValueOnce(settled)
      .mockReturnValueOnce(fetchingLikes)
      .mockReturnValueOnce(queryResult({ data: { recent: [] }, isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(settled);
    LibraryScreen({
      onOpenPlaylist: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    expect(mocks.useBackHandler).toHaveBeenLastCalledWith(false, expect.any(Function));
    expect(mocks.useTvFocusReturn).toHaveBeenLastCalledWith({
      scope: 'library',
      active: false,
      enabled: false,
    });

    // TV Library caps horizontal playlist/artist cards at 2 columns so titles stay readable at 10 feet.
    resetState(['all', null, false, null]);
    mocks.isFocused = true;
    mocks.tvEnv = { ...mocks.tvEnv, isTv: true, contentWidth: 652, gridColumns: 3 };
    mocks.useQuery
      .mockReturnValueOnce(settled)
      .mockReturnValueOnce(fetchingLikes)
      .mockReturnValueOnce(queryResult({ data: { recent: [] }, isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(settled);
    const tvLibrary = LibraryScreen({
      onOpenPlaylist: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    const tvList = (tvLibrary.props.children as React.ReactElement<{ children: React.ReactElement[] }>).props.children[0];
    expect((tvList.props as { gridColumns: number }).gridColumns).toBe(2);
  });
});

describe('Album, Artist, Genre, and Discover modernization', () => {
  it('seeds AlbumScreen hero instantly from cacheSeed and exposes Shuffle + playTrackRow when loaded', () => {
    const cachedAlbum: AlbumSummary = {
      id: '55',
      title: 'Horizon',
      artist: 'Solstice',
      cover: 'https://img.example.test/h.jpg',
      release_date: '2026-01-01',
    };
    mocks.findCachedAlbumSummary.mockReturnValue(cachedAlbum);
    mocks.useQuery.mockReturnValueOnce(queryResult());

    const loadingTree = AlbumScreen({
      albumId: '55',
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    const loadingPage = loadingTree.props.children as React.ReactElement<Record<string, unknown>>;
    expect(loadingPage.type).toBe('CatalogCollectionPage');
    expect(byTestId(loadingPage.props.hero as React.ReactNode, 'album-title').props.children).toBe('Horizon');
    expect((loadingPage.props.empty as React.ReactElement<{ testID: string }>).props.testID).toBe('album-loading');

    // Loaded album exposes shuffle and uses playTrackRow on track row taps.
    resetState();
    const detail: AlbumDetail = {
      id: '55',
      title: 'Horizon',
      artist: 'Solstice',
      artist_id: '7',
      cover: 'https://img.example.test/h.jpg',
      release_date: '2026-01-01',
      nb_tracks: 1,
      tracks: [sampleTrack],
    };
    mocks.useQuery.mockReturnValueOnce(queryResult({
      data: detail,
      isPending: false,
      isFetching: false,
      fetchStatus: 'idle',
    }));

    const loadedTree = AlbumScreen({
      albumId: '55',
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    const loadedPage = loadedTree.props.children as React.ReactElement<Record<string, unknown>>;
    expect(loadedPage.props.bottomInset).toBe(96);
    const shuffleBtn = byTestId(loadedPage.props.hero as React.ReactNode, 'album-shuffle');
    (shuffleBtn.props.onPress as () => void)();
    expect(mocks.playTracks).toHaveBeenCalledOnce();

    // Artist link FocusRingOverlay controller stays stable across re-renders.
    const firstArtistLink = byTestId(loadedPage.props.hero as React.ReactNode, 'album-artist-7');
    const firstController = (firstArtistLink.props.children as React.ReactElement<{ controller: unknown }>[])[1].props.controller;
    mocks.stateSlot = 0;
    mocks.useQuery.mockReturnValueOnce(queryResult({
      data: detail,
      isPending: false,
      isFetching: false,
      fetchStatus: 'idle',
    }));
    const rerendered = AlbumScreen({
      albumId: '55',
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    const secondPage = rerendered.props.children as React.ReactElement<Record<string, unknown>>;
    const secondArtistLink = byTestId(secondPage.props.hero as React.ReactNode, 'album-artist-7');
    const secondController = (secondArtistLink.props.children as React.ReactElement<{ controller: unknown }>[])[1].props.controller;
    expect(secondController).toBe(firstController);

    const row = (loadedPage.props.renderTrack as (t: Track, idx: number) => React.ReactElement)(
      sampleTrack,
      0,
    );
    (row.props as { onPress: () => void }).onPress();
    expect(mocks.playTrackRow).toHaveBeenCalledOnce();
  });

  it('seeds ArtistScreen hero instantly from cacheSeed and renders TV side-by-side layout when loaded', () => {
    const cachedArtist: ArtistSummary = {
      id: '7',
      name: 'Solstice',
      picture: 'https://img.example.test/artist.jpg',
    };
    mocks.findCachedArtistSummary.mockReturnValue(cachedArtist);
    mocks.useQuery
      .mockReturnValueOnce(queryResult())
      .mockReturnValueOnce(queryResult({ isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(queryResult({ data: [], isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(queryResult({ isPending: false, isFetching: false, fetchStatus: 'idle' }));

    const loadingTree = ArtistScreen({
      artistId: '7',
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    expect(byTestId(loadingTree, 'artist-title').props.children).toBe('Solstice');
    expect(byTestId(loadingTree, 'artist-loading').type).toBe('TrackRowSkeleton');

    // TV split pane when loaded — uses bottomInset and avoids double TV overscan.
    resetState();
    mocks.tvEnv = {
      ...mocks.tvEnv,
      isTv: true,
      contentWidth: 700,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
    };
    const detail: ArtistDetail = {
      id: '7',
      name: 'Solstice',
      picture: 'https://img.example.test/artist.jpg',
      fans: 500,
      albums_count: 2,
      top: [sampleTrack],
      albums: [],
      related: [],
    };
    mocks.useQuery
      .mockReturnValueOnce(queryResult({ data: detail, isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(queryResult({ isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(queryResult({ data: [], isPending: false, isFetching: false, fetchStatus: 'idle' }))
      .mockReturnValueOnce(queryResult({ data: {}, isPending: false, isFetching: false, fetchStatus: 'idle' }));

    const tvTree = ArtistScreen({
      artistId: '7',
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    const artistScreen = byTestId(tvTree, 'artist-screen');
    expect(JSON.stringify(artistScreen.props.style)).not.toContain('"paddingTop":27');
    expect(byTestId(tvTree, 'artist-tv-hero-pane').props.contentContainerStyle).toEqual({ paddingBottom: 96 });
    const tracksPane = byTestId(tvTree, 'artist-tv-tracks-pane');
    expect((tracksPane.props.children as React.ReactElement<Record<string, unknown>>).props.contentPaddingBottom)
      .toBeUndefined();
    expect(byTestId(tvTree, 'artist-shuffle')).toBeDefined();
  });

  it('seeds GenreScreen compact hero instantly from cacheSeed and preserves bottomInset on TV', () => {
    const cachedGenre: Genre = {
      id: '132',
      name: 'Pop',
      picture: 'https://img.example.test/pop.jpg',
    };
    mocks.findCachedGenre.mockReturnValue(cachedGenre);
    mocks.useQuery.mockReturnValueOnce(queryResult());

    const tree = GenreScreen({
      genreId: '132',
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    const list = byTestId(tree, 'genre-screen').props.children as React.ReactElement<Record<string, unknown>>;
    expect(byTestId(list.props.header as React.ReactNode, 'genre-title').props.children).toBe('Pop');
    expect((list.props.empty as React.ReactElement<{ testID: string }>).props.testID).toBe('genre-loading');

    // TV split uses bottomInset and delegates CatalogTrackList inset to useBottomInset.
    resetState();
    mocks.tvEnv = {
      ...mocks.tvEnv,
      isTv: true,
      contentWidth: 700,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
    };
    mocks.useQuery.mockReturnValueOnce(queryResult());
    const tvTree = GenreScreen({
      genreId: '132',
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    expect(JSON.stringify(byTestId(tvTree, 'genre-screen').props.style)).not.toContain('"paddingTop":27');
    expect(byTestId(tvTree, 'genre-tv-hero-pane').props.contentContainerStyle).toEqual({ paddingBottom: 96 });
    const tvTracksPane = byTestId(tvTree, 'genre-tv-tracks-pane');
    expect((tvTracksPane.props.children as React.ReactElement<Record<string, unknown>>).props.contentPaddingBottom)
      .toBeUndefined();
  });

  it('respects useReducedMotion on DiscoverScreen jumpToSection', () => {
    mocks.reducedMotion = true;
    const settledList = queryResult({ data: [], isPending: false, isFetching: false, fetchStatus: 'idle' });
    mocks.useQuery
      .mockReturnValueOnce(settledList)
      .mockReturnValueOnce(settledList)
      .mockReturnValueOnce(settledList)
      .mockReturnValueOnce(settledList)
      .mockReturnValueOnce(settledList);

    const tree = DiscoverScreen({
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
      onOpenGenre: vi.fn(),
      onOpenPlaylist: vi.fn(),
    });
    const chartsSection = byTestId(tree, 'catalog-section-charts');
    (chartsSection.props.onLayout as (e: { nativeEvent: { layout: { y: number } } }) => void)({
      nativeEvent: { layout: { y: 240 } },
    });
    const jumpChip = byTestId(tree, 'discover-jump-charts');
    (jumpChip.props.onPress as () => void)();
    expect(mocks.scrollRef.current.scrollTo).toHaveBeenCalledWith({
      y: expect.any(Number),
      animated: false,
    });
  });

  it('gates PartyScreen BackHandler on isFocused and applies bottomInset without double overscan on PartyScreen and RadioScreen TV layouts', () => {
    mocks.tvEnv = {
      ...mocks.tvEnv,
      isTv: true,
      contentWidth: 700,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
    };
    resetState([{ query: 'daft', results: [], loading: false, error: null }, null, null, null, false, false]);
    mocks.isFocused = false;
    const partyTree = PartyScreen({ code: 'ABCD', onClose: vi.fn() });
    expect(mocks.useBackHandler).toHaveBeenLastCalledWith(false, expect.any(Function));
    expect(mocks.useTvFocusReturn).toHaveBeenLastCalledWith({
      scope: 'party',
      active: false,
      enabled: true,
    });
    expect(JSON.stringify(byTestId(partyTree, 'party-screen').props.style)).not.toContain('"paddingTop":27');
    expect(byTestId(partyTree, 'party-tv-left-pane').props.contentContainerStyle).toEqual({ paddingBottom: 96 });
    expect(byTestId(partyTree, 'party-tv-queue-pane').props.contentContainerStyle).toEqual({ paddingBottom: 96 });

    resetState();
    mocks.isFocused = true;
    const radioTree = RadioScreen();
    expect(mocks.useTvFocusReturn).toHaveBeenLastCalledWith({
      scope: 'radio',
      active: true,
      enabled: true,
    });
    const radioScroll = byTestId(radioTree, 'radio-scroll');
    expect(JSON.stringify(radioScroll.props.contentContainerStyle)).not.toContain('"paddingTop":27');
    expect(radioScroll.props.contentContainerStyle).toEqual([
      expect.any(Object),
      { gap: 28, paddingBottom: 96 },
    ]);
  });
});
