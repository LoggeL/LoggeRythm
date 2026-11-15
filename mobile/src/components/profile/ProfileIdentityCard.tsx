import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { User } from '../../api/types';
import { strings } from '../../localization';
import { profileInitials } from '../../screens/profileModel';
import { colors, layout, radii, spacing } from '../../theme';
import { AppText, Artwork } from '../ui';

export interface ProfileIdentityCardProps {
  user: User;
  avatarUri: string | null;
  serverOrigin: string;
}

function Badge({
  testID,
  label,
  tone,
}: {
  testID: string;
  label: string;
  tone: 'neutral' | 'success' | 'warning';
}) {
  return (
    <View testID={testID} style={[styles.badge, styles[tone]]}>
      <AppText
        variant="micro"
        color={tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'primary'}
      >
        {label}
      </AppText>
    </View>
  );
}

/**
 * ProfileIdentityCard is the hero of the profile screen: the avatar (the
 * uploaded picture, or the initials when none is set), name, email, role and
 * approval badges, and the server this account lives on.
 */
export function ProfileIdentityCard({ user, avatarUri, serverOrigin }: ProfileIdentityCardProps) {
  const name = user.display_name?.trim() || user.email;
  return (
    <View testID="profile-identity" style={styles.hero}>
      {avatarUri ? (
        <Artwork
          testID="profile-avatar"
          uri={avatarUri}
          size={layout.artwork.lg}
          shape="round"
          icon="account"
          accessibilityLabel={name}
        />
      ) : (
        <View
          testID="profile-avatar"
          accessible
          accessibilityRole="image"
          accessibilityLabel={name}
          style={styles.initials}
        >
          <AppText variant="hero" color="accent">
            {profileInitials(user.display_name, user.email)}
          </AppText>
        </View>
      )}
      <View style={styles.copy}>
        <AppText variant="overline" color="accent" align="center">
          {strings.profile.accountTitle}
        </AppText>
        <AppText testID="profile-name" variant="title" align="center" numberOfLines={2}>
          {name}
        </AppText>
        <AppText
          testID="profile-email-value"
          variant="callout"
          color="secondary"
          align="center"
          numberOfLines={1}
        >
          {user.email}
        </AppText>
      </View>
      <View style={styles.badges}>
        <Badge
          testID="profile-role"
          tone="neutral"
          label={user.is_admin ? strings.profile.administrator : strings.profile.member}
        />
        <Badge
          testID="profile-approval"
          tone={user.is_approved ? 'success' : 'warning'}
          label={user.is_approved ? strings.profile.approved : strings.profile.pendingApproval}
        />
      </View>
      <View style={styles.meta}>
        {/* Never truncated: on-device QA asserts the full origin. */}
        <AppText testID="profile-server-origin" variant="caption" color="muted" align="center">
          {strings.profile.serverOrigin(serverOrigin)}
        </AppText>
        <AppText testID="profile-avatar-deferred" variant="caption" color="muted" align="center">
          {strings.profile.avatarDeferred}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  initials: {
    width: layout.artwork.lg,
    height: layout.artwork.lg,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  copy: { alignSelf: 'stretch', gap: spacing.xxs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs },
  badge: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },
  neutral: { backgroundColor: colors.fillStrong },
  success: { backgroundColor: colors.successSubtle },
  warning: { backgroundColor: colors.warningSubtle },
  meta: { alignSelf: 'stretch', gap: spacing.xxs / 2 },
});
