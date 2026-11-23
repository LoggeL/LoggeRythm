/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { avatar_url: string | null; display_name: string; email: string },
  snapshot: { supported: true },
  attention: vi.fn(),
  navigate: vi.fn(),
  isReady: vi.fn(),
  alert: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    default: actual,
    useState: <T,>(initial: T | (() => T)) => [
      typeof initial === 'function' ? (initial as () => T)() : initial,
      vi.fn(),
    ],
  };
});

vi.mock('react-native', () => ({
  Alert: { alert: mocks.alert },
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('@react-navigation/native', () => ({ DarkTheme: { colors: {} } }));
vi.mock('../api/url', () => ({
  tryResolveServerUrl: (value: string) => `https://music.example/${value}`,
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, logout: vi.fn() }),
}));
vi.mock('../auth/presentationError', () => ({ presentError: vi.fn() }));
vi.mock('../components/BrandLockup', () => ({ default: 'BrandLockup' }));
vi.mock('../config', () => ({ getCurrentApiBase: () => 'https://music.example' }));
vi.mock('../localization', () => ({
  strings: {
    navigation: {
      openProfile: 'Open profile',
      openProfileUpdateAvailable: 'Open profile, app update available',
      openProfileUpdateFailed: 'Open profile, update failed',
      profileUnavailable: 'Profile unavailable',
    },
  },
}));
vi.mock('./rootNavigation', () => ({
  rootNavigation: { isReady: mocks.isReady, navigate: mocks.navigate },
}));
vi.mock('../update/androidUpdateStore', () => ({
  useAndroidUpdateSnapshot: () => mocks.snapshot,
  androidUpdateAttention: mocks.attention,
}));

import { colors, metrics, radii } from '../theme';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../test/render';
import { ProfileButton } from './headerChrome';

describe('ProfileButton update dot', () => {
  beforeEach(() => {
    mocks.user = { avatar_url: null, display_name: 'Logge', email: 'logge@example.com' };
    mocks.attention.mockReset();
    mocks.navigate.mockReset();
    mocks.isReady.mockReset();
    mocks.alert.mockReset();
  });

  it('shows no dot and the plain label while nothing waits in the profile', () => {
    mocks.attention.mockReturnValue('none');

    const rendered = ProfileButton();

    expect(mocks.attention).toHaveBeenCalledWith(mocks.snapshot);
    const button = byTestId(rendered, 'profile-access');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Open profile');
    expect(queryByTestId(rendered, 'profile-update-dot')).toBeNull();
    expect(textContent(rendered)).toEqual(['L']);
  });

  it('marks the avatar and names the update in the label when an update waits', () => {
    mocks.attention.mockReturnValue('update-available');

    const rendered = ProfileButton();

    const button = byTestId(rendered, 'profile-access');
    expect(button.props.accessibilityLabel).toBe('Open profile, app update available');
    expect(flatStyle(button.props.style)).toMatchObject({
      width: metrics.minimumTouchTarget,
      height: metrics.minimumTouchTarget,
    });

    const dot = byTestId(rendered, 'profile-update-dot');
    expect(dot.type).toBe('View');
    expect(dot.props.accessible).toBe(false);
    expect(dot.props.importantForAccessibility).toBe('no');
    expect(dot.props.pointerEvents).toBe('none');
    const inset = (metrics.minimumTouchTarget - metrics.headerAvatar) / 2;
    expect(flatStyle(dot.props.style)).toEqual({
      position: 'absolute',
      top: inset,
      right: inset,
      width: metrics.badgeDot,
      height: metrics.badgeDot,
      borderRadius: radii.pill,
      borderWidth: metrics.badgeDotRing,
      borderColor: colors.background,
      backgroundColor: colors.accent,
    });
  });

  it('says the update failed when the dot stands for an unacknowledged final failure', () => {
    mocks.attention.mockReturnValue('install-failed');

    const rendered = ProfileButton();

    expect(byTestId(rendered, 'profile-access').props.accessibilityLabel).toBe('Open profile, update failed');
    expect(byTestId(rendered, 'profile-update-dot')).toBeDefined();
  });

  it('draws the dot over a photo avatar as well', () => {
    mocks.user = { avatar_url: 'avatars/1.jpg', display_name: 'Logge', email: 'logge@example.com' };
    mocks.attention.mockReturnValue('update-available');

    const rendered = ProfileButton();

    const [image] = byType(rendered, 'Image');
    expect(image.props.source).toEqual({ uri: 'https://music.example/avatars/1.jpg' });
    expect(flatStyle(image.props.style)).toMatchObject({
      width: metrics.headerAvatar,
      height: metrics.headerAvatar,
    });
    expect(byTestId(rendered, 'profile-update-dot').props.style).toMatchObject({
      borderColor: colors.background,
    });
  });

  it('opens the profile on press, or says loudly that it cannot yet', () => {
    mocks.attention.mockReturnValue('update-available');
    const press = byTestId(ProfileButton(), 'profile-access').props.onPress as () => void;

    mocks.isReady.mockReturnValue(true);
    press();
    expect(mocks.navigate).toHaveBeenCalledWith('Profile');

    mocks.isReady.mockReturnValue(false);
    press();
    expect(mocks.alert).toHaveBeenCalledWith('Profile unavailable');
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });
});
