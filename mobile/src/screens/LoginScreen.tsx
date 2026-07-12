import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.logo}>LoggeRythm</Text>
        <Text style={styles.subtitle}>Sign in to your library</Text>

        <TextInput
          testID="login-email"
          accessibilityLabel="Email address"
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          autoComplete="email"
        />
        <TextInput
          testID="login-password"
          accessibilityLabel="Password"
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textDim}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          returnKeyType="done"
          onSubmitEditing={() => void onSubmit()}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          testID="login-submit"
          accessibilityLabel="Sign in"
          accessibilityRole="button"
          style={[
            styles.button,
            (busy || !email.trim() || !password) && styles.buttonDisabled,
          ]}
          onPress={onSubmit}
          disabled={busy || !email.trim() || !password}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 },
  card: { gap: 12 },
  logo: { color: colors.accent, fontSize: 34, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: colors.textDim, fontSize: 15, textAlign: 'center', marginBottom: 12 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { color: colors.error, fontSize: 13 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
