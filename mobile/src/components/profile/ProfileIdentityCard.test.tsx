import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../api/types';
import { activateLocale, strings } from '../../localization';
import { byTestId, byType, queryByTestId } from '../../test/render';
import { ProfileAccountDetailsCard, ProfileIdentityCard } from './ProfileIdentityCard';

vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

const user = {
  id: 7,
  email: 'person@example.test',
  display_name: 'Ada Lovelace',
  avatar_url: null,
  is_admin: true,
  is_approved: false,
} as unknown as User;

afterEach(() => {
  activateLocale('de');
});

describe('ProfileIdentityCard', () => {
  it('shows initials as a labelled image when no avatar is set', () => {
    const tree = ProfileIdentityCard({ user, avatarUri: null, serverOrigin: 'https://music.example.test' });
    const avatar = byTestId(tree, 'profile-avatar');

    expect(avatar.props.accessibilityRole).toBe('image');
    expect(avatar.props.accessibilityLabel).toBe('Ada Lovelace');
    expect(byType(avatar, 'Text').map((text) => text.props.children)).toEqual(['AL']);
    expect(byType(tree, 'Image')).toHaveLength(0);
  });

  it('renders the uploaded avatar through Artwork with the same name', () => {
    const tree = ProfileIdentityCard({
      user,
      avatarUri: 'https://music.example.test/avatar.png',
      serverOrigin: 'https://music.example.test',
    });
    const avatar = byTestId(tree, 'profile-avatar');

    expect(avatar.props.accessibilityRole).toBe('image');
    expect(avatar.props.accessibilityLabel).toBe('Ada Lovelace');
    expect(byType(avatar, 'Image')[0].props.source).toEqual({ uri: 'https://music.example.test/avatar.png' });
  });

  it.each(['de', 'en'] as const)('names role, approval and the untruncated origin in %s', (locale) => {
    activateLocale(locale);
    const origin = 'https://a-very-long-self-hosted-music-server.example.test';
    const tree = ProfileIdentityCard({ user, avatarUri: null, serverOrigin: origin });

    expect(byType(byTestId(tree, 'profile-role'), 'Text')[0].props.children)
      .toBe(strings.profile.administrator);
    expect(byType(byTestId(tree, 'profile-approval'), 'Text')[0].props.children)
      .toBe(strings.profile.pendingApproval);
    const server = byTestId(tree, 'profile-server-origin');
    expect(server.props.children).toBe(strings.profile.serverOrigin(origin));
    expect(server.props.numberOfLines).toBeUndefined();
    expect(byTestId(tree, 'profile-email-value').props.children).toBe('person@example.test');
  });

  it('falls back to the email as the name', () => {
    const tree = ProfileIdentityCard({
      user: { ...user, display_name: '  ' },
      avatarUri: null,
      serverOrigin: 'https://music.example.test',
    });
    expect(byTestId(tree, 'profile-name').props.children).toBe('person@example.test');
  });

  it('renders a compact horizontal overview header while preserving the untruncated server origin', () => {
    const origin = 'https://a-very-long-self-hosted-music-server.example.test';
    const tree = ProfileIdentityCard({
      user,
      avatarUri: null,
      serverOrigin: origin,
      compact: true,
    });

    expect(byTestId(tree, 'profile-avatar').props.accessibilityLabel).toBe('Ada Lovelace');
    expect(byTestId(tree, 'profile-name').props.children).toBe('Ada Lovelace');
    expect(byTestId(tree, 'profile-email-value').props.children).toBe('person@example.test');
    expect(byTestId(tree, 'profile-server-origin').props.children).toBe(
      strings.profile.serverOrigin(origin),
    );
    expect(byTestId(tree, 'profile-server-origin').props.numberOfLines).toBeUndefined();
    expect(queryByTestId(tree, 'profile-role')).toBeNull();
    expect(queryByTestId(tree, 'profile-approval')).toBeNull();
    expect(queryByTestId(tree, 'profile-avatar-deferred')).toBeNull();
  });

  it.each(['de', 'en'] as const)(
    'exposes secondary account details in ProfileAccountDetailsCard in %s',
    (locale) => {
      activateLocale(locale);
      const origin = 'https://music.example.test';
      const tree = ProfileAccountDetailsCard({ user, serverOrigin: origin });

      expect(byTestId(tree, 'profile-account-details')).toBeDefined();
      expect(byType(byTestId(tree, 'profile-role'), 'Text')[0].props.children)
        .toBe(strings.profile.administrator);
      expect(byType(byTestId(tree, 'profile-approval'), 'Text')[0].props.children)
        .toBe(strings.profile.pendingApproval);
      expect(byTestId(tree, 'profile-server-origin').props.children)
        .toBe(strings.profile.serverOrigin(origin));
      expect(byTestId(tree, 'profile-avatar-deferred').props.children)
        .toBe(strings.profile.avatarDeferred);
      expect(queryByTestId(tree, 'profile-google-linked')).toBeNull();

      const linkedTree = ProfileAccountDetailsCard({
        user: { ...user, google_linked: true },
        serverOrigin: origin,
      });
      expect(byType(byTestId(linkedTree, 'profile-google-linked'), 'Text')[0].props.children)
        .toBe(strings.profile.googleLinked);
    },
  );
});
