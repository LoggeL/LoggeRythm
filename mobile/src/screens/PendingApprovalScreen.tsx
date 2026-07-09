import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme';

export default function PendingApprovalScreen() {
  const { user, refreshUser, logout } = useAuth();
  const [busy, setBusy] = useState<'refresh' | 'logout' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recheck = async () => {
    setBusy('refresh');
    setError(null);
    try {
      await refreshUser();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy('logout');
    setError(null);
    try {
      await logout();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⌛</Text>
      <Text style={styles.title}>Waiting for approval</Text>
      <Text style={styles.body}>
        {user?.email ?? 'This account'} is signed in, but an administrator still needs to approve it.
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        accessibilityRole="button"
        style={styles.primaryButton}
        onPress={() => void recheck()}
        disabled={busy !== null}
      >
        {busy === 'refresh' ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.primaryText}>Check again</Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.secondaryButton}
        onPress={() => void signOut()}
        disabled={busy !== null}
      >
        <Text style={styles.secondaryText}>{busy === 'logout' ? 'Signing out…' : 'Sign out'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    padding: 32,
    gap: 14,
  },
  icon: { fontSize: 42 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.textDim, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  error: { color: colors.error, fontSize: 13, textAlign: 'center' },
  primaryButton: {
    minWidth: 180,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryText: { color: '#000', fontSize: 16, fontWeight: '700' },
  secondaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 24 },
  secondaryText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
});
