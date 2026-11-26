import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/error';
import type {
  Playlist,
  PlaylistCollaborator,
  PlaylistInviteCandidate,
  PlaylistOutgoingInvitation,
} from '../../api/types';
import { libraryStrings } from '../../screens/libraryStrings';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import {
  inviteErrorMessage,
  PlaylistCollaboratorsSheetContent,
  type InviteSearchState,
  type PendingInvitationsState,
  type PlaylistCollaboratorsSheetContentProps,
} from './PlaylistCollaboratorsSheet';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
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
  queryKeys: { playlists: {} },
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

const available: PlaylistInviteCandidate = {
  user: { id: 11, display_name: 'Julian', avatar_url: null },
  status: 'available',
};
const invited: PlaylistInviteCandidate = {
  user: { id: 12, display_name: 'Juna', avatar_url: '/api/users/12/avatar' },
  status: 'invited',
};
const alreadyCollaborator: PlaylistInviteCandidate = {
  user: { id: 9, display_name: 'Jule', avatar_url: null },
  status: 'collaborator',
};
const pending: PlaylistOutgoingInvitation = {
  invitee: invited.user,
  invited_by: { id: 7, display_name: 'Logge', avatar_url: null },
  created_at: '2026-11-25T09:00:00Z',
};

function searchState(overrides: Partial<InviteSearchState> = {}): InviteSearchState {
  return {
    input: 'Ju',
    onInputChange: vi.fn(),
    query: 'Ju',
    loading: false,
    error: null,
    candidates: [available, invited, alreadyCollaborator],
    onRetry: vi.fn(),
    invitingUserId: null,
    inviteError: null,
    inviteSuccess: null,
    onInvite: vi.fn(),
    ...overrides,
  };
}

function pendingState(overrides: Partial<PendingInvitationsState> = {}): PendingInvitationsState {
  return {
    loading: false,
    error: null,
    data: [pending],
    onRetry: vi.fn(),
    withdrawingUserId: null,
    withdrawError: null,
    onWithdraw: vi.fn(),
    ...overrides,
  };
}

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
    inviteSearch: searchState(),
    pendingInvitations: pendingState(),
    removingUserId: null,
    removeError: null,
    onToggleCollaborative: vi.fn(),
    onRemoveCollaborator: vi.fn(),
    onLeave: undefined,
    ...overrides,
  };
  return { props, tree: PlaylistCollaboratorsSheetContent(props) };
}

describe('inviteErrorMessage', () => {
  it('maps API status codes without leaking raw backend messages', () => {
    expect(inviteErrorMessage(new ApiError(404, '{}', 'raw'), true))
      .toBe(libraryStrings.playlist.inviteNotFound);
    expect(inviteErrorMessage(new ApiError(400, '{}', 'raw'), true))
      .toBe(libraryStrings.playlist.inviteSelf);
    expect(inviteErrorMessage(new ApiError(409, '{}', 'raw'), true))
      .toBe(libraryStrings.playlist.inviteAlreadyMember);
    expect(inviteErrorMessage(new ApiError(409, '{}', 'raw'), false))
      .toBe(libraryStrings.playlist.inviteCollaborationDisabled);
    expect(inviteErrorMessage(new Error('network'), true))
      .toBe(libraryStrings.playlist.inviteFailed);
  });
});

describe('PlaylistCollaboratorsSheetContent', () => {
  it('renders owner toggle, account search with per-status actions, pending invitations, and member removal', () => {
    const { props, tree } = renderContent();

    expect(byTestId(tree, 'playlist-collaborators-sheet').type).toBe('BottomSheet');
    const toggle = byTestId(tree, 'playlist-collaborative-switch');
    expect(toggle.props.value).toBe(true);
    (toggle.props.onValueChange as (v: boolean) => void)(false);
    expect(props.onToggleCollaborative).toHaveBeenCalledExactlyOnceWith(false);

    const input = byTestId(tree, 'playlist-invite-search-input');
    expect(input.type).toBe('TextInput');
    expect(input.props.value).toBe('Ju');
    expect(input.props.keyboardType).toBeUndefined();
    (input.props.onChangeText as (v: string) => void)('Jul');
    expect(props.inviteSearch?.onInputChange).toHaveBeenCalledExactlyOnceWith('Jul');

    // available -> "Einladen"
    const inviteButton = byTestId(tree, 'playlist-invite-candidate-invite-11');
    expect(textContent(inviteButton)).toContain(libraryStrings.playlist.inviteAction);
    (inviteButton.props.onPress as () => void)();
    expect(props.inviteSearch?.onInvite).toHaveBeenCalledExactlyOnceWith(available);
    // invited -> disabled "Eingeladen"
    const invitedButton = byTestId(tree, 'playlist-invite-candidate-invited-12');
    expect(textContent(invitedButton)).toContain(libraryStrings.playlist.invitedStatus);
    expect(invitedButton.props.disabled).toBe(true);
    expect(queryByTestId(tree, 'playlist-invite-candidate-invite-12')).toBeNull();
    // collaborator -> "Mitwirkend" badge, no button
    expect(textContent(byTestId(tree, 'playlist-invite-candidate-collaborator-9')))
      .toEqual([libraryStrings.playlist.collaboratorStatus]);
    expect(queryByTestId(tree, 'playlist-invite-candidate-invite-9')).toBeNull();

    expect(byTestId(tree, 'playlist-pending-invitations-section')).toBeDefined();
    const withdraw = byTestId(tree, 'playlist-pending-invitation-withdraw-12');
    expect(textContent(withdraw)).toContain(libraryStrings.playlist.withdrawInvitation);
    (withdraw.props.onPress as () => void)();
    expect(props.pendingInvitations?.onWithdraw).toHaveBeenCalledExactlyOnceWith(pending);

    expect(byTestId(tree, 'playlist-member-owner')).toBeDefined();
    expect(byTestId(tree, 'playlist-member-9')).toBeDefined();
    (byTestId(tree, 'playlist-member-remove-9').props.onPress as () => void)();
    expect(props.onRemoveCollaborator).toHaveBeenCalledExactlyOnceWith(editor);
    expect(queryByTestId(tree, 'playlist-collaborators-leave')).toBeNull();

    // No invite links and no email anywhere.
    const allText = textContent(tree).join(' ');
    expect(allText).not.toMatch(/Link|E-Mail|email/i);
  });

  it('disables every invite button while one invitation is in flight and shows its outcome', () => {
    const { tree } = renderContent({
      inviteSearch: searchState({
        invitingUserId: 11,
        inviteError: libraryStrings.playlist.inviteAlreadyMember,
      }),
    });
    const button = byTestId(tree, 'playlist-invite-candidate-invite-11');
    expect(button.props.disabled).toBe(true);
    expect(textContent(byTestId(tree, 'playlist-invite-error')))
      .toEqual([libraryStrings.playlist.inviteAlreadyMember]);

    const success = renderContent({
      inviteSearch: searchState({ inviteSuccess: libraryStrings.playlist.inviteSent('Julian') }),
    }).tree;
    expect(textContent(byTestId(success, 'playlist-invite-success')))
      .toEqual([libraryStrings.playlist.inviteSent('Julian')]);
  });

  it('shows search idle, loading, error-with-retry, and empty states', () => {
    const idle = renderContent({ inviteSearch: searchState({ input: '', query: '', candidates: undefined }) }).tree;
    expect(byTestId(idle, 'playlist-invite-search-input')).toBeDefined();
    expect(queryByTestId(idle, 'playlist-invite-search-loading')).toBeNull();
    expect(queryByTestId(idle, 'playlist-invite-candidates')).toBeNull();

    const loading = renderContent({
      inviteSearch: searchState({ loading: true, candidates: undefined }),
    }).tree;
    expect(byTestId(loading, 'playlist-invite-search-loading')).toBeDefined();

    const onRetry = vi.fn();
    const failed = renderContent({
      inviteSearch: searchState({ error: new Error('500'), candidates: undefined, onRetry }),
    }).tree;
    expect(byTestId(failed, 'playlist-invite-search-error')).toBeDefined();
    (byTestId(failed, 'playlist-invite-search-retry').props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();

    const empty = renderContent({ inviteSearch: searchState({ query: 'Zed', candidates: [] }) }).tree;
    expect(textContent(byTestId(empty, 'playlist-invite-search-empty')))
      .toEqual([libraryStrings.playlist.inviteSearchEmpty('Zed')]);
  });

  it('hides pending invitations when none are pending and surfaces load and withdraw failures', () => {
    const none = renderContent({ pendingInvitations: pendingState({ data: [] }) }).tree;
    expect(queryByTestId(none, 'playlist-pending-invitations-section')).toBeNull();

    const loading = renderContent({
      pendingInvitations: pendingState({ data: undefined, loading: true }),
    }).tree;
    expect(byTestId(loading, 'playlist-pending-invitations-loading')).toBeDefined();

    const onRetry = vi.fn();
    const failed = renderContent({
      pendingInvitations: pendingState({ data: undefined, error: new Error('500'), onRetry }),
    }).tree;
    expect(byTestId(failed, 'playlist-pending-invitations-error')).toBeDefined();
    (byTestId(failed, 'playlist-pending-invitations-retry').props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();

    const withdrawFailed = renderContent({
      pendingInvitations: pendingState({
        withdrawingUserId: 12,
        withdrawError: libraryStrings.playlist.withdrawInvitationFailed,
      }),
    }).tree;
    expect(byTestId(withdrawFailed, 'playlist-pending-invitation-withdraw-12').props.disabled)
      .toBe(true);
    expect(textContent(byTestId(withdrawFailed, 'playlist-pending-invitation-withdraw-error')))
      .toEqual([libraryStrings.playlist.withdrawInvitationFailed]);
  });

  it('replaces search and pending invitations with the disabled hint when collaboration is off', () => {
    const { tree } = renderContent({
      playlist: makePlaylist({ is_collaborative: false }),
    });

    expect(textContent(byTestId(tree, 'playlist-invite-disabled-hint')))
      .toEqual([libraryStrings.playlist.inviteDisabledHint]);
    expect(queryByTestId(tree, 'playlist-invite-search-section')).toBeNull();
    expect(queryByTestId(tree, 'playlist-pending-invitations-section')).toBeNull();
    // Existing members remain visible so the owner can still manage them.
    expect(byTestId(tree, 'playlist-member-9')).toBeDefined();
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
      inviteSearch: null,
      pendingInvitations: null,
      onToggleCollaborative: undefined,
      onRemoveCollaborator: undefined,
      onLeave,
    });

    expect(queryByTestId(tree, 'playlist-collaborative-switch')).toBeNull();
    expect(queryByTestId(tree, 'playlist-invite-search-section')).toBeNull();
    expect(queryByTestId(tree, 'playlist-pending-invitations-section')).toBeNull();
    expect(queryByTestId(tree, 'playlist-member-remove-9')).toBeNull();
    expect(byTestId(tree, 'playlist-collaborators-frozen')).toBeDefined();

    (byTestId(tree, 'playlist-collaborators-leave').props.onPress as () => void)();
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('hides search for an active collaborator who is not the owner', () => {
    const { tree } = renderContent({
      playlist: makePlaylist({ is_owner: false, is_collaborator: true }),
      inviteSearch: null,
      pendingInvitations: null,
      onToggleCollaborative: undefined,
      onRemoveCollaborator: undefined,
    });
    expect(queryByTestId(tree, 'playlist-invite-search-section')).toBeNull();
    expect(queryByTestId(tree, 'playlist-invite-disabled-hint')).toBeNull();
  });
});
