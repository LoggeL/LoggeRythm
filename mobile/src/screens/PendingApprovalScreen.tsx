import React, { useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { presentError } from '../auth/presentationError';
import BrandLockup from '../components/BrandLockup';
import { strings } from '../localization';
import { colors, metrics } from '../theme';

export default function PendingApprovalScreen() {
  const { user, refreshUser, logout } = useAuth();
  const [busy, setBusy] = useState<'refresh' | 'logout' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

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
      <BrandLockup compact style={styles.brand} />
      <Text accessibilityRole="header" style={styles.title}>{strings.auth.approvalTitle}</Text>
      <Text style={styles.body}>
        {strings.auth.approvalBody(user?.email ?? strings.auth.accountFallback)}
      </Text>
      {error && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
      {status ? (
        <Text testID="approval-status" accessibilityLiveRegion="polite" style={styles.status}>
          {status}
        </Text>
      ) : null}
      {busy !== null ? (
        <Text
          testID="approval-progress"
          accessibilityRole="progressbar"
          accessibilityLabel={busy === 'refresh' ? strings.auth.checkingApproval : strings.auth.signingOut}
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {busy === 'refresh' ? strings.auth.checkingApproval : strings.auth.signingOut}
        </Text>
      ) : null}
      <Pressable
        testID="approval-recheck"
        accessibilityRole="button"
        accessibilityLabel={busy === 'refresh' ? strings.auth.checkingApproval : strings.auth.checkAgain}
        accessibilityState={{ disabled: busy !== null, busy: busy === 'refresh' }}
        style={styles.primaryButton}
        onPress={() => void recheck()}
        disabled={busy !== null}
      >
        {busy === 'refresh' ? (
          <ActivityIndicator color={colors.onAccent} accessibilityLabel={strings.auth.checkingApproval} />
        ) : (
          <Text style={styles.primaryText}>{strings.auth.checkAgain}</Text>
        )}
      </Pressable>
      <Pressable
        testID="approval-logout"
        accessibilityRole="button"
        accessibilityLabel={busy === 'logout' ? strings.auth.signingOut : strings.auth.signOut}
        accessibilityState={{ disabled: busy !== null, busy: busy === 'logout' }}
        style={styles.secondaryButton}
        onPress={() => void signOut()}
        disabled={busy !== null}
      >
        <Text style={styles.secondaryText}>{busy === 'logout' ? strings.auth.signingOut : strings.auth.signOut}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 32,
    gap: 14,
  },
  brand: { marginBottom: 8 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  primaryButton: {
    minWidth: 180,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryText: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  secondaryButton: { minHeight: metrics.minimumTouchTarget, justifyContent: 'center', paddingHorizontal: 24 },
  secondaryText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
});
