import React, { useEffect } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { appGate } from './src/auth/gate';
import RootNavigator from './src/navigation';
import LoginScreen from './src/screens/LoginScreen';
import PendingApprovalScreen from './src/screens/PendingApprovalScreen';
import BrandLockup from './src/components/BrandLockup';
import SessionRestoreError from './src/components/SessionRestoreError';
import TrackActionsHost from './src/components/TrackActionsHost';
import ConnectivityBanner from './src/components/ConnectivityBanner';
import { getApiBase } from './src/config';
import { strings } from './src/localization';
import { LocaleProvider, useLocaleRevision } from './src/localization/LocaleProvider';
import { musicQueryClient } from './src/data';
import { startSharedTextIntake } from './src/share/sharedTextIntent';
import { spotifySharedTextCoordinator } from './src/share/sharedTextRuntime';
import { colors } from './src/theme';

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

function Gate() {
  useLocaleRevision();
  const { user, bootstrapping, bootstrapError, retryBootstrap, forgetSession } = useAuth();
  const route = appGate(user, bootstrapping, bootstrapError?.message ?? null);
  useEffect(() => {
    console.info(`[LoggeRythm] app gate: ${route}`);
  }, [route]);
  if (route === 'loading') {
    return (
      <View
        testID="session-bootstrap-status"
        accessibilityRole="progressbar"
        accessibilityLabel={strings.auth.restoringSession}
        accessibilityLiveRegion="polite"
        style={styles.splash}
      >
        <BrandLockup compact />
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.splashText}>{strings.auth.restoringSession}</Text>
      </View>
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

export default function App() {
  useEffect(() => {
    let active = true;
    void getApiBase()
      .then((origin) => {
        if (active) console.info(`[LoggeRythm] API origin: ${origin}`);
      })
      .catch(() => {
        if (active) console.error('[LoggeRythm] API origin configuration failed');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <LocaleProvider>
      <QueryClientProvider client={musicQueryClient}>
        <SafeAreaProvider>
          <StatusBar barStyle="light-content" backgroundColor={colors.background} />
          <AuthProvider>
            <SharedTextIntakeHost />
            <Gate />
            <TrackActionsHost />
          </AuthProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
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
    gap: 14,
  },
  splashText: { color: colors.textSecondary, fontSize: 14 },
});
