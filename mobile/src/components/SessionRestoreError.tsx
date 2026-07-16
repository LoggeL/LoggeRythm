import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { presentError, type UserFacingError } from '../auth/presentationError';
import { strings } from '../localization';
import { colors, metrics } from '../theme';
import BrandLockup from './BrandLockup';

interface SessionRestoreErrorProps {
  error: UserFacingError;
  onRetry: () => Promise<void>;
  onForget: () => Promise<void>;
}

export default function SessionRestoreError({
  error,
  onRetry,
  onForget,
}: SessionRestoreErrorProps) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<UserFacingError | null>(null);

  const run = async (action: () => Promise<void>, fallbackMessage: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(presentError(cause, fallbackMessage));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="session-restore-error" style={styles.errorScreen} accessibilityViewIsModal>
      <BrandLockup compact />
      <Text accessibilityRole="header" style={styles.errorTitle}>
        {strings.auth.restoreFailedTitle}
      </Text>
      <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.errorMessage}>
        {actionError?.message ?? error.message}
      </Text>
      <Pressable
        testID="session-retry"
        accessibilityRole="button"
        accessibilityLabel={strings.common.retry}
        accessibilityState={{ disabled: busy, busy }}
        style={styles.primaryButton}
        disabled={busy}
        onPress={() => void run(onRetry, strings.auth.retryRestoreFailed)}
      >
        <Text style={styles.primaryButtonText}>
          {busy ? strings.common.working : strings.common.retry}
        </Text>
      </Pressable>
      <Pressable
        testID="session-forget"
        accessibilityRole="button"
        accessibilityLabel={strings.auth.forgetSession}
        accessibilityState={{ disabled: busy }}
        style={styles.secondaryButton}
        disabled={busy}
        onPress={() => void run(onForget, strings.auth.forgetSessionFailed)}
      >
        <Text style={styles.secondaryButtonText}>{strings.auth.forgetSession}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  errorScreen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 14,
  },
  errorTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  errorMessage: { color: colors.danger, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingHorizontal: 28,
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
});
