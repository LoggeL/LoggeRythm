import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/error';
import type { PlaylistInvitePreview } from '../api/types';
import { byTestId, queryByTestId, textContent } from '../test/render';
import { libraryStrings } from './libraryStrings';
import PlaylistInviteScreen, {
  InvalidPlaylistInviteLink,
  playlistInviteErrorPresentation,
  playlistInviteJoinErrorMessage,
} from './PlaylistInviteScreen';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
  refetch: vi.fn(async () => undefined),
  mutate: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
  useMutation: mocks.useMutation,
  useQueryClient: mocks.useQueryClient,
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../config', () => ({ getCurrentApiBase: () => 'https://loggerythm.logge.top' }));
vi.mock('../components/AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../components/library/autoBrowse', () => ({
  refreshAutoBrowse: vi.fn(async () => undefined),
}));
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  Artwork: 'Artwork',
}));
vi.mock('../data', () => ({
  invalidatePlaylistCaches: vi.fn(async () => undefined),
  musicCacheScope: (origin: string, id: number) => `${origin}::user:${id}`,
  musicMutations: { acceptPlaylistInvite: () => ({ mutationKey: ['accept'] }) },
  musicQueries: { playlistInvitePreview: () => ({ queryKey: ['preview'] }) },
}));
vi.mock('../hooks/useBottomInset', () => ({ useBottomInset: () => 24 }));
vi.mock('../tv', () => ({
  TvFocusScope: 'TvFocusScope',
  useTvEnvironment: () => ({ isTv: false }),
  useTvFocusReturn: vi.fn(),
}));

const validToken = 'demo-join-token-kellerparty-2026';

const previewFixture: PlaylistInvitePreview = {
  playlist_id: 51,
  name: 'Kellerparty 2026',
  description: 'Bring tracks',
  cover_url: '/api/playlists/51/cover',
  track_count: 14,
  collaborator_count: 3,
  owner: { id: 5, display_name: 'Tariq', avatar_url: null },
  is_owner: false,
  already_collaborator: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ user: { id: 7 } });
  mocks.useQueryClient.mockReturnValue({});
  mocks.useMutation.mockReturnValue({
    isPending: false,
    error: null,
    mutate: mocks.mutate,
    reset: mocks.reset,
  });
});

describe('playlist invite error helpers', () => {
  it('classifies 404, 410, offline, and generic preview failures loudly', () => {
    expect(playlistInviteErrorPresentation(new ApiError(404, '{}', '404'), false)).toEqual({
      message: libraryStrings.playlist.inviteJoin.notFoundMessage,
      retryable: false,
      kind: 'error',
    });
    expect(playlistInviteErrorPresentation(new ApiError(410, '{}', '410'), false)).toEqual({
      message: libraryStrings.playlist.inviteJoin.expiredOrRevokedMessage,
      retryable: false,
      kind: 'error',
    });
    expect(playlistInviteErrorPresentation(null, true)).toEqual({
      message: libraryStrings.common.offline,
      retryable: true,
      kind: 'offline',
    });
    expect(playlistInviteErrorPresentation(new Error('500'), false)).toEqual({
      message: libraryStrings.common.loadFailed,
      retryable: true,
      kind: 'error',
    });
  });

  it('maps join failures for 404, 410, and unexpected errors', () => {
    expect(playlistInviteJoinErrorMessage(new ApiError(404, '{}', '404')))
      .toBe(libraryStrings.playlist.inviteJoin.notFoundMessage);
    expect(playlistInviteJoinErrorMessage(new ApiError(410, '{}', '410')))
      .toBe(libraryStrings.playlist.inviteJoin.expiredOrRevokedMessage);
    expect(playlistInviteJoinErrorMessage(new Error('500')))
      .toBe(libraryStrings.playlist.inviteJoin.joinFailed);
  });
});

describe('InvalidPlaylistInviteLink', () => {
  it('renders an explicit error message and back button', () => {
    const onClose = vi.fn();
    const tree = InvalidPlaylistInviteLink({ onClose });

    expect(byTestId(tree, 'playlist-invite-invalid')).toBeDefined();
    expect(textContent(tree)).toContain(libraryStrings.playlist.inviteJoin.invalidLinkTitle);
    (byTestId(tree, 'playlist-invite-invalid-back').props.onPress as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('PlaylistInviteScreen', () => {
  it('fails loud when called directly with an invalid token or unauthenticated user', () => {
    expect(() => PlaylistInviteScreen({
      token: 'short',
      onOpenPlaylist: vi.fn(),
      onClose: vi.fn(),
    })).toThrow(/valid invite token/);

    mocks.useAuth.mockReturnValue({ user: null });
    expect(() => PlaylistInviteScreen({
      token: validToken,
      onOpenPlaylist: vi.fn(),
      onClose: vi.fn(),
    })).toThrow(/authenticated user/);
  });

  it('shows loading state while fetching the invite preview', () => {
    mocks.useQuery.mockReturnValue({
      data: undefined,
      error: null,
      isPending: true,
      fetchStatus: 'fetching',
      refetch: mocks.refetch,
    });

    const tree = PlaylistInviteScreen({
      token: validToken,
      onOpenPlaylist: vi.fn(),
      onClose: vi.fn(),
    });
    expect(byTestId(tree, 'playlist-invite-loading')).toBeDefined();
  });

  it('shows non-retryable 410 state and retryable network error state', () => {
    const onClose = vi.fn();
    mocks.useQuery.mockReturnValue({
      data: undefined,
      error: new ApiError(410, '{}', '410'),
      isPending: false,
      fetchStatus: 'idle',
      refetch: mocks.refetch,
    });
    const expiredTree = PlaylistInviteScreen({
      token: validToken,
      onOpenPlaylist: vi.fn(),
      onClose,
    });
    expect(byTestId(expiredTree, 'playlist-invite-error')).toBeDefined();
    expect(queryByTestId(expiredTree, 'playlist-invite-retry')).toBeNull();
    (byTestId(expiredTree, 'playlist-invite-error-back').props.onPress as () => void)();
    expect(onClose).toHaveBeenCalledOnce();

    mocks.useQuery.mockReturnValue({
      data: undefined,
      error: new Error('timeout'),
      isPending: false,
      fetchStatus: 'idle',
      refetch: mocks.refetch,
    });
    const retryTree = PlaylistInviteScreen({
      token: validToken,
      onOpenPlaylist: vi.fn(),
      onClose: vi.fn(),
    });
    (byTestId(retryTree, 'playlist-invite-retry').props.onPress as () => void)();
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('renders preview details and triggers accept mutation for a new collaborator', () => {
    mocks.useQuery.mockReturnValue({
      data: previewFixture,
      error: null,
      isPending: false,
      fetchStatus: 'idle',
      refetch: mocks.refetch,
    });

    const tree = PlaylistInviteScreen({
      token: validToken,
      onOpenPlaylist: vi.fn(),
      onClose: vi.fn(),
    });

    expect(textContent(byTestId(tree, 'playlist-invite-title'))).toEqual(['Kellerparty 2026']);
    expect(textContent(byTestId(tree, 'playlist-invite-owner'))).toEqual([
      libraryStrings.playlist.inviteJoin.byOwner('Tariq'),
    ]);
    expect(textContent(byTestId(tree, 'playlist-invite-description'))).toEqual(['Bring tracks']);
    expect(queryByTestId(tree, 'playlist-invite-open')).toBeNull();

    (byTestId(tree, 'playlist-invite-accept').props.onPress as () => void)();
    expect(mocks.reset).toHaveBeenCalledOnce();
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(validToken);
  });

  it('offers direct open CTA when the viewer is already the owner or a collaborator', () => {
    const onOpenPlaylist = vi.fn();
    mocks.useQuery.mockReturnValue({
      data: { ...previewFixture, already_collaborator: true },
      error: null,
      isPending: false,
      fetchStatus: 'idle',
      refetch: mocks.refetch,
    });

    const tree = PlaylistInviteScreen({
      token: validToken,
      onOpenPlaylist,
      onClose: vi.fn(),
    });

    expect(byTestId(tree, 'playlist-invite-member-status')).toBeDefined();
    expect(queryByTestId(tree, 'playlist-invite-accept')).toBeNull();
    (byTestId(tree, 'playlist-invite-open').props.onPress as () => void)();
    expect(onOpenPlaylist).toHaveBeenCalledExactlyOnceWith({
      kind: 'playlist',
      playlistId: 51,
      name: 'Kellerparty 2026',
    });
  });

  it('shows an inline error when accept mutation fails', () => {
    mocks.useQuery.mockReturnValue({
      data: previewFixture,
      error: null,
      isPending: false,
      fetchStatus: 'idle',
      refetch: mocks.refetch,
    });
    mocks.useMutation.mockReturnValue({
      isPending: false,
      error: new ApiError(410, '{}', '410'),
      mutate: mocks.mutate,
      reset: mocks.reset,
    });

    const tree = PlaylistInviteScreen({
      token: validToken,
      onOpenPlaylist: vi.fn(),
      onClose: vi.fn(),
    });
    expect(textContent(byTestId(tree, 'playlist-invite-join-error'))).toEqual([
      libraryStrings.playlist.inviteJoin.expiredOrRevokedMessage,
    ]);
  });
});
