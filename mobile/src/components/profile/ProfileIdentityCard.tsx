import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { User } from '../../api/types';
import { strings } from '../../localization';
import { profileInitials } from '../../screens/profileModel';
import { colors, layout, radii, spacing } from '../../theme';
import { AppText, Artwork, Surface } from '../ui';

export interface ProfileIdentityCardProps {
  user: User;
  avatarUri: string | null;
  serverOrigin: string;
  /** Compact horizontal header for the Profile overview; secondary metadata lives in Account & App. */
  compact?: boolean;
}

export interface ProfileAccountDetailsCardProps {
  user: User;
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
 * uploaded picture, or the initials when none is set), name, email, and the
 * server this account lives on. In compact mode (used on the Profile overview)
 * it renders a tight horizontal header so the quick actions and all settings
 * destinations remain visible above the MiniPlayer; secondary account metadata
 * (role/approval badges and the web-only avatar note) moves to
 * `ProfileAccountDetailsCard` inside Account & App.
 */
export function ProfileIdentityCard({
  user,
  avatarUri,
  serverOrigin,
  compact = false,
}: ProfileIdentityCardProps) {
  const name = user.display_name?.trim() || user.email;
  if (compact) {
    return (
      <View testID="profile-identity" style={styles.compactHero}>
        {avatarUri ? (
          <Artwork
            testID="profile-avatar"
            uri={avatarUri}
            size={layout.artwork.md}
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
            style={styles.compactInitials}
          >
            <AppText variant="section" color="accent">
              {profileInitials(user.display_name, user.email)}
            </AppText>
          </View>
        )}
        <View style={styles.compactCopy}>
          <AppText testID="profile-name" variant="section" numberOfLines={1}>
            {name}
          </AppText>
          <AppText
            testID="profile-email-value"
            variant="callout"
            color="secondary"
            numberOfLines={1}
          >
            {user.email}
          </AppText>
          {/* Never truncated: on-device QA asserts the full origin. */}
          <AppText testID="profile-server-origin" variant="caption" color="muted">
            {strings.profile.serverOrigin(serverOrigin)}
          </AppText>
        </View>
      </View>
    );
  }

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

/**
 * Secondary account details card rendered inside Account & App so role,
 * approval status, server origin, and the web-only avatar hint stay reachable
 * without crowding the Profile overview header.
 */
export function ProfileAccountDetailsCard({
  user,
  serverOrigin,
}: ProfileAccountDetailsCardProps) {
  return (
    <Surface testID="profile-account-details" padded style={styles.detailsCard}>
      <View style={styles.detailsBadges}>
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
      <AppText testID="profile-server-origin" variant="caption" color="secondary">
        {strings.profile.serverOrigin(serverOrigin)}
      </AppText>
      <AppText testID="profile-avatar-deferred" variant="caption" color="muted">
        {strings.profile.avatarDeferred}
      </AppText>
    </Surface>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  compactHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxs,
  },
  compactInitials: {
    width: layout.artwork.md,
    height: layout.artwork.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  compactCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs / 2,
  },
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
  detailsCard: { gap: spacing.xs },
  detailsBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
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
