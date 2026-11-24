import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/error';
import type { Playlist, PlaylistCollaborator, PlaylistInvite } from '../../api/types';
import { libraryStrings } from '../../screens/libraryStrings';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import {
  directInviteErrorMessage,
  PlaylistCollaboratorsSheetContent,
  validateDirectInviteEmail,
  type PlaylistCollaboratorsSheetContentProps,
} from './PlaylistCollaboratorsSheet';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Share: { share: vi.fn() },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock('../../data', () => ({
  invalidatePlaylistCaches: vi.fn(),
  musicMutations: {},
  musicQueries: {},
  queryKeys: { playlists: { invite: vi.fn() } },
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  Artwork: 'Artwork',
  BottomSheet: 'BottomSheet',
}));
vi.mock('./useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

const editor: PlaylistCollaborator = {
  user_id: 9,
  display_name: 'Jule',
  avatar_url: '/api/users/9/avatar',
  role: 'editor',
  joined_at: '2026-11-24T09:00:00Z',
};

const activeInvite: PlaylistInvite = {
  token: 'valid_invite_token_1234567890',
  created_at: '2026-11-24T09:00:00Z',
  expires_at: null,
};

function makePlaylist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 42,
    name: 'WG-Küche',
    description: null,
    cover_url: null,
    is_public: false,
    is_owner: true,
    owner_id: 7,
    owner_name: 'Logge',
    owner_avatar_url: '/api/users/7/avatar',
    is_collaborative: true,
    is_collaborator: false,
    can_edit_tracks: true,
    collaborators: [editor],
    collaborator_count: 1,
    revision: 2,
    tracks: [],
    ...overrides,
  };
}

function renderContent(overrides: Partial<PlaylistCollaboratorsSheetContentProps> = {}) {
  const props: PlaylistCollaboratorsSheetContentProps = {
    visible: true,
    onClose: vi.fn(),
    apiBase: 'https://loggerythm.logge.top',
    playlist: makePlaylist(),
    busy: false,
    invite: {
      loading: false,
      error: null,
      data: activeInvite,
      busy: false,
      mutationError: null,
      shareError: null,
      onRetry: vi.fn(),
      onShare: vi.fn(),
      onCreateOrRotate: vi.fn(),
      onRevoke: vi.fn(),
    },
    directInvite: {
      email: 'sam@example.test',
      busy: false,
      error: null,
      success: null,
      onEmailChange: vi.fn(),
      onSubmit: vi.fn(),
    },
    removingUserId: null,
    removeError: null,
    onToggleCollaborative: vi.fn(),
    onRemoveCollaborator: vi.fn(),
    onLeave: undefined,
    ...overrides,
  };
  return { props, tree: PlaylistCollaboratorsSheetContent(props) };
}

describe('direct invite helpers', () => {
  it('validates email locally before sending a request', () => {
    expect(validateDirectInviteEmail('   ')).toBe(
      libraryStrings.playlist.directInviteEmailRequired,
    );
    expect(validateDirectInviteEmail('not-an-email')).toBe(
      libraryStrings.playlist.directInviteEmailInvalid,
    );
    expect(validateDirectInviteEmail('  Jule@Example.Test ')).toBeNull();
  });

  it('maps API status codes without leaking raw backend messages', () => {
    expect(directInviteErrorMessage(new ApiError(404, '{}', 'raw'), true))
      .toBe(libraryStrings.playlist.directInviteNotFound);
    expect(directInviteErrorMessage(new ApiError(400, '{}', 'raw'), true))
      .toBe(libraryStrings.playlist.directInviteSelf);
    expect(directInviteErrorMessage(new ApiError(409, '{}', 'raw'), true))
      .toBe(libraryStrings.playlist.directInviteAlreadyMember);
    expect(directInviteErrorMessage(new ApiError(409, '{}', 'raw'), false))
      .toBe(libraryStrings.playlist.directInviteDisabled);
    expect(directInviteErrorMessage(new Error('network'), true))
      .toBe(libraryStrings.playlist.directInviteFailed);
  });
});

describe('PlaylistCollaboratorsSheetContent', () => {
  it('renders owner controls, active invite URL/actions, direct email form, and member removal', () => {
    const { props, tree } = renderContent();

    expect(byTestId(tree, 'playlist-collaborators-sheet').type).toBe('BottomSheet');
    const toggle = byTestId(tree, 'playlist-collaborative-switch');
    expect(toggle.props.value).toBe(true);
    (toggle.props.onValueChange as (v: boolean) => void)(false);
    expect(props.onToggleCollaborative).toHaveBeenCalledExactlyOnceWith(false);

    expect(textContent(byTestId(tree, 'playlist-invite-url'))).toEqual([
      `https://loggerythm.logge.top/playlist/join/${activeInvite.token}`,
    ]);
    (byTestId(tree, 'playlist-invite-share').props.onPress as () => void)();
    (byTestId(tree, 'playlist-invite-rotate').props.onPress as () => void)();
    (byTestId(tree, 'playlist-invite-revoke').props.onPress as () => void)();
    expect(props.invite?.onShare).toHaveBeenCalledExactlyOnceWith(activeInvite);
    expect(props.invite?.onCreateOrRotate).toHaveBeenCalledExactlyOnceWith(true);
    expect(props.invite?.onRevoke).toHaveBeenCalledOnce();

    (byTestId(tree, 'playlist-collaborator-email-input').props.onChangeText as (v: string) => void)(
      'alex@example.test',
    );
    (byTestId(tree, 'playlist-collaborator-add-submit').props.onPress as () => void)();
    expect(props.directInvite?.onEmailChange).toHaveBeenCalledExactlyOnceWith('alex@example.test');
    expect(props.directInvite?.onSubmit).toHaveBeenCalledOnce();

    expect(byTestId(tree, 'playlist-member-owner')).toBeDefined();
    expect(byTestId(tree, 'playlist-member-9')).toBeDefined();
    (byTestId(tree, 'playlist-member-remove-9').props.onPress as () => void)();
    expect(props.onRemoveCollaborator).toHaveBeenCalledExactlyOnceWith(editor);
    expect(queryByTestId(tree, 'playlist-collaborators-leave')).toBeNull();
  });

  it('hides invite link and email controls when owner disables collaboration', () => {
    const { tree } = renderContent({
      playlist: makePlaylist({ is_collaborative: false }),
    });

    expect(byTestId(tree, 'playlist-invite-disabled-hint')).toBeDefined();
    expect(queryByTestId(tree, 'playlist-invite-section')).toBeNull();
    expect(queryByTestId(tree, 'playlist-direct-invite-section')).toBeNull();
    // Existing members remain visible so the owner can still manage them.
    expect(byTestId(tree, 'playlist-member-9')).toBeDefined();
  });

  it('renders invite loading, error retry, and empty create states cleanly', () => {
    const loadingTree = renderContent({
      invite: {
        loading: true,
        error: null,
        data: undefined,
        busy: false,
        mutationError: null,
        shareError: null,
        onRetry: vi.fn(),
        onShare: vi.fn(),
        onCreateOrRotate: vi.fn(),
        onRevoke: vi.fn(),
      },
    }).tree;
    expect(byTestId(loadingTree, 'playlist-invite-status-loading')).toBeDefined();

    const onRetry = vi.fn();
    const errorTree = renderContent({
      invite: {
        loading: false,
        error: new Error('500'),
        data: undefined,
        busy: false,
        mutationError: null,
        shareError: null,
        onRetry,
        onShare: vi.fn(),
        onCreateOrRotate: vi.fn(),
        onRevoke: vi.fn(),
      },
    }).tree;
    expect(byTestId(errorTree, 'playlist-invite-status-error')).toBeDefined();
    (byTestId(errorTree, 'playlist-invite-status-retry').props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();

    const onCreateOrRotate = vi.fn();
    const emptyTree = renderContent({
      invite: {
        loading: false,
        error: null,
        data: null,
        busy: false,
        mutationError: null,
        shareError: null,
        onRetry: vi.fn(),
        onShare: vi.fn(),
        onCreateOrRotate,
        onRevoke: vi.fn(),
      },
    }).tree;
    expect(byTestId(emptyTree, 'playlist-invite-empty')).toBeDefined();
    (byTestId(emptyTree, 'playlist-invite-create').props.onPress as () => void)();
    expect(onCreateOrRotate).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('renders collaborator view without owner invite/remove controls and shows frozen notice when paused', () => {
    const onLeave = vi.fn();
    const { tree } = renderContent({
      playlist: makePlaylist({
        is_owner: false,
        is_collaborator: true,
        is_collaborative: false,
        can_edit_tracks: false,
      }),
      invite: null,
      directInvite: null,
      onToggleCollaborative: undefined,
      onRemoveCollaborator: undefined,
      onLeave,
    });

    expect(queryByTestId(tree, 'playlist-collaborative-switch')).toBeNull();
    expect(queryByTestId(tree, 'playlist-invite-section')).toBeNull();
    expect(queryByTestId(tree, 'playlist-direct-invite-section')).toBeNull();
    expect(queryByTestId(tree, 'playlist-member-remove-9')).toBeNull();
    expect(byTestId(tree, 'playlist-collaborators-frozen')).toBeDefined();

    (byTestId(tree, 'playlist-collaborators-leave').props.onPress as () => void)();
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
