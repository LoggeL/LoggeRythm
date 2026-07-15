import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { buildRegisterRequest } from '../auth/registration';
import { colors } from '../theme';

type AuthMode = 'sign-in' | 'create-account';

export default function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    let action: () => Promise<void>;
    if (mode === 'sign-in') {
      const normalizedEmail = email.trim();
      if (!normalizedEmail || !password) {
        setError('Email and password are required');
        return;
      }
      action = () => login(normalizedEmail, password);
    } else {
      try {
        const request = buildRegisterRequest({
          displayName,
          email,
          password,
          confirmPassword,
          invite,
        });
        action = () => register(request);
      } catch (cause) {
        setError((cause as Error).message);
        return;
      }
    }

    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changeMode = () => {
    setMode((current) => (current === 'sign-in' ? 'create-account' : 'sign-in'));
    setError(null);
  };

  const requiredMissing =
    !email.trim() || !password || (mode === 'create-account' && !confirmPassword);
  const creatingAccount = mode === 'create-account';
  const submitLabel = creatingAccount ? 'Create account' : 'Sign in';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.logo}>LoggeRythm</Text>
          <Text style={styles.subtitle}>
            {creatingAccount ? 'Create your account' : 'Sign in to your library'}
          </Text>

          {creatingAccount && (
            <TextInput
              testID="register-display-name"
              accessibilityLabel="Display name, optional"
              style={styles.input}
              placeholder="Display name (optional)"
              placeholderTextColor={colors.textDim}
              value={displayName}
              onChangeText={setDisplayName}
              autoComplete="name"
              returnKeyType="next"
            />
          )}
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
            returnKeyType="next"
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
            autoComplete={creatingAccount ? 'new-password' : 'current-password'}
            returnKeyType={creatingAccount ? 'next' : 'done'}
            onSubmitEditing={creatingAccount ? undefined : () => void onSubmit()}
          />
          {creatingAccount && (
            <>
              <TextInput
                testID="register-confirm-password"
                accessibilityLabel="Confirm password"
                style={styles.input}
                placeholder="Confirm password"
                placeholderTextColor={colors.textDim}
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoComplete="new-password"
                returnKeyType="next"
              />
              <TextInput
                testID="register-invite"
                accessibilityLabel="Invite code, optional"
                style={styles.input}
                placeholder="Invite code (optional)"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                value={invite}
                onChangeText={setInvite}
                returnKeyType="done"
                onSubmitEditing={() => void onSubmit()}
              />
            </>
          )}

          {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}

          <Pressable
            testID={creatingAccount ? 'register-submit' : 'login-submit'}
            accessibilityLabel={submitLabel}
            accessibilityRole="button"
            style={[styles.button, (busy || requiredMissing) && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={busy || requiredMissing}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.buttonText}>{submitLabel}</Text>
            )}
          </Pressable>

          <Pressable
            testID="auth-mode-toggle"
            accessibilityLabel={creatingAccount ? 'Sign in instead' : 'Create an account'}
            accessibilityRole="button"
            style={styles.modeToggle}
            onPress={changeMode}
            disabled={busy}
          >
            <Text style={styles.modeToggleText}>
              {creatingAccount ? 'Already have an account? Sign in' : 'New here? Create account'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
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
  modeToggle: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  modeToggleText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
});
