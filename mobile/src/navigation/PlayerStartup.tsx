import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { UserFacingError } from '../auth/presentationError';
import BrandLockup from '../components/BrandLockup';
import { AppText } from '../components/ui/AppText';
import { RetryButton } from '../components/ui/states';
import { strings } from '../localization';
import { colors, spacing } from '../theme';

/** Blocking gate shown when the native player could not be prepared. */
export function PlayerStartupError({ error, retry }: { error: UserFacingError; retry: () => void }) {
  return (
    <View testID="player-startup-error" style={styles.state} accessibilityViewIsModal>
      <BrandLockup compact />
      <AppText variant="title" align="center" accessibilityRole="header">
        {strings.player.startFailedTitle}
      </AppText>
      <AppText
        color="danger"
        align="center"
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        {error.message}
      </AppText>
      <RetryButton
        testID="player-startup-retry"
        accessibilityLabel={strings.common.retry}
        onRetry={retry}
        style={styles.retry}
      />
    </View>
  );
}

/** Progress gate while the player connects and navigation state is restored. */
export function PlayerStartupStatus() {
  return (
    <View
      testID="player-startup-status"
      style={styles.state}
      accessibilityRole="progressbar"
      accessibilityLabel={strings.player.preparing}
      accessibilityLiveRegion="polite"
    >
      <BrandLockup compact />
      <ActivityIndicator color={colors.accent} size="large" />
      <AppText color="secondary" align="center">{strings.player.preparing}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  state: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.md,
  },
  retry: { alignSelf: 'center' },
});
