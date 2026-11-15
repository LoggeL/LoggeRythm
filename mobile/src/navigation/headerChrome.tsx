import React, { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text } from 'react-native';
import { DarkTheme, type Theme } from '@react-navigation/native';
import { tryResolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import { presentError } from '../auth/presentationError';
import BrandLockup from '../components/BrandLockup';
import { getCurrentApiBase } from '../config';
import { strings } from '../localization';
import { colors, metrics, opacity, radii, spacing, typography } from '../theme';
import { rootNavigation } from './rootNavigation';

/** React Navigation chrome (container background, headers) from the theme tokens. */
export const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.textPrimary,
    primary: colors.accent,
    border: colors.hairline,
    notification: colors.danger,
  },
};

/** Native-stack header shared by every stack: flat, borderless, on the screen background. */
export const sectionScreenOptions = {
  headerStyle: { backgroundColor: colors.background },
  headerTintColor: colors.textPrimary,
  headerShadowVisible: false,
  headerTitleStyle: {
    fontSize: typography.bodyStrong.fontSize,
    fontWeight: typography.bodyStrong.fontWeight,
  },
  contentStyle: { backgroundColor: colors.background },
} as const;

/** Round avatar in every stack header; opens the Profile modal route. */
export function ProfileButton() {
  const { user } = useAuth();
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatarValue = user?.avatar_url ?? null;
  const avatar =
    avatarValue && failedAvatar !== avatarValue
      ? tryResolveServerUrl(avatarValue, getCurrentApiBase())
      : null;
  const initial = (user?.display_name?.trim() || user?.email || '?').slice(0, 1).toUpperCase();

  const openProfile = () => {
    if (!rootNavigation.isReady()) {
      Alert.alert(strings.navigation.profileUnavailable);
      return;
    }
    rootNavigation.navigate('Profile');
  };

  return (
    <Pressable
      testID="profile-access"
      accessibilityRole="button"
      accessibilityLabel={strings.navigation.openProfile}
      onPress={openProfile}
      hitSlop={6}
      style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
    >
      {avatar ? (
        <Image
          accessible={false}
          source={{ uri: avatar }}
          onError={() => setFailedAvatar(avatarValue)}
          style={styles.profileAvatar}
        />
      ) : (
        <Text accessible={false} style={styles.profileInitial}>{initial}</Text>
      )}
    </Pressable>
  );
}

/** Header action of the Profile route. A failed sign-out is reported, never swallowed. */
export function LogoutButton() {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const onLogout = async () => {
    setBusy(true);
    try {
      await logout();
    } catch (error) {
      Alert.alert(
        strings.auth.logoutFailed,
        presentError(error, strings.auth.logoutFailedMessage).message,
      );
      setBusy(false);
    }
  };
  return (
    <Pressable
      testID="logout-button"
      accessibilityRole="button"
      accessibilityLabel={busy ? strings.auth.signingOut : strings.auth.signOut}
      accessibilityState={{ disabled: busy, busy }}
      onPress={() => void onLogout()}
      disabled={busy}
      hitSlop={8}
      style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}
    >
      <Text style={styles.logout}>{busy ? strings.auth.signingOut : strings.auth.signOut}</Text>
    </Pressable>
  );
}

/** Brand lockup shown instead of a text title on the five tab roots. */
export function RootHeaderTitle({ title }: { title: string }) {
  return (
    <BrandLockup
      compact
      horizontal
      accessibilityRole="header"
      accessibilityLabel={`${strings.common.appName}, ${title}`}
    />
  );
}

/** Header options of a tab root: brand lockup on the left, profile on the right. */
export function brandedRootOptions(title: string) {
  return {
    headerTitle: () => <RootHeaderTitle title={title} />,
    headerRight: () => <ProfileButton />,
  };
}

const AVATAR_SIZE = 36;

const styles = StyleSheet.create({
  profileButton: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  profileInitial: {
    ...typography.label,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    lineHeight: AVATAR_SIZE,
    borderRadius: radii.pill,
    overflow: 'hidden',
    textAlign: 'center',
    color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },
  logoutButton: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  logout: { ...typography.label, color: colors.textSecondary },
  pressed: { opacity: opacity.pressed },
});
