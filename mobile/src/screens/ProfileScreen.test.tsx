import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileScreen from './ProfileScreen';

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
  useAuth: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState };
});

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
vi.mock('../components/profile/ProfileSections', () => ({
  ListeningStatsPanel: 'ListeningStatsPanel',
  ProfileEditForm: 'ProfileEditForm',
  ProfileIdentityCard: 'ProfileIdentityCard',
  SleepTimerPanel: 'SleepTimerPanel',
}));
vi.mock('../components/profile/LanguageSelector', () => ({ default: 'LanguageSelector' }));
vi.mock('../api/url', () => ({ resolveServerUrl: (value: string) => value }));
vi.mock('../config', () => ({
  DEFAULT_API_BASE: 'https://music.example.test',
  normalizeApiBase: (value: string) => value,
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
vi.mock('../theme', () => ({
  colors: {
    accent: '#f00',
    background: '#000',
    danger: '#f00',
    onAccent: '#fff',
    surface: '#111',
    surfaceElevated: '#222',
    textPrimary: '#fff',
    textSecondary: '#aaa',
  },
  metrics: { minimumTouchTarget: 48 },
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

  it('opens a separate confirmation and cancel closes it without deleting', () => {
    const opening = renderDeletionState(false, false, null);
    expect(elements(opening.tree).find((element) => element.type === 'Modal')?.props.visible)
      .toBe(false);
    (byTestId(opening.tree, 'profile-delete').props.onPress as () => void)();
    expect(opening.setError).toHaveBeenCalledExactlyOnceWith(null);
    expect(opening.setConfirming).toHaveBeenCalledExactlyOnceWith(true);
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
    const modal = elements(failed.tree).find((element) => element.type === 'Modal');
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
    const modal = elements(pending.tree).find((element) => element.type === 'Modal');
    (modal?.props.onRequestClose as () => void)();
    expect(pending.setConfirming).not.toHaveBeenCalled();
    expect(mocks.deleteAccount).toHaveBeenCalledOnce();
  });
});
