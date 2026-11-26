import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/error';
import type { PlaylistIncomingInvitation } from '../../api/types';
import { libraryStrings } from '../../screens/libraryStrings';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import {
  invitationResponseErrorMessage,
  LibraryInvitationsContent,
  type LibraryInvitationsContentProps,
} from './LibraryInvitations';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
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
vi.mock('./autoBrowse', () => ({ refreshAutoBrowse: vi.fn() }));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  Artwork: 'Artwork',
}));

const owner = { id: 5, display_name: 'Tariq', avatar_url: null };

function invitation(
  id: number,
  overrides: Partial<PlaylistIncomingInvitation> = {},
): PlaylistIncomingInvitation {
  return {
    id,
    playlist: {
      playlist_id: 50 + id,
      name: `Kellerparty ${id}`,
      description: null,
      cover_url: `/api/playlists/${50 + id}/cover`,
      track_count: 14,
      collaborator_count: 2,
      owner,
    },
    invited_by: owner,
    created_at: '2026-11-25T10:00:00Z',
    ...overrides,
  };
}

function render(overrides: Partial<LibraryInvitationsContentProps> = {}) {
  const props: LibraryInvitationsContentProps = {
    apiBase: 'https://music.test',
    invitations: [invitation(1), invitation(2, { invited_by: null })],
    error: null,
    retrying: false,
    onRetry: vi.fn(),
    responding: null,
    responseError: null,
    onAccept: vi.fn(),
    onDecline: vi.fn(),
    ...overrides,
  };
  return { props, tree: LibraryInvitationsContent(props) };
}

describe('invitationResponseErrorMessage', () => {
  it('names a vanished invitation and otherwise the failed action', () => {
    expect(invitationResponseErrorMessage(new ApiError(404, '{}', 'gone'), 'accept'))
      .toBe(libraryStrings.library.invitationGone);
    expect(invitationResponseErrorMessage(new ApiError(500, '{}', 'boom'), 'accept'))
      .toBe(libraryStrings.library.invitationAcceptFailed);
    expect(invitationResponseErrorMessage(new Error('offline'), 'decline'))
      .toBe(libraryStrings.library.invitationDeclineFailed);
  });
});

describe('LibraryInvitationsContent', () => {
  it('lists each invitation with cover, name, owner, inviter, track count, and accept/decline', () => {
    const { props, tree } = render();

    expect(textContent(byTestId(tree, 'library-invitations')))
      .toContain(libraryStrings.library.invitationsTitle);
    const card = byTestId(tree, 'library-invitation-1');
    expect(textContent(byTestId(card, 'library-invitation-1-name'))).toEqual(['Kellerparty 1']);
    expect(textContent(byTestId(card, 'library-invitation-1-owner')))
      .toEqual([libraryStrings.library.invitationOwnerSummary('Tariq', 14)]);
    expect(textContent(byTestId(card, 'library-invitation-1-inviter')))
      .toEqual([libraryStrings.library.invitationInvitedBy('Tariq')]);
    // Inviter line is omitted when the inviting account no longer exists.
    expect(queryByTestId(tree, 'library-invitation-2-inviter')).toBeNull();

    const accept = byTestId(tree, 'library-invitation-1-accept');
    expect(textContent(accept)).toContain(libraryStrings.library.acceptInvitation);
    (accept.props.onPress as () => void)();
    expect(props.onAccept).toHaveBeenCalledExactlyOnceWith(props.invitations?.[0]);

    const decline = byTestId(tree, 'library-invitation-2-decline');
    expect(textContent(decline)).toContain(libraryStrings.library.declineInvitation);
    (decline.props.onPress as () => void)();
    expect(props.onDecline).toHaveBeenCalledExactlyOnceWith(props.invitations?.[1]);
  });

  it('resolves the cover against the API base', () => {
    const { tree } = render();
    const covers = (function collect(node: unknown): string[] {
      if (node === null || typeof node !== 'object') return [];
      if (Array.isArray(node)) return node.flatMap(collect);
      const element = node as { type: unknown; props: Record<string, unknown> };
      if (typeof element.type === 'function') {
        return collect((element.type as (p: unknown) => unknown)(element.props));
      }
      const own = element.type === 'Artwork' ? [String(element.props.uri)] : [];
      return [...own, ...collect(element.props.children)];
    })(tree);
    expect(covers).toEqual([
      'https://music.test/api/playlists/51/cover',
      'https://music.test/api/playlists/52/cover',
    ]);
  });

  it('is hidden while loading and when nothing is pending', () => {
    expect(render({ invitations: undefined }).tree).toBeNull();
    expect(render({ invitations: [] }).tree).toBeNull();
  });

  it('shows a failed load with retry instead of hiding the section', () => {
    const onRetry = vi.fn();
    const { tree } = render({ invitations: undefined, error: new Error('500'), onRetry });
    expect(textContent(byTestId(tree, 'library-invitations-error')))
      .toContain(libraryStrings.library.invitationsLoadFailed);
    (byTestId(tree, 'library-invitations-retry').props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('locks every card while one answer is in flight and reports a failed answer', () => {
    const { tree } = render({
      responding: { id: 1, response: 'accept' },
      responseError: libraryStrings.library.invitationAcceptFailed,
    });
    expect(byTestId(tree, 'library-invitation-1-accept').props.disabled).toBe(true);
    expect(byTestId(tree, 'library-invitation-2-decline').props.disabled).toBe(true);
    expect(textContent(byTestId(tree, 'library-invitation-response-error')))
      .toEqual([libraryStrings.library.invitationAcceptFailed]);

    // A failed answer stays visible even after its card was removed.
    const emptied = render({
      invitations: [],
      responseError: libraryStrings.library.invitationGone,
    }).tree;
    expect(textContent(byTestId(emptied, 'library-invitation-response-error')))
      .toEqual([libraryStrings.library.invitationGone]);
  });
});
