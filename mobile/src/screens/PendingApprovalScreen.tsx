import React, { useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { presentError } from '../auth/presentationError';
import AppIcon from '../components/AppIcon';
import AuthBackdrop from '../components/AuthBackdrop';
import BrandLockup from '../components/BrandLockup';
import { ActionButton, AppText, Surface } from '../components/ui';
import { getCurrentApiBase } from '../config';
import { strings } from '../localization';
import { colors, layout, radii, spacing } from '../theme';

/** Same column width as the sign-in form. */
const CARD_MAX_WIDTH = layout.artwork.hero * 2;

export default function PendingApprovalScreen() {
  const { user, refreshUser, logout } = useAuth();
  const [busy, setBusy] = useState<'refresh' | 'logout' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const recheck = async () => {
    setBusy('refresh');
    setError(null);
    setStatus(null);
    try {
      const refreshed = await refreshUser();
      const message = refreshed.is_approved
        ? strings.auth.approvalGranted
        : strings.auth.approvalStillPending;
      AccessibilityInfo.announceForAccessibility(message);
      if (!refreshed.is_approved) setStatus(message);
    } catch (cause) {
      setError(presentError(cause, strings.auth.approvalCheckFailed).message);
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy('logout');
    setError(null);
    setStatus(null);
    try {
      await logout();
      AccessibilityInfo.announceForAccessibility(strings.auth.signingOut);
    } catch (cause) {
      setError(presentError(cause, strings.auth.logoutFailedMessage).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View testID="approval-screen" style={styles.container}>
      <AuthBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: spacing.xl + insets.top,
            paddingBottom: spacing.xl + insets.bottom,
          },
        ]}
      >
        <BrandLockup compact />
        <Surface padded radius="sheet" style={styles.card}>
          <View accessible={false} style={styles.glyph}>
            <AppIcon name="account-clock-outline" color={colors.warning} size={28} />
          </View>
          <AppText variant="title" align="center" accessibilityRole="header">
            {strings.auth.approvalTitle}
          </AppText>
          <AppText color="secondary" align="center">
            {strings.auth.approvalBody(user?.email ?? strings.auth.accountFallback)}
          </AppText>
          {/* Never truncated: on-device QA asserts the full origin. */}
          <AppText testID="approval-server-origin" variant="caption" color="muted" align="center">
            {strings.profile.serverOrigin(getCurrentApiBase())}
          </AppText>
          {error ? (
            <AppText
              testID="approval-error"
              variant="callout"
              color="danger"
              align="center"
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              {error}
            </AppText>
          ) : null}
          {status ? (
            <AppText
              testID="approval-status"
              variant="callout"
              color="warning"
              align="center"
              accessibilityLiveRegion="polite"
            >
              {status}
            </AppText>
          ) : null}
          {busy !== null ? (
            <AppText
              testID="approval-progress"
              variant="callout"
              color="secondary"
              align="center"
              accessibilityRole="progressbar"
              accessibilityLabel={busy === 'refresh' ? strings.auth.checkingApproval : strings.auth.signingOut}
              accessibilityLiveRegion="polite"
            >
              {busy === 'refresh' ? strings.auth.checkingApproval : strings.auth.signingOut}
            </AppText>
          ) : null}
          <View style={styles.actions}>
            <ActionButton
              testID="approval-recheck"
              icon="refresh"
              label={strings.auth.checkAgain}
              accessibilityLabel={busy === 'refresh' ? strings.auth.checkingApproval : strings.auth.checkAgain}
              busy={busy === 'refresh'}
              disabled={busy !== null}
              fullWidth
              onPress={() => void recheck()}
            />
            <ActionButton
              testID="approval-logout"
              variant="ghost"
              icon="logout"
              label={busy === 'logout' ? strings.auth.signingOut : strings.auth.signOut}
              accessibilityLabel={busy === 'logout' ? strings.auth.signingOut : strings.auth.signOut}
              busy={busy === 'logout'}
              disabled={busy !== null}
              fullWidth
              onPress={() => void signOut()}
            />
          </View>
        </Surface>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  glyph: {
    width: layout.artwork.md,
    height: layout.artwork.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warningSubtle,
  },
  actions: { alignSelf: 'stretch', gap: spacing.xxs, marginTop: spacing.xs },
});
