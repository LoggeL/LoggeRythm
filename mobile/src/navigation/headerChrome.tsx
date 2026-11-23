import React, { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { DarkTheme, type Theme } from '@react-navigation/native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { tryResolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import { presentError } from '../auth/presentationError';
import BrandLockup from '../components/BrandLockup';
import {
  createFocusRingController,
  FocusRingOverlay,
} from '../components/ui/PressableScale';
import { getCurrentApiBase } from '../config';
import { strings } from '../localization';
import { stackTransitionOptions } from '../navigationPolicy';
import { colors, metrics, opacity, radii, spacing, typography } from '../theme';
import { androidUpdateAttention, useAndroidUpdateSnapshot } from '../update/androidUpdateStore';
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

/** Reduced-motion-aware native-stack screen options shared by root & section stacks. */
export function buildSectionScreenOptions(
  reducedMotion: boolean,
): NativeStackNavigationOptions {
  return {
    ...sectionScreenOptions,
    ...stackTransitionOptions(reducedMotion),
  };
}

/**
 * Round avatar in every stack header; opens the Profile modal route. While an
 * Android update waits in the profile (an offered update, or a final install
 * failure not yet seen), an accent dot marks the avatar and the button label
 * says which of the two it is.
 */
export function ProfileButton() {
  const { user } = useAuth();
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const updateAttention = androidUpdateAttention(useAndroidUpdateSnapshot());
  const updateNeedsAttention = updateAttention !== 'none';
  const [focusController] = useState(createFocusRingController);
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
      accessibilityLabel={
        updateAttention === 'install-failed'
          ? strings.navigation.openProfileUpdateFailed
          : updateAttention === 'update-available'
            ? strings.navigation.openProfileUpdateAvailable
            : strings.navigation.openProfile
      }
      android_ripple={{
        color: colors.fillStrong,
        borderless: true,
        radius: metrics.minimumTouchTarget / 2,
      }}
      onFocus={() => focusController.setFocused(true)}
      onBlur={() => focusController.setFocused(false)}
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
      {updateNeedsAttention ? (
        <View
          testID="profile-update-dot"
          accessible={false}
          importantForAccessibility="no"
          pointerEvents="none"
          style={styles.updateDot}
        />
      ) : null}
      <FocusRingOverlay controller={focusController} borderRadius={radii.pill} />
    </Pressable>
  );
}

/** Header action of the Profile route. A failed sign-out is reported, never swallowed. */
export function LogoutButton() {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [focusController] = useState(createFocusRingController);
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
      android_ripple={{ color: colors.fillStrong, borderless: false }}
      onFocus={() => focusController.setFocused(true)}
      onBlur={() => focusController.setFocused(false)}
      onPress={() => void onLogout()}
      disabled={busy}
      hitSlop={8}
      style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}
    >
      <Text style={styles.logout}>{busy ? strings.auth.signingOut : strings.auth.signOut}</Text>
      <FocusRingOverlay
        controller={focusController}
        borderRadius={radii.md}
        disabled={busy}
      />
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

/**
 * Header options of a tab root: brand lockup on the left and profile on the
 * right on phones; hidden on Android TV where `TvNavigationRail` already
 * presents the brand lockup and Profile entry persistently on the left edge.
 */
export function brandedRootOptions(
  title: string,
  isTv = false,
): NativeStackNavigationOptions {
  if (isTv) {
    return { headerShown: false };
  }
  return {
    headerShown: true,
    headerTitle: () => <RootHeaderTitle title={title} />,
    headerRight: () => <ProfileButton />,
  };
}

const AVATAR_SIZE = metrics.headerAvatar;
/** The dot's outer edge meets the corner of the avatar's bounding box. */
const DOT_INSET = (metrics.minimumTouchTarget - metrics.headerAvatar) / 2;

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
  updateDot: {
    position: 'absolute',
    top: DOT_INSET,
    right: DOT_INSET,
    width: metrics.badgeDot,
    height: metrics.badgeDot,
    borderRadius: radii.pill,
    borderWidth: metrics.badgeDotRing,
    // Header background, so the dot reads on photo avatars too.
    borderColor: colors.background,
    backgroundColor: colors.accent,
  },
  logoutButton: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
  },
  logout: { ...typography.label, color: colors.textSecondary },
  pressed: { opacity: opacity.pressed },
});
