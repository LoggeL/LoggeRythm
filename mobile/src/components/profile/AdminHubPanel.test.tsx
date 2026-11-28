import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId, elements, queryByTestId } from '../../test/render';
import AdminHubPanel from './AdminHubPanel';

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState };
});

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('./AdminUsageSection', () => ({ AdminUsageSection: 'AdminUsageSection' }));
vi.mock('./AdminUsersSection', () => ({ AdminUsersSection: 'AdminUsersSection' }));
vi.mock('./AdminStorageSection', () => ({ AdminStorageSection: 'AdminStorageSection' }));
vi.mock('./AdminStatusSection', () => ({ AdminStatusSection: 'AdminStatusSection' }));

describe('AdminHubPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mounts only the active sub-tab and switches cleanly between all 4 admin tabs', () => {
    const setActiveTab = vi.fn();
    mocks.useState.mockReturnValueOnce(['usage', setActiveTab]);

    const usageTree = AdminHubPanel({
      scope: 'https://music.example.test::user:1',
      apiBase: 'https://music.example.test',
      currentUserId: 1,
    });
    expect(byTestId(usageTree, 'profile-admin')).toBeDefined();
    expect(byTestId(usageTree, 'profile-admin-tab-usage').props.accessibilityState).toEqual({
      selected: true,
      disabled: false,
    });
    expect(elements(usageTree).some((el) => el.type === 'AdminUsageSection')).toBe(true);
    expect(elements(usageTree).some((el) => el.type === 'AdminUsersSection')).toBe(false);
    expect(elements(usageTree).some((el) => el.type === 'AdminStorageSection')).toBe(false);
    expect(elements(usageTree).some((el) => el.type === 'AdminStatusSection')).toBe(false);

    (byTestId(usageTree, 'profile-admin-tab-users').props.onPress as () => void)();
    expect(setActiveTab).toHaveBeenCalledWith('users');

    mocks.useState.mockReturnValueOnce(['users', setActiveTab]);
    const usersTree = AdminHubPanel({
      scope: 'https://music.example.test::user:1',
      apiBase: 'https://music.example.test',
      currentUserId: 1,
    });
    expect(elements(usersTree).some((el) => el.type === 'AdminUsersSection')).toBe(true);
    expect(elements(usersTree).some((el) => el.type === 'AdminUsageSection')).toBe(false);

    mocks.useState.mockReturnValueOnce(['storage', setActiveTab]);
    const storageTree = AdminHubPanel({
      scope: 'https://music.example.test::user:1',
      apiBase: 'https://music.example.test',
      currentUserId: 1,
    });
    expect(elements(storageTree).some((el) => el.type === 'AdminStorageSection')).toBe(true);

    mocks.useState.mockReturnValueOnce(['status', setActiveTab]);
    const statusTree = AdminHubPanel({
      scope: 'https://music.example.test::user:1',
      apiBase: 'https://music.example.test',
      currentUserId: 1,
    });
    const statusEl = elements(statusTree).find((el) => el.type === 'AdminStatusSection');
    expect(statusEl).toBeDefined();
    expect(queryByTestId(statusTree, 'profile-admin-tab-status')?.props.accessibilityState).toEqual({
      selected: true,
      disabled: false,
    });
    (statusEl?.props.onNavigateTab as (tab: string) => void)('storage');
    expect(setActiveTab).toHaveBeenCalledWith('storage');
  });
});
