import { describe, expect, it, vi } from 'vitest';
import type { AdminInvite, AdminStatus, AdminStorageInfo, AdminUser } from '../../api/types';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import { AdminStatusSectionView } from './AdminStatusSection';
import { AdminStorageSectionView } from './AdminStorageSection';
import { AdminUsersSectionView } from './AdminUsersSection';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  Share: { share: vi.fn() },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('../../data', () => ({
  musicQueries: {
    adminUsers: vi.fn(),
    adminInvites: vi.fn(),
    adminStorage: vi.fn(),
    adminStatus: vi.fn(),
  },
  musicMutations: {
    approveAdminUser: vi.fn(),
    deleteAdminUser: vi.fn(),
    createAdminInvite: vi.fn(),
    cleanupAdminStorage: vi.fn(),
  },
  queryKeys: {
    admin: { root: (scope: string) => ['music', 'admin', scope] },
  },
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  Artwork: 'Artwork',
  BottomSheet: 'BottomSheet',
  Skeleton: 'Skeleton',
}));

const adminUser: AdminUser = {
  id: 1,
  email: 'admin@example.test',
  display_name: 'Admin',
  avatar_url: null,
  is_admin: true,
  is_approved: true,
  created_at: '2026-01-01T00:00:00Z',
};

const pendingUser: AdminUser = {
  id: 2,
  email: 'new@example.test',
  display_name: null,
  avatar_url: null,
  is_admin: false,
  is_approved: false,
  created_at: null,
};

const invite: AdminInvite = {
  code: 'INVITE123',
  url: '',
  used_by_name: null,
  created_at: '2026-11-20T10:00:00Z',
};

const storageInfo: AdminStorageInfo = {
  track_count: 12,
  total_bytes: 50 * 1024 * 1024,
  disk_total: 100 * 1024 * 1024,
  disk_used: 92 * 1024 * 1024,
  disk_free: 8 * 1024 * 1024,
  retention_days: 30,
  tracks: [],
};

const statusInfo: AdminStatus = {
  deezer: { arl_configured: true, arl_ok: true, quality: 'flac' },
  storage: {
    track_count: 12,
    total_bytes: 50 * 1024 * 1024,
    disk_total: 100 * 1024 * 1024,
    disk_used: 92 * 1024 * 1024,
    disk_free: 8 * 1024 * 1024,
    retention_days: 30,
  },
  users: { total: 3, approved: 2, pending: 1, admins: 1 },
  content: {
    playlists: 4,
    likes: 10,
    follows: 5,
    plays: 99,
    stored_lyrics: 3,
    parties: 1,
    invites_total: 5,
    invites_used: 2,
  },
  integrations: { spotify_configured: true, lastfm_configured: false },
  system: { app_env: 'production', database: 'postgresql', jwt_secure: true, cookie_secure: true },
};

describe('AdminUsersSectionView, AdminStorageSectionView, AdminStatusSectionView', () => {
  it('renders users, guards admin deletion, triggers approve/delete/invite actions, and surfaces errors loudly', () => {
    const onApproveUser = vi.fn();
    const onRequestDeleteUser = vi.fn();
    const onCreateInvite = vi.fn();
    const onShareInvite = vi.fn();
    const onConfirmDelete = vi.fn();

    const tree = AdminUsersSectionView({
      apiBase: 'https://music.example.test',
      currentUserId: 1,
      users: [adminUser, pendingUser],
      usersPending: false,
      usersFetching: false,
      usersFetchStatus: 'idle',
      usersStale: false,
      usersError: null,
      invites: [invite],
      invitesPending: false,
      invitesFetching: false,
      invitesFetchStatus: 'idle',
      invitesStale: false,
      invitesError: null,
      approvingUserId: null,
      deletingUser: pendingUser,
      deleteBusy: false,
      creatingInvite: false,
      feedback: null,
      actionError: 'Delete rejected',
      onRefresh: vi.fn(),
      onApproveUser,
      onRequestDeleteUser,
      onCancelDelete: vi.fn(),
      onConfirmDelete,
      onCreateInvite,
      onShareInvite,
    });

    expect(byTestId(tree, 'profile-admin-users-pending-badge')).toBeDefined();
    expect(queryByTestId(tree, 'profile-admin-user-delete-1')).toBeNull();
    expect(byTestId(tree, 'profile-admin-user-approve-2')).toBeDefined();
    expect(byTestId(tree, 'profile-admin-user-delete-2')).toBeDefined();
    expect(textContent(byTestId(tree, 'profile-admin-user-delete-error'))).toContain(
      'Delete rejected',
    );

    (byTestId(tree, 'profile-admin-user-approve-2').props.onPress as () => void)();
    expect(onApproveUser).toHaveBeenCalledWith(pendingUser);

    (byTestId(tree, 'profile-admin-user-delete-2').props.onPress as () => void)();
    expect(onRequestDeleteUser).toHaveBeenCalledWith(pendingUser);

    (byTestId(tree, 'profile-admin-user-delete-confirm').props.onPress as () => void)();
    expect(onConfirmDelete).toHaveBeenCalledOnce();

    (byTestId(tree, 'profile-admin-invite-create').props.onPress as () => void)();
    expect(onCreateInvite).toHaveBeenCalledOnce();

    (byTestId(tree, 'profile-admin-invite-share-INVITE123').props.onPress as () => void)();
    expect(onShareInvite).toHaveBeenCalledWith(invite);
  });

  it('renders storage metrics, progress bar, cleanup confirmation sheet, and loud cleanup error', () => {
    const onOpenCleanup = vi.fn();
    const onConfirmCleanup = vi.fn();
    const tree = AdminStorageSectionView({
      data: storageInfo,
      pending: false,
      fetching: false,
      fetchStatus: 'idle',
      stale: false,
      error: null,
      confirmingCleanup: true,
      cleaning: false,
      feedback: null,
      cleanupError: 'Disk busy',
      onRefresh: vi.fn(),
      onOpenCleanup,
      onCloseCleanup: vi.fn(),
      onConfirmCleanup,
    });

    expect(byTestId(tree, 'profile-admin-storage-content')).toBeDefined();
    expect(byTestId(tree, 'profile-admin-storage-progress').props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 92,
    });
    expect(textContent(byTestId(tree, 'profile-admin-storage-sheet-error'))).toContain('Disk busy');

    (byTestId(tree, 'profile-admin-storage-cleanup').props.onPress as () => void)();
    expect(onOpenCleanup).toHaveBeenCalledOnce();

    (byTestId(tree, 'profile-admin-storage-cleanup-confirm').props.onPress as () => void)();
    expect(onConfirmCleanup).toHaveBeenCalledOnce();
  });

  it('renders system status cards and switches tabs cleanly via in-hub quick buttons', () => {
    const onNavigateTab = vi.fn();
    const tree = AdminStatusSectionView({
      data: statusInfo,
      pending: false,
      fetching: false,
      fetchStatus: 'idle',
      stale: false,
      error: null,
      onRefresh: vi.fn(),
      onNavigateTab,
    });

    expect(byTestId(tree, 'profile-admin-status-deezer')).toBeDefined();
    expect(byTestId(tree, 'profile-admin-status-system')).toBeDefined();
    expect(textContent(byTestId(tree, 'profile-admin-status-deezer')).join(' ')).toContain('FLAC');
    expect(textContent(byTestId(tree, 'profile-admin-status-system')).join(' ')).toContain(
      'postgresql',
    );

    (byTestId(tree, 'profile-admin-status-open-users').props.onPress as () => void)();
    expect(onNavigateTab).toHaveBeenCalledWith('users');

    (byTestId(tree, 'profile-admin-status-open-storage').props.onPress as () => void)();
    expect(onNavigateTab).toHaveBeenCalledWith('storage');
  });
});
