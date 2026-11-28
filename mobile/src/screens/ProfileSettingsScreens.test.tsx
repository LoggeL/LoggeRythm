import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileSettingsTvFocusEffect } from '../components/profile/ProfileChrome';
import AccountAppSettingsScreen from './AccountAppSettingsScreen';
import DevicesStorageSettingsScreen from './DevicesStorageSettingsScreen';
import PlaybackSettingsScreen from './PlaybackSettingsScreen';

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
  isFocused: true,
  useAuth: vi.fn(),
  useQueryClient: vi.fn(),
  deleteAccount: vi.fn(),
  refreshUser: vi.fn(),
  persistProfileUpdate: vi.fn(),
  invalidateQueries: vi.fn(),
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
  return { ...actual, default: actual, useState: mocks.useState };
});

vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => mocks.isFocused,
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: mocks.useQueryClient,
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
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
  ProfileAccountDetailsCard: 'ProfileAccountDetailsCard',
  ProfileEditForm: 'ProfileEditForm',
  SleepTimerPanel: 'SleepTimerPanel',
}));
vi.mock('../components/profile/AutoplayPanel', () => ({ default: 'AutoplayPanel' }));
vi.mock('../components/profile/PlaybackSettingsPanel', () => ({ default: 'PlaybackSettingsPanel' }));
vi.mock('../components/profile/ConnectSettingsPanel', () => ({ default: 'ConnectSettingsPanel' }));
vi.mock('../components/profile/StorageCachePanel', () => ({ default: 'StorageCachePanel' }));
vi.mock('../components/profile/LanguageSelector', () => ({ default: 'LanguageSelector' }));
vi.mock('../components/profile/AndroidUpdateCard', () => ({ default: 'AndroidUpdateCard' }));
vi.mock('../components/AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../config', () => ({
  getCurrentApiBase: () => 'https://music.example.test',
}));
vi.mock('../data', () => ({
  musicRepository: { updateMe: vi.fn() },
  queryKeys: { profile: { public: (id: number) => ['profile', id] } },
}));
vi.mock('../localization', () => ({
  strings: {
    profile: {
      dangerTitle: 'Danger zone',
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
vi.mock('./profileUpdate', () => ({ persistProfileUpdate: mocks.persistProfileUpdate }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function expandTree(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(expandTree);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  if (typeof element.type === 'function' && element.type !== ProfileSettingsTvFocusEffect) {
    const rendered = (element.type as (props: ElementProps) => React.ReactNode)(element.props);
    return [element, ...expandTree(rendered)];
  }
  return [element, ...expandTree(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = expandTree(node).find(
    (element) => element.props.testID === testID && typeof element.type !== 'function',
  );
  if (found === undefined) throw new Error(`No host element has testID ${testID}`);
  return found;
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textContent((node as React.ReactElement<ElementProps>).props.children);
}

function renderAccountApp(confirming: boolean, deleting: boolean, error: string | null) {
  const setConfirming = vi.fn();
  const setDeleting = vi.fn();
  const setError = vi.fn();
  mocks.useState
    .mockReturnValueOnce([confirming, setConfirming])
    .mockReturnValueOnce([deleting, setDeleting])
    .mockReturnValueOnce([error, setError]);
  return {
    tree: AccountAppSettingsScreen(),
    setConfirming,
    setDeleting,
    setError,
  };
}

describe('thematic profile settings screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFocused = true;
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
      refreshUser: mocks.refreshUser,
      deleteAccount: mocks.deleteAccount,
    });
    mocks.useQueryClient.mockReturnValue({ invalidateQueries: mocks.invalidateQueries });
  });

  it('mounts PlaybackSettingsPanel (without duplicate heading) and SleepTimerPanel on PlaybackSettingsScreen', () => {
    const nodes = expandTree(PlaybackSettingsScreen());
    expect(nodes.some((el) => el.props.testID === 'profile-playback-screen')).toBe(true);
    const playbackPanel = nodes.find((el) => el.type === 'PlaybackSettingsPanel');
    expect(playbackPanel?.props.hideHeader).toBe(true);
    expect(nodes.some((el) => el.type === 'SleepTimerPanel')).toBe(true);
    expect(nodes.some((el) => el.props.testID === 'profile-bottom-safe-spacer')).toBe(true);
  });

  it('mounts ConnectSettingsPanel and StorageCachePanel on DevicesStorageSettingsScreen', () => {
    const nodes = expandTree(DevicesStorageSettingsScreen());
    expect(nodes.some((el) => el.props.testID === 'profile-devices-storage-screen')).toBe(true);
    expect(nodes.some((el) => el.type === 'ConnectSettingsPanel')).toBe(true);
    expect(nodes.some((el) => el.type === 'StorageCachePanel')).toBe(true);
    expect(nodes.some((el) => el.props.testID === 'profile-bottom-safe-spacer')).toBe(true);
  });

  it('mounts ProfileAccountDetailsCard, ProfileEditForm, LanguageSelector, AndroidUpdateCard, and Danger Zone on AccountAppSettingsScreen', async () => {
    const { tree } = renderAccountApp(false, false, null);
    const nodes = expandTree(tree);
    expect(nodes.some((el) => el.props.testID === 'profile-account-app-screen')).toBe(true);
    const accountDetails = nodes.find((el) => el.type === 'ProfileAccountDetailsCard');
    expect(accountDetails?.props.serverOrigin).toBe('https://music.example.test');
    expect(nodes.some((el) => el.type === 'ProfileEditForm')).toBe(true);
    expect(nodes.some((el) => el.type === 'LanguageSelector')).toBe(true);
    expect(nodes.some((el) => el.type === 'AndroidUpdateCard')).toBe(true);
    expect(byTestId(tree, 'profile-danger')).toBeDefined();
    expect(nodes.some((el) => el.props.testID === 'profile-bottom-safe-spacer')).toBe(true);

    const editForm = nodes.find((el) => el.type === 'ProfileEditForm');
    await (editForm?.props.onSave as (patch: { display_name: string }) => Promise<void>)({
      display_name: 'Updated Name',
    });
    expect(mocks.persistProfileUpdate).toHaveBeenCalledOnce();
  });

  it('preserves the full account deletion confirmation, error recovery, pending dismissal lock, and TV focus checkpoints', async () => {
    mocks.tvEnv = {
      isTv: true,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
      contentPaddingHorizontal: 28,
      gridGap: 16,
    };

    const opening = renderAccountApp(false, false, null);
    expect(expandTree(opening.tree).find((el) => el.type === 'BottomSheet')?.props.visible).toBe(false);
    (byTestId(opening.tree, 'profile-delete').props.onPress as () => void)();
    expect(mocks.pushCheckpoint).toHaveBeenCalledWith('profile-delete');
    expect(opening.setError).toHaveBeenCalledExactlyOnceWith(null);
    expect(opening.setConfirming).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.deleteAccount).not.toHaveBeenCalled();

    mocks.useState.mockReset();
    const cancelling = renderAccountApp(true, false, 'old error');
    (byTestId(cancelling.tree, 'profile-delete-cancel').props.onPress as () => void)();
    expect(cancelling.setError).toHaveBeenCalledExactlyOnceWith(null);
    expect(cancelling.setConfirming).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.popAndRestore).toHaveBeenCalledOnce();

    mocks.useState.mockReset();
    mocks.deleteAccount.mockRejectedValueOnce(new Error('last admin policy'));
    const failing = renderAccountApp(true, false, null);
    (byTestId(failing.tree, 'profile-delete-confirm').props.onPress as () => void)();
    await vi.waitFor(() => {
      expect(failing.setError).toHaveBeenCalledWith('Delete failed');
    });
    expect(failing.setDeleting.mock.calls).toEqual([[true], [false]]);
    expect(failing.setConfirming).not.toHaveBeenCalled();

    mocks.useState.mockReset();
    const failed = renderAccountApp(true, false, 'Delete failed');
    const errorNode = byTestId(failed.tree, 'profile-delete-error');
    expect(errorNode.props.accessibilityRole).toBe('alert');
    expect(errorNode.props.accessibilityLiveRegion).toBe('assertive');
    expect(textContent(errorNode)).toBe('Delete failed');

    mocks.useState.mockReset();
    const pending = renderAccountApp(true, true, null);
    expect(byTestId(pending.tree, 'profile-delete-confirm').props.disabled).toBe(true);
    expect(byTestId(pending.tree, 'profile-delete-cancel').props.disabled).toBe(true);
    const modal = expandTree(pending.tree).find((el) => el.type === 'BottomSheet');
    (modal?.props.onClose as () => void)();
    expect(pending.setConfirming).not.toHaveBeenCalled();
  });

  it('renders 2-column TV layouts with dedicated TvFocusScopes and focus return across all three settings screens', () => {
    mocks.tvEnv = {
      isTv: true,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
      contentPaddingHorizontal: 28,
      gridGap: 16,
    };

    const playbackNodes = expandTree(PlaybackSettingsScreen());
    expect(playbackNodes.some((el) => el.type === 'TvFocusScope' && el.props.scope === 'profile-playback')).toBe(true);
    expect(playbackNodes.some((el) => el.props.testID === 'profile-playback-screen-tv-columns')).toBe(true);
    expect(playbackNodes.some((el) => el.type === ProfileSettingsTvFocusEffect)).toBe(true);

    const devicesNodes = expandTree(DevicesStorageSettingsScreen());
    expect(devicesNodes.some((el) => el.type === 'TvFocusScope' && el.props.scope === 'profile-devices-storage')).toBe(true);
    expect(devicesNodes.some((el) => el.props.testID === 'profile-devices-storage-screen-tv-columns')).toBe(true);

    const accountNodes = expandTree(renderAccountApp(false, false, null).tree);
    expect(accountNodes.some((el) => el.type === 'TvFocusScope' && el.props.scope === 'profile-account-app')).toBe(true);
    expect(accountNodes.some((el) => el.props.testID === 'profile-account-app-screen-tv-columns')).toBe(true);

    mocks.isFocused = false;
    expect(ProfileSettingsTvFocusEffect({ scope: 'profile-playback' })).toBeNull();
    expect(mocks.useTvFocusReturn).toHaveBeenCalledWith({
      scope: 'profile-playback',
      active: false,
      enabled: true,
    });
  });
});
