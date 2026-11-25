import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import { strings } from '../localization';
import TrackActionsHost from './TrackActionsHost';
import type { TrackActionRequest } from './trackActions';

const mocks = vi.hoisted(() => ({
  request: null as TrackActionRequest | null,
  user: { id: 7 } as { id: number } | null,
  isTv: false,
  addPending: false,
  createPending: false,
  dismissTrackActions: vi.fn(),
  pushCheckpoint: vi.fn(),
  popAndRestore: vi.fn(),
  openTrackAlbum: vi.fn(() => 'opened'),
  openTrackArtist: vi.fn(() => 'opened'),
  stateSlots: [] as unknown[],
  refSlots: [] as { current: unknown }[],
  stateCursor: 0,
  refCursor: 0,
  effects: [] as (() => void | (() => void))[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: <T,>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] => {
      const index = mocks.stateCursor++;
      if (!(index in mocks.stateSlots)) {
        mocks.stateSlots[index] = typeof initial === 'function'
          ? (initial as () => T)()
          : initial;
      }
      const setter = (next: T | ((prev: T) => T)) => {
        mocks.stateSlots[index] = typeof next === 'function'
          ? (next as (prev: T) => T)(mocks.stateSlots[index] as T)
          : next;
      };
      return [mocks.stateSlots[index] as T, setter];
    },
    useRef: <T,>(initial: T) => {
      const index = mocks.refCursor++;
      if (!(index in mocks.refSlots)) {
        mocks.refSlots[index] = { current: initial };
      }
      return mocks.refSlots[index] as { current: T };
    },
    useEffect: (effect: () => void | (() => void)) => {
      mocks.effects.push(effect);
    },
    useSyncExternalStore: () => mocks.request,
  };
});

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useQuery: () => ({
    data: [
      {
        id: 10,
        name: 'Roadtrip',
        description: null,
        cover_url: null,
        is_public: false,
        track_count: 5,
        owner_id: 7,
        owner_name: 'Logge',
        owner_avatar_url: null,
        is_collaborative: false,
        is_owner: true,
        is_collaborator: false,
        can_edit_tracks: true,
        collaborator_count: 0,
      },
      {
        id: 11,
        name: 'WG-Küche',
        description: null,
        cover_url: null,
        is_public: false,
        track_count: 3,
        owner_id: 2,
        owner_name: 'Jule',
        owner_avatar_url: null,
        is_collaborative: true,
        is_owner: false,
        is_collaborator: true,
        can_edit_tracks: true,
        collaborator_count: 2,
      },
      {
        id: 12,
        name: 'Paused Shared',
        description: null,
        cover_url: null,
        is_public: false,
        track_count: 4,
        owner_id: 3,
        owner_name: 'Tariq',
        owner_avatar_url: null,
        is_collaborative: false,
        is_owner: false,
        is_collaborator: true,
        can_edit_tracks: false,
        collaborator_count: 1,
      },
    ],
    isPending: false,
    isFetching: false,
    isStale: false,
    fetchStatus: 'idle',
    error: null,
    refetch: vi.fn(),
  }),
  useMutation: (options: { mutationKey?: readonly unknown[] }) => ({
    isPending: options.mutationKey?.[4] === 'create-with-track'
      ? mocks.createPending
      : mocks.addPending,
    variables: undefined,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../config', () => ({ getCurrentApiBase: () => 'https://music.example.test' }));
vi.mock('../data', () => ({
  createPlaylistWithTrack: vi.fn(),
  invalidatePlaylistCaches: vi.fn(),
  musicCacheScope: (_origin: string, userId: number) => `account-${userId}`,
  musicMutations: { addToPlaylist: () => ({ mutationKey: ['add-to-playlist'] }) },
  musicQueries: { playlists: () => ({ queryKey: ['playlists'] }) },
  musicRepository: { addToPlaylist: vi.fn(async () => undefined) },
  optimisticallyAddPlaylistTrack: vi.fn(),
  queryKeys: { playlists: { detail: (scope: string, id: number) => ['music', scope, 'playlists', id] } },
  refreshLibraryAutoBrowse: vi.fn(),
  restorePlaylistCache: vi.fn(),
}));
vi.mock('../localization/LocaleProvider', () => ({ useLocaleRevision: () => 0 }));
vi.mock('../navigation', () => ({
  openTrackAlbum: mocks.openTrackAlbum,
  openTrackArtist: mocks.openTrackArtist,
}));
vi.mock('../offline/hooks', () => ({
  useOfflineDownloads: () => ({ hydrated: true, scope: 'account-7', manifest: null }),
}));
vi.mock('../offline/runtime', () => ({
  downloadTrackForOffline: vi.fn(),
  removeOfflineTrack: vi.fn(),
}));
vi.mock('../player/browseTree', () => ({
  refreshBrowseTree: vi.fn(),
  refreshOfflineBrowseTree: vi.fn(),
}));
vi.mock('../player/notices', () => ({ reportPlayerNotice: vi.fn() }));
vi.mock('../tv', () => ({
  isTvMode: () => mocks.isTv,
  tvFocusRegistry: {
    pushCheckpoint: mocks.pushCheckpoint,
    popAndRestore: mocks.popAndRestore,
  },
}));
vi.mock('./TrackActionSheetParts', () => ({
  TrackActionRow: 'TrackActionRow',
  TrackActionsCreateForm: 'TrackActionsCreateForm',
  TrackActionsHeader: 'TrackActionsHeader',
  TrackActionsPlaylistCommitBar: 'TrackActionsPlaylistCommitBar',
  TrackActionsPlaylistFilter: 'TrackActionsPlaylistFilter',
  TrackActionsPlaylistRow: 'TrackActionsPlaylistRow',
  useKeyboardHeight: () => 0,
}));
vi.mock('./ui', () => ({
  AppText: 'AppText',
  BottomSheet: 'BottomSheet',
  ListSeparator: 'ListSeparator',
}));
vi.mock('./TrackActionsPlaylistPicker', () => ({
  TrackActionsPlaylistPicker: 'TrackActionsPlaylistPicker',
}));
vi.mock('./trackActions', () => ({
  dismissTrackActions: mocks.dismissTrackActions,
  getTrackActionRequest: () => mocks.request,
  runAuthorizedTrackRemoval: vi.fn(),
  runTrackQueueAction: vi.fn(),
  subscribeTrackActions: () => () => undefined,
  trackActionIdsForRequest: () => [
    'play-next',
    'add-to-queue',
    'start-radio',
    'add-to-playlist',
    'download',
    'open-album',
    'open-artist',
  ],
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> | null {
  return elements(node).find((element) => element.props.testID === testID) ?? null;
}

function renderHost() {
  mocks.stateCursor = 0;
  mocks.refCursor = 0;
  mocks.effects = [];
  const tree = TrackActionsHost();
  const pendingEffects = mocks.effects;
  pendingEffects.forEach((effect) => {
    effect();
  });
  return tree;
}

const track: Track = {
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

describe('TrackActionsHost', () => {
  beforeEach(() => {
    mocks.request = {
      requestId: 1,
      track,
      onError: vi.fn(),
    };
    mocks.user = { id: 7 };
    mocks.isTv = false;
    mocks.addPending = false;
    mocks.createPending = false;
    mocks.stateSlots = [];
    mocks.refSlots = [];
    mocks.dismissTrackActions.mockClear();
    mocks.pushCheckpoint.mockClear();
    mocks.popAndRestore.mockClear();
    mocks.openTrackAlbum.mockClear();
    mocks.openTrackArtist.mockClear();
  });

  it('wires BottomSheet onBack so Android Back steps create -> playlists -> actions -> close', () => {
    // 1. Starts on actions mode.
    const actionsTree = renderHost();
    expect(byTestId(actionsTree, 'track-actions-list')).not.toBeNull();

    // Enter playlists mode.
    (byTestId(actionsTree, 'track-action-add-playlist')?.props.onPress as () => void)();
    const playlistsTree = renderHost();
    expect(byTestId(playlistsTree, 'track-action-new-playlist')).not.toBeNull();

    // Enter create mode.
    (byTestId(playlistsTree, 'track-action-new-playlist')?.props.onPress as () => void)();
    const createTree = renderHost();
    expect(elements(createTree).some((el) => el.type === 'TrackActionsCreateForm')).toBe(true);

    // Back #1: create -> playlists (must NOT close sheet!)
    (createTree.props.onBack as () => void)();
    expect(mocks.dismissTrackActions).not.toHaveBeenCalled();
    const backToPlaylists = renderHost();
    expect(byTestId(backToPlaylists, 'track-action-new-playlist')).not.toBeNull();

    // Back #2: playlists -> actions (must NOT close sheet!)
    (backToPlaylists.props.onBack as () => void)();
    expect(mocks.dismissTrackActions).not.toHaveBeenCalled();
    const backToActions = renderHost();
    expect(byTestId(backToActions, 'track-actions-list')).not.toBeNull();

    // Back #3: actions -> closes the sheet!
    (backToActions.props.onBack as () => void)();
    expect(mocks.dismissTrackActions).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('blocks Back while a playlist mutation is pending', () => {
    mocks.createPending = true;
    const tree = renderHost();
    (tree.props.onBack as () => void)();
    expect(mocks.dismissTrackActions).not.toHaveBeenCalled();
  });

  it('pushes and restores TV focus checkpoints and enables preferred focus ONLY in TV mode', () => {
    // Phone mode: no hasTVPreferredFocus, no TV checkpoint calls.
    const phoneTree = renderHost();
    expect(byTestId(phoneTree, 'track-action-play-next')?.props.hasTVPreferredFocus).toBeUndefined();
    expect(mocks.pushCheckpoint).not.toHaveBeenCalled();

    // Reset state & switch to TV mode.
    mocks.stateSlots = [];
    mocks.refSlots = [];
    mocks.isTv = true;
    const tvTree = renderHost();
    expect(byTestId(tvTree, 'track-action-play-next')?.props.hasTVPreferredFocus).toBe(true);
    expect(byTestId(tvTree, 'track-action-add-queue')?.props.hasTVPreferredFocus).toBeUndefined();
    expect(mocks.pushCheckpoint).toHaveBeenCalledExactlyOnceWith('track-actions');

    // Dismissing restores focus checkpoint.
    mocks.request = null;
    renderHost();
    expect(mocks.popAndRestore).toHaveBeenCalledOnce();
  });

  it('shows owned and active collaborative playlists while excluding paused non-editable playlists', () => {
    const actionsTree = renderHost();
    (byTestId(actionsTree, 'track-action-add-playlist')?.props.onPress as () => void)();
    const playlistsTree = renderHost();

    expect(byTestId(playlistsTree, 'track-action-playlist-10')?.props).toMatchObject({
      name: 'Roadtrip',
      detail: strings.trackActions.playlistTrackCount(5),
      collaborative: false,
    });
    expect(byTestId(playlistsTree, 'track-action-playlist-11')?.props).toMatchObject({
      name: 'WG-Küche',
      detail: strings.trackActions.playlistSharedTrackCount('Jule', 3),
      collaborative: true,
    });
    expect(byTestId(playlistsTree, 'track-action-playlist-12')).toBeNull();
  });

  it('filters playlists and supports multi-playlist selection commit', () => {
    const actionsTree = renderHost();
    (byTestId(actionsTree, 'track-action-add-playlist')?.props.onPress as () => void)();
    const playlistsTree = renderHost();

    // Filter down to Roadtrip only.
    const filterEl = elements(playlistsTree).find((el) => el.type === 'TrackActionsPlaylistFilter');
    expect(filterEl).toBeDefined();
    (filterEl?.props.onChangeText as (v: string) => void)('road');
    const filteredTree = renderHost();
    expect(byTestId(filteredTree, 'track-action-playlist-10')).not.toBeNull();
    expect(byTestId(filteredTree, 'track-action-playlist-11')).toBeNull();

    // Clear filter and select both editable playlists.
    (elements(filteredTree).find((el) => el.type === 'TrackActionsPlaylistFilter')?.props.onChangeText as (v: string) => void)('');
    const unfilteredTree = renderHost();
    (byTestId(unfilteredTree, 'track-action-playlist-10')?.props.onToggleSelect as () => void)();
    const oneSelected = renderHost();
    (byTestId(oneSelected, 'track-action-playlist-11')?.props.onToggleSelect as () => void)();
    const twoSelected = renderHost();

    const commitBar = elements(twoSelected).find((el) => el.type === 'TrackActionsPlaylistCommitBar');
    expect(commitBar?.props.count).toBe(2);
  });
});
