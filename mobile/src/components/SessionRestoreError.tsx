import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { presentError, type UserFacingError } from '../auth/presentationError';
import { strings } from '../localization';
import { colors, layout, radii, spacing } from '../theme';
import AppIcon from './AppIcon';
import AuthBackdrop from './AuthBackdrop';
import BrandLockup from './BrandLockup';
import { ActionButton, AppText, RetryButton } from './ui';

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
    <View testID="session-restore-error" style={styles.screen} accessibilityViewIsModal>
      <AuthBackdrop />
      <BrandLockup compact />
      <View style={styles.message}>
        <View accessible={false} style={styles.glyph}>
          <AppIcon name="alert-circle-outline" color={colors.danger} size={28} />
        </View>
        <AppText variant="title" align="center" accessibilityRole="header">
          {strings.auth.restoreFailedTitle}
        </AppText>
        <AppText
          testID="session-restore-message"
          color="danger"
          align="center"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {actionError?.message ?? error.message}
        </AppText>
      </View>
      <View style={styles.actions}>
        <RetryButton
          testID="session-retry"
          label={busy ? strings.common.working : strings.common.retry}
          accessibilityLabel={strings.common.retry}
          busy={busy}
          onRetry={() => void run(onRetry, strings.auth.retryRestoreFailed)}
          style={styles.action}
        />
        <ActionButton
          testID="session-forget"
          variant="ghost"
          label={strings.auth.forgetSession}
          disabled={busy}
          onPress={() => void run(onForget, strings.auth.forgetSessionFailed)}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  message: { alignItems: 'center', gap: spacing.sm },
  glyph: {
    width: layout.artwork.md,
    height: layout.artwork.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerSubtle,
  },
  actions: { alignItems: 'center', gap: spacing.xxs },
  action: { alignSelf: 'center' },
});
