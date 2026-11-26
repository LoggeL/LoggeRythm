import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileScreen, { ProfileBottomSafeSpacer, ProfileTvFocusEffect } from './ProfileScreen';

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
  useEffect: vi.fn(),
  isFocused: true,
  useAuth: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  deleteAccount: vi.fn(),
  resolveServerUrl: vi.fn(),
  updatePlacement: vi.fn(),
  safeInsets: { top: 0, right: 0, bottom: 24, left: 0 },
  tvEnv: {
    isTv: false,
    overscan: { top: 0, right: 0, bottom: 0, left: 0 },
    contentPaddingHorizontal: 20,
    gridGap: 14,
  },
  useTvFocusReturn: vi.fn(),
  pushCheckpoint: vi.fn(),
  popAndRestore: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState, useEffect: mocks.useEffect };
});

vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => mocks.isFocused,
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
// The confirmation is a BottomSheet (Animated + safe-area hooks); a string
// mock keeps its `visible` / `onClose` props and its children.
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  BottomSheet: 'BottomSheet',
}));
vi.mock('../hooks/useBottomInset', () => ({ useBottomInset: () => 96 }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mocks.safeInsets,
}));
vi.mock('../tv', () => ({
  TvFocusScope: 'TvFocusScope',
  tvFocusRegistry: {
    pushCheckpoint: mocks.pushCheckpoint,
    popAndRestore: mocks.popAndRestore,
  },
  useTvEnvironment: () => mocks.tvEnv,
  useTvFocusReturn: mocks.useTvFocusReturn,
}));
vi.mock('../components/profile/ProfileSections', () => ({
  ListeningStatsPanel: 'ListeningStatsPanel',
  ProfileEditForm: 'ProfileEditForm',
  ProfileIdentityCard: 'ProfileIdentityCard',
  SleepTimerPanel: 'SleepTimerPanel',
}));
vi.mock('../components/profile/AdminHubPanel', () => ({ default: 'AdminHubPanel' }));
vi.mock('../components/profile/ConnectSettingsPanel', () => ({ default: 'ConnectSettingsPanel' }));
vi.mock('../components/profile/LanguageSelector', () => ({ default: 'LanguageSelector' }));
vi.mock('../components/profile/AndroidUpdateCard', () => ({ default: 'AndroidUpdateCard' }));
// Owns the latched slot's useState; covered by useAndroidUpdatePlacement.test.ts.
vi.mock('../components/profile/useAndroidUpdatePlacement', () => ({
  useAndroidUpdatePlacement: mocks.updatePlacement,
}));
vi.mock('../api/url', () => ({ resolveServerUrl: mocks.resolveServerUrl }));
vi.mock('../config', () => ({
  getCurrentApiBase: () => 'https://music.example.test',
}));
vi.mock('../data', () => ({
  musicCacheScope: () => 'https://music.example.test::user:7',
  musicQueries: { stats: () => ({ queryKey: ['stats'] }) },
  musicRepository: { updateMe: vi.fn() },
  queryKeys: { profile: { public: (id: number) => ['profile', id] } },
}));
vi.mock('../localization', () => ({
  strings: {
    profile: {
      title: 'Profile',
      subtitle: 'Account settings',
      dangerTitle: 'Danger zone',
      dangerBody: 'Deletion is permanent.',
      deleteAccount: 'Delete account',
      deleteTitle: 'Permanently delete account?',
      deleteWarning: 'This cannot be undone.',
      deleteFailed: 'Delete failed',
      deleting: 'Deleting…',
      deleteConfirm: 'Delete permanently',
      deleteCancel: 'Cancel',
    },
  },
}));
vi.mock('./profileModel', () => ({ profileServerHost: () => 'music.example.test' }));
vi.mock('./profileUpdate', () => ({ persistProfileUpdate: vi.fn() }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`No element has testID ${testID}`);
  return found;
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textContent((node as React.ReactElement<ElementProps>).props.children);
}

function renderDeletionState(
  confirming: boolean,
  deleting: boolean,
  error: string | null,
) {
  const setConfirming = vi.fn();
  const setDeleting = vi.fn();
  const setError = vi.fn();
  mocks.useState
    .mockReturnValueOnce([confirming, setConfirming])
    .mockReturnValueOnce([deleting, setDeleting])
    .mockReturnValueOnce([error, setError]);
  return {
    tree: ProfileScreen(),
    setConfirming,
    setDeleting,
    setError,
  };
}

describe('ProfileScreen account deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFocused = true;
    mocks.resolveServerUrl.mockImplementation((value: string) => value);
    mocks.updatePlacement.mockReturnValue('bottom');
    mocks.safeInsets = { top: 0, right: 0, bottom: 24, left: 0 };
    mocks.tvEnv = {
      isTv: false,
      overscan: { top: 0, right: 0, bottom: 0, left: 0 },
      contentPaddingHorizontal: 20,
      gridGap: 14,
    };
    mocks.useAuth.mockReturnValue({
      user: {
        id: 7,
        email: 'person@example.test',
        display_name: 'Person',
        avatar_url: null,
        is_admin: false,
        is_approved: true,
      },
      refreshUser: vi.fn(),
      deleteAccount: mocks.deleteAccount,
    });
    mocks.useQueryClient.mockReturnValue({ invalidateQueries: vi.fn() });
    mocks.useQuery.mockReturnValue({
      data: undefined,
      error: null,
      isPending: false,
      isFetching: false,
      isStale: false,
      refetch: vi.fn(),
    });
  });

  it('reports an invalid configured avatar URL', () => {
    // The authenticated response already has an optional avatar field. A
    // present but malformed URL must remain a visible configuration failure.
    const auth = mocks.useAuth();
    mocks.useAuth.mockReturnValue({ ...auth, user: { ...auth.user, avatar_url: 'invalid-avatar' } });
    const cause = new Error('Unsafe avatar origin');
    mocks.resolveServerUrl.mockImplementation(() => { throw cause; });
    expect(() => renderDeletionState(false, false, null)).toThrow(
      'Profile avatar URL is invalid for the selected server',
    );
  });

  it('opens a separate confirmation and cancel closes it without deleting', () => {
    const opening = renderDeletionState(false, false, null);
    expect(elements(opening.tree).find((element) => element.type === 'BottomSheet')?.props.visible)
      .toBe(false);
    (byTestId(opening.tree, 'profile-delete').props.onPress as () => void)();
    expect(opening.setError).toHaveBeenCalledExactlyOnceWith(null);
    expect(opening.setConfirming).toHaveBeenCalledExactlyOnceWith(true);
    expect(byTestId(opening.tree, 'profile-delete-confirmation').type).toBe('BottomSheet');
    expect(mocks.deleteAccount).not.toHaveBeenCalled();

    mocks.useState.mockReset();
    const cancelling = renderDeletionState(true, false, 'old error');
    (byTestId(cancelling.tree, 'profile-delete-cancel').props.onPress as () => void)();
    expect(cancelling.setError).toHaveBeenCalledExactlyOnceWith(null);
    expect(cancelling.setConfirming).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });

  it('keeps confirmation open and restores controls when the server rejects deletion', async () => {
    mocks.deleteAccount.mockRejectedValueOnce(new Error('last admin policy'));
    const rendered = renderDeletionState(true, false, null);

    (byTestId(rendered.tree, 'profile-delete-confirm').props.onPress as () => void)();

    await vi.waitFor(() => {
      expect(rendered.setError).toHaveBeenCalledWith(
        'Delete failed',
      );
    });
    expect(mocks.deleteAccount).toHaveBeenCalledOnce();
    expect(rendered.setDeleting.mock.calls).toEqual([[true], [false]]);
    expect(rendered.setConfirming).not.toHaveBeenCalled();

    mocks.useState.mockReset();
    const failed = renderDeletionState(true, false, 'Delete failed');
    const modal = elements(failed.tree).find((element) => element.type === 'BottomSheet');
    expect(modal?.props.visible).toBe(true);
    expect(byTestId(failed.tree, 'profile-delete-error').props.accessibilityRole).toBe('alert');
    expect(byTestId(failed.tree, 'profile-delete-error').props.accessibilityLiveRegion)
      .toBe('assertive');
    expect(textContent(byTestId(failed.tree, 'profile-delete-error'))).toBe('Delete failed');
    expect(textContent(byTestId(failed.tree, 'profile-delete-error')))
      .not.toContain('last admin policy');
    expect(byTestId(failed.tree, 'profile-delete-cancel').props.disabled).toBe(false);
  });

  it('submits exactly once and prevents dismissal while deletion is pending', async () => {
    mocks.deleteAccount.mockResolvedValueOnce(undefined);
    const ready = renderDeletionState(true, false, null);
    (byTestId(ready.tree, 'profile-delete-confirm').props.onPress as () => void)();
    await vi.waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledOnce());
    expect(ready.setDeleting).toHaveBeenCalledExactlyOnceWith(true);
    expect(ready.setConfirming).not.toHaveBeenCalled();

    mocks.useState.mockReset();
    const pending = renderDeletionState(true, true, null);
    expect(byTestId(pending.tree, 'profile-delete-confirm').props.disabled).toBe(true);
    expect(byTestId(pending.tree, 'profile-delete-cancel').props.disabled).toBe(true);
    const modal = elements(pending.tree).find((element) => element.type === 'BottomSheet');
    (modal?.props.onClose as () => void)();
    expect(pending.setConfirming).not.toHaveBeenCalled();
    expect(mocks.deleteAccount).toHaveBeenCalledOnce();
  });

  function scrollOrder(tree: React.ReactNode): string[] {
    const scroll = elements(tree).find((element) => element.type === 'ScrollView');
    if (scroll === undefined) throw new Error('Profile has no ScrollView');
    const children = (Array.isArray(scroll.props.children)
      ? scroll.props.children
      : [scroll.props.children]) as (React.ReactElement<ElementProps> | null)[];
    // An empty slot renders null.
    return children.filter((child) => child !== null).map((child) => (
      child.type === 'AndroidUpdateCard'
        ? 'AndroidUpdateCard'
        : typeof child.type === 'string'
          ? child.type
          : String(child.props.testID)
    ));
  }

  it('mounts exactly one update card, directly below the header in the top slot', () => {
    mocks.updatePlacement.mockReturnValue('top');
    const order = scrollOrder(renderDeletionState(false, false, null).tree);
    expect(mocks.updatePlacement).toHaveBeenCalledOnce();
    expect(order.slice(0, 3)).toEqual(['profile-hero', 'AndroidUpdateCard', 'ProfileIdentityCard']);
    expect(order.slice(-2)).toEqual(['ProfileEditForm', 'profile-danger']);
    expect(order.filter((entry) => entry === 'AndroidUpdateCard')).toHaveLength(1);
  });

  it('mounts exactly one update card above the danger zone in the bottom slot', () => {
    mocks.updatePlacement.mockReturnValue('bottom');
    const order = scrollOrder(renderDeletionState(false, false, null).tree);
    expect(order.slice(0, 2)).toEqual(['profile-hero', 'ProfileIdentityCard']);
    expect(order.slice(-3)).toEqual(['ProfileEditForm', 'AndroidUpdateCard', 'profile-danger']);
    expect(order.filter((entry) => entry === 'AndroidUpdateCard')).toHaveLength(1);
    expect(order).not.toContain('AdminHubPanel');
  });

  it('mounts the cohesive AdminHubPanel inside ProfileScreen only for admin accounts', () => {
    const auth = mocks.useAuth();
    mocks.useAuth.mockReturnValue({
      ...auth,
      user: { ...auth.user, is_admin: true },
    });
    const adminTree = renderDeletionState(false, false, null).tree;
    const order = scrollOrder(adminTree);
    expect(order.indexOf('AdminHubPanel')).toBe(order.indexOf('ListeningStatsPanel') + 1);
    const hub = elements(adminTree).find((element) => element.type === 'AdminHubPanel');
    expect(hub?.props).toEqual({
      scope: 'https://music.example.test::user:7',
      apiBase: 'https://music.example.test',
      currentUserId: 7,
    });

    mocks.useState.mockReset();
    mocks.tvEnv = {
      isTv: true,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
      contentPaddingHorizontal: 28,
      gridGap: 16,
    };
    const tvAdminTree = renderDeletionState(false, false, null).tree;
    expect(elements(tvAdminTree).some((element) => element.type === 'AdminHubPanel')).toBe(true);
  });

  it('guards the bottom Android gesture bar with ProfileBottomSafeSpacer and renders a 2-column TV layout without double overscan', () => {
    mocks.safeInsets = { top: 0, right: 0, bottom: 28, left: 0 };
    const spacer = ProfileBottomSafeSpacer();
    expect(spacer?.props.testID).toBe('profile-bottom-safe-spacer');
    expect(spacer?.props.style).toMatchObject({ height: 28 });

    mocks.safeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(ProfileBottomSafeSpacer()).toBeNull();

    mocks.useState.mockReset();
    mocks.tvEnv = {
      isTv: true,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
      contentPaddingHorizontal: 28,
      gridGap: 16,
    };
    const tvTree = renderDeletionState(false, false, null).tree;
    expect(byTestId(tvTree, 'profile-tv-columns')).toBeDefined();
    expect(JSON.stringify(byTestId(tvTree, 'profile-screen').props.style)).not.toContain('"paddingTop":27');
    expect(byTestId(tvTree, 'profile-scroll').props.contentContainerStyle).toEqual([
      expect.any(Object),
      { paddingHorizontal: 28, paddingBottom: 96 },
    ]);
    expect(elements(tvTree).some((el) => el.type === ProfileTvFocusEffect)).toBe(true);
  });

  it('pops the tv-profile focus checkpoint on unmount and gates useTvFocusReturn on isFocused', () => {
    let cleanup: (() => void) | undefined;
    mocks.useEffect.mockImplementation((effect: () => (() => void) | void) => {
      cleanup = effect() ?? undefined;
    });
    mocks.tvEnv = {
      isTv: true,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
      contentPaddingHorizontal: 28,
      gridGap: 16,
    };
    mocks.isFocused = false;

    expect(ProfileTvFocusEffect()).toBeNull();
    expect(mocks.useTvFocusReturn).toHaveBeenCalledWith({
      scope: 'profile',
      active: false,
      enabled: true,
    });
    expect(mocks.popAndRestore).not.toHaveBeenCalled();
    cleanup?.();
    expect(mocks.popAndRestore).toHaveBeenCalledOnce();
  });
});
