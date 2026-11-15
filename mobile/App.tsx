import React, { useEffect } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { appGate } from './src/auth/gate';
import RootNavigator from './src/navigation';
import LoginScreen from './src/screens/LoginScreen';
import PendingApprovalScreen from './src/screens/PendingApprovalScreen';
import AuthBackdrop from './src/components/AuthBackdrop';
import BrandLockup from './src/components/BrandLockup';
import SessionRestoreError from './src/components/SessionRestoreError';
import TrackActionsHost from './src/components/TrackActionsHost';
import ConnectivityBanner from './src/components/ConnectivityBanner';
import { AppText } from './src/components/ui/AppText';
import NotificationFavoriteHost from './src/components/NotificationFavoriteHost';
import { strings } from './src/localization';
import { LocaleProvider, useLocaleRevision } from './src/localization/LocaleProvider';
import LocaleHydrationGate from './src/localization/LocaleHydrationGate';
import { musicQueryClient } from './src/data';
import { startSharedTextIntake } from './src/share/sharedTextIntent';
import { spotifySharedTextCoordinator } from './src/share/sharedTextRuntime';
import { colors, spacing } from './src/theme';
import AndroidUpdateToastHost from './src/update/AndroidUpdateToastHost';

function SharedTextIntakeHost() {
  useEffect(() => {
    void spotifySharedTextCoordinator.hydrate();
    return startSharedTextIntake((text) => {
      void spotifySharedTextCoordinator.stage(text).catch(() => {
        // Never include an external share payload in diagnostics.
        console.error('[LoggeRythm] shared-text intake failed');
      });
    });
  }, []);
  return null;
}

/**
 * The branded launch surface shown while the locale or the session is being
 * restored: glow backdrop, lockup, spinner and an optional status line.
 */
function Splash({
  testID,
  accessibilityLabel,
  status,
}: {
  testID: string;
  accessibilityLabel: string;
  status?: string;
}) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={styles.splash}
    >
      <AuthBackdrop />
      <BrandLockup />
      <ActivityIndicator color={colors.accent} size="large" />
      {status ? <AppText variant="callout" color="secondary" align="center">{status}</AppText> : null}
    </View>
  );
}

function Gate() {
  useLocaleRevision();
  const { user, bootstrapping, bootstrapError, retryBootstrap, forgetSession } = useAuth();
  const route = appGate(user, bootstrapping, bootstrapError?.message ?? null);
  useEffect(() => {
    console.info(`[LoggeRythm] app gate: ${route}`);
  }, [route]);
  if (route === 'loading') {
    return (
      <Splash
        testID="session-bootstrap-status"
        accessibilityLabel={strings.auth.restoringSession}
        status={strings.auth.restoringSession}
      />
    );
  }
  if (route === 'bootstrap-error') {
    return (
      <SessionRestoreError
        error={bootstrapError!}
        onRetry={retryBootstrap}
        onForget={forgetSession}
      />
    );
  }
  if (route === 'login') return <LoginScreen />;
  if (route === 'pending') return <PendingApprovalScreen />;
  return (
    <View style={styles.authenticatedApp}>
      <ConnectivityBanner />
      <RootNavigator />
    </View>
  );
}

function LocaleBootstrapStatus() {
  // The catalog is not hydrated yet, so the only safe name is the brand.
  return <Splash testID="locale-bootstrap-status" accessibilityLabel="LoggeRythm" />;
}

export default function App() {
  return (
    <LocaleProvider>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <LocaleHydrationGate fallback={<LocaleBootstrapStatus />}>
          <QueryClientProvider client={musicQueryClient}>
            <AuthProvider>
              <AndroidUpdateToastHost />
              <SharedTextIntakeHost />
              <NotificationFavoriteHost />
              <Gate />
              <TrackActionsHost />
            </AuthProvider>
          </QueryClientProvider>
        </LocaleHydrationGate>
      </SafeAreaProvider>
    </LocaleProvider>
  );
}

const styles = StyleSheet.create({
  authenticatedApp: { flex: 1, backgroundColor: colors.background },
  splash: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    padding: spacing.xl,
  },
});
