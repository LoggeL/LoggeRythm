import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import { byTestId as byTestID } from '../test/render';
import {
  offlineControlCopy,
  PlaylistTrackRow,
  refreshOfflineAutoBrowse,
} from './PlaylistScreen';
import { libraryStrings } from './libraryStrings';

const mocks = vi.hoisted(() => ({
  refreshBrowseTree: vi.fn(async () => undefined),
  refreshOfflineBrowseTree: vi.fn(async () => undefined),
  refreshLibraryAutoBrowse: vi.fn(async (
    refresh: () => Promise<void>,
  ) => refresh()),
}));

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  FlatList: 'FlatList',
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T): T => styles,
    hairlineWidth: 1,
  },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('../components/AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  BottomSheet: 'BottomSheet',
  PressableScale: 'PressableScale',
  Skeleton: 'Skeleton',
}));
vi.mock('../hooks/useBottomInset', () => ({ useBottomInset: () => 96 }));

vi.mock('../components/track/StandardTrackRow', () => ({
  default: 'StandardTrackRow',
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../components/trackActions', () => ({ showTrackActions: vi.fn() }));
vi.mock('../data', () => ({
  invalidatePlaylistCaches: vi.fn(),
  musicCacheScope: vi.fn(),
  musicMutations: {},
  musicQueries: {},
  optimisticallyRemovePlaylistTrack: vi.fn(),
  optimisticallyReorderPlaylistTracks: vi.fn(),
  optimisticallySetPlaylistVisibility: vi.fn(),
  optimisticallyUpdatePlaylist: vi.fn(),
  refreshLibraryAutoBrowse: mocks.refreshLibraryAutoBrowse,
  removeDeletedPlaylistFromCache: vi.fn(),
  restorePlaylistCache: vi.fn(),
}));
vi.mock('../player/browseTree', () => ({
  refreshBrowseTree: mocks.refreshBrowseTree,
  refreshOfflineBrowseTree: mocks.refreshOfflineBrowseTree,
}));
vi.mock('../player/controller', () => ({ playTracks: vi.fn(), toggleShuffle: vi.fn() }));
vi.mock('../player/notices', () => ({ reportPlayerNotice: vi.fn() }));
vi.mock('../offline/hooks', () => ({ useOfflineDownloads: vi.fn() }));
vi.mock('../offline/runtime', () => ({
  downloadPlaylistForOffline: vi.fn(),
  removeOfflinePlaylist: vi.fn(),
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function propsOf(node: React.ReactNode): ElementProps {
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    throw new Error('Expected a React element');
  }
  return (node as React.ReactElement<ElementProps>).props;
}


const track: Track = {
  id: '42',
  title: 'Duplicate-safe row',
  artist: 'Primary',
  artist_id: '7',
  artists: [
    { id: '7', name: 'Primary' },
    { id: '8', name: 'Guest' },
  ],
  album: 'Parity',
  album_id: '9',
  cover: 'cover.jpg',
  duration_sec: 185,
  preview_url: null,
  rank: 0,
  release_date: '',
};

const occurrence = {
  queueContext: { type: 'playlist' as const, id: '11' },
  originalContextOrder: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlaylistTrackRow', () => {
  it('delegates identity, duration, state/cache, and exact occurrence to StandardTrackRow', () => {
    const onPlay = vi.fn();
    const onOpenActions = vi.fn();
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const row = PlaylistTrackRow({
      track,
      index: 2,
      count: 4,
      occurrence,
      canEdit: false,
      controlsDisabled: false,
      onPlay,
      onOpenActions,
      onOpenAlbum,
      onOpenArtist,
      onMove: vi.fn(),
      onRemove: vi.fn(),
    });
    const props = propsOf(row);

    expect(props).toMatchObject({
      track,
      testID: 'playlist-track-42-2',
      occurrence,
      position: 3,
      onPlay,
      onActions: onOpenActions,
      onOpenAlbum,
      onOpenArtist,
    });
    expect(props.showDuration).toBeUndefined();
    expect(props.showAlbumLabel).toBeUndefined();
    expect(props.trailingControls).toBeUndefined();
  });

  it('keeps owner mutation controls in the shared row trailing-control slot', () => {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    const row = PlaylistTrackRow({
      track,
      index: 2,
      count: 4,
      occurrence,
      canEdit: true,
      controlsDisabled: false,
      onPlay: vi.fn(),
      onOpenActions: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
      onMove,
      onRemove,
    });
    const controls = propsOf(row).trailingControls as React.ReactNode;
    const up = byTestID(controls, 'playlist-track-42-2-up');
    const down = byTestID(controls, 'playlist-track-42-2-down');
    const remove = byTestID(controls, 'playlist-track-42-2-remove');

    (up.props.onPress as () => void)();
    (down.props.onPress as () => void)();
    (remove.props.onPress as () => void)();
    expect(onMove).toHaveBeenNthCalledWith(1, 'up');
    expect(onMove).toHaveBeenNthCalledWith(2, 'down');
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('preserves boundary and mutation disabling without changing source index', () => {
    const row = PlaylistTrackRow({
      track,
      index: 0,
      count: 2,
      occurrence: { ...occurrence, originalContextOrder: 0 },
      canEdit: true,
      controlsDisabled: true,
      onPlay: vi.fn(),
      onOpenActions: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
      onMove: vi.fn(),
      onRemove: vi.fn(),
    });
    const controls = propsOf(row).trailingControls as React.ReactNode;

    expect(byTestID(controls, 'playlist-track-42-0-up').props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true },
    });
    expect(byTestID(controls, 'playlist-track-42-0-down').props.disabled).toBe(true);
    expect(byTestID(controls, 'playlist-track-42-0-remove').props.disabled).toBe(true);
    expect(propsOf(row).occurrence).toEqual({
      ...occurrence,
      originalContextOrder: 0,
    });
  });
});

describe('Playlist offline orchestration', () => {
  it('refreshes only verified local Android Auto browse state after a commit', async () => {
    await refreshOfflineAutoBrowse();

    expect(mocks.refreshLibraryAutoBrowse).toHaveBeenCalledWith(
      mocks.refreshOfflineBrowseTree,
      expect.any(Function),
    );
    expect(mocks.refreshOfflineBrowseTree).toHaveBeenCalledOnce();
    expect(mocks.refreshBrowseTree).not.toHaveBeenCalled();
  });

  it('uses failure-specific localized control errors', () => {
    const progress = {
      completedTracks: 2,
      totalTracks: 4,
      failedTracks: 2,
      percent: 50,
    };

    expect(offlineControlCopy('download').error(progress))
      .toBe(libraryStrings.playlist.offlineError(2));
    expect(offlineControlCopy('remove').error(progress))
      .toBe(libraryStrings.playlist.offlineRemoveError);
  });
});
