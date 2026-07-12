import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { appGate } from './src/auth/gate';
import RootNavigator from './src/navigation';
import LoginScreen from './src/screens/LoginScreen';
import PendingApprovalScreen from './src/screens/PendingApprovalScreen';
import { colors } from './src/theme';

function StartupError({ message }: { message: string }) {
  const { retryBootstrap, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.errorScreen}>
      <Text style={styles.errorTitle}>Couldn’t restore your session</Text>
      <Text style={styles.errorMessage}>{actionError ?? message}</Text>
      <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void run(retryBootstrap)}>
        <Text style={styles.primaryButtonText}>{busy ? 'Working…' : 'Retry'}</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => void run(logout)}>
        <Text style={styles.secondaryButtonText}>Forget session and sign in</Text>
      </Pressable>
    </View>
  );
}

function Gate() {
  const { user, bootstrapping, bootstrapError } = useAuth();
  const route = appGate(user, bootstrapping, bootstrapError);
  useEffect(() => {
    console.info(`[LoggeRythm] app gate: ${route}`);
  }, [route]);
  if (route === 'loading') {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  if (route === 'bootstrap-error') return <StartupError message={bootstrapError!} />;
  if (route === 'login') return <LoginScreen />;
  if (route === 'pending') return <PendingApprovalScreen />;
  return <RootNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  errorScreen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 14,
  },
  errorTitle: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  errorMessage: { color: colors.error, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingHorizontal: 28,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#000', fontSize: 15, fontWeight: '700' },
  secondaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  secondaryButtonText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
});
