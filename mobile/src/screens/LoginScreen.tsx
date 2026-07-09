import React, { useEffect, useState } from 'react';
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
import { getApiBase, setApiBase } from '../config';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiBase, setApiBaseInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [configReady, setConfigReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getApiBase()
      .then((base) => {
        if (alive) {
          setApiBaseInput(base);
          setConfigReady(true);
        }
      })
      .catch((cause) => {
        if (alive) setError(`Server configuration could not be loaded: ${(cause as Error).message}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onSubmit = async () => {
    setError(null);
    if (!configReady) {
      setError('Server configuration is still loading');
      return;
    }
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    setBusy(true);
    try {
      await setApiBase(apiBase);
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

        <Pressable onPress={() => setShowAdvanced((s) => !s)}>
          <Text style={styles.advancedToggle}>
            {showAdvanced ? '▾ Server' : '▸ Server'}
          </Text>
        </Pressable>
        {showAdvanced && (
          <TextInput
            style={styles.input}
            placeholder="http://host:8000"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            keyboardType="url"
            value={apiBase}
            onChangeText={setApiBaseInput}
          />
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[
            styles.button,
            (busy || !configReady || !email.trim() || !password) && styles.buttonDisabled,
          ]}
          onPress={onSubmit}
          disabled={busy || !configReady || !email.trim() || !password}
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
  advancedToggle: { color: colors.textDim, fontSize: 13, paddingVertical: 4 },
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
