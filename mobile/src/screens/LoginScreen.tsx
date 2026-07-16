import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { presentError } from '../auth/presentationError';
import { buildRegisterRequest, RegistrationValidationError } from '../auth/registration';
import { registrationLinkFromUrl } from '../auth/inviteLink';
import BrandLockup from '../components/BrandLockup';
import { strings } from '../localization';
import { colors, metrics } from '../theme';

type AuthMode = 'sign-in' | 'create-account';

const formGutter = 24;

export default function LoginScreen() {
  const { login, register } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const applyUrl = (url: string | null) => {
      if (!active || url === null) return;
      const registrationLink = registrationLinkFromUrl(url);
      if (registrationLink === null) return;
      if (registrationLink.invite !== null) setInvite(registrationLink.invite);
      setMode('create-account');
      setError(null);
    };
    void Linking.getInitialURL().then(applyUrl).catch((cause) => {
      if (active) setError(presentError(cause, strings.auth.inviteLinkFailed).message);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => applyUrl(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const onSubmit = async () => {
    setError(null);
    let action: () => Promise<void>;
    if (mode === 'sign-in') {
      const normalizedEmail = email.trim();
      if (!normalizedEmail || !password) {
        setError(strings.auth.credentialsRequired);
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
        setError(
          cause instanceof RegistrationValidationError
            ? cause.message
            : strings.auth.createAccountFailed,
        );
        return;
      }
    }

    setBusy(true);
    try {
      await action();
      AccessibilityInfo.announceForAccessibility(
        creatingAccount ? strings.auth.accountCreated : strings.auth.signedIn,
      );
    } catch (cause) {
      setError(
        presentError(
          cause,
          mode === 'create-account' ? strings.auth.createAccountFailed : strings.auth.signInFailed,
        ).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const changeMode = () => {
    setMode((current) => (current === 'sign-in' ? 'create-account' : 'sign-in'));
    setError(null);
  };

  const requiredMissing =
    !email.trim() ||
    !password ||
    (mode === 'create-account' && (!displayName.trim() || !confirmPassword));
  const creatingAccount = mode === 'create-account';
  const submitLabel = creatingAccount ? strings.auth.createAccount : strings.auth.signIn;
  const busyLabel = creatingAccount ? strings.auth.creatingAccount : strings.auth.signingIn;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        testID="auth-scroll"
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: formGutter + insets.top,
            paddingRight: formGutter + insets.right,
            paddingBottom: formGutter + insets.bottom,
            paddingLeft: formGutter + insets.left,
          },
        ]}
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={insets}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
      >
        <View testID="auth-card" style={styles.card}>
          <BrandLockup style={styles.logo} />
          <Text style={styles.subtitle}>
            {creatingAccount ? strings.auth.createAccountSubtitle : strings.auth.signInSubtitle}
          </Text>

          {creatingAccount && (
            <TextInput
              testID="register-display-name"
              accessibilityLabel={strings.auth.displayName}
              style={styles.input}
              placeholder={strings.auth.displayName}
              placeholderTextColor={colors.textSecondary}
              value={displayName}
              onChangeText={setDisplayName}
              autoComplete="name"
              maxLength={120}
              returnKeyType="next"
            />
          )}
          <TextInput
            testID="login-email"
            accessibilityLabel={strings.auth.email}
            style={styles.input}
            placeholder={strings.auth.email}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            autoComplete="email"
            returnKeyType="next"
          />
          <TextInput
            testID="login-password"
            accessibilityLabel={strings.auth.password}
            style={styles.input}
            placeholder={strings.auth.password}
            placeholderTextColor={colors.textSecondary}
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
                accessibilityLabel={strings.auth.confirmPassword}
                style={styles.input}
                placeholder={strings.auth.confirmPassword}
                placeholderTextColor={colors.textSecondary}
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoComplete="new-password"
                returnKeyType="next"
              />
              <TextInput
                testID="register-invite"
                accessibilityLabel={strings.auth.inviteOptional}
                style={styles.input}
                placeholder={strings.auth.inviteOptional}
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                value={invite}
                onChangeText={setInvite}
                returnKeyType="done"
                onSubmitEditing={() => void onSubmit()}
              />
            </>
          )}

          {error && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}

          {busy ? (
            <View
              testID="auth-submit-progress"
              accessibilityRole="progressbar"
              accessibilityLabel={busyLabel}
              accessibilityLiveRegion="polite"
              style={styles.busyStatus}
            >
              <Text style={styles.busyText}>{busyLabel}</Text>
            </View>
          ) : null}

          <Pressable
            testID={creatingAccount ? 'register-submit' : 'login-submit'}
            accessibilityLabel={busy ? busyLabel : submitLabel}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || requiredMissing, busy }}
            style={[styles.button, (busy || requiredMissing) && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={busy || requiredMissing}
          >
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.buttonText}>{submitLabel}</Text>
            )}
          </Pressable>

          <Pressable
            testID="auth-mode-toggle"
            accessibilityLabel={creatingAccount ? strings.auth.signInInstead : strings.auth.createAccountInstead}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            style={styles.modeToggle}
            onPress={changeMode}
            disabled={busy}
          >
            <Text style={styles.modeToggleText}>
              {creatingAccount ? strings.auth.existingAccountPrompt : strings.auth.newAccountPrompt}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  card: { gap: 12, width: '100%', maxWidth: 520 },
  logo: { marginBottom: 4 },
  subtitle: { color: colors.textSecondary, fontSize: 15, textAlign: 'center', marginBottom: 12 },
  input: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { color: colors.danger, fontSize: 13 },
  busyStatus: { minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  busyText: { color: colors.textSecondary, fontSize: 13 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  modeToggle: { minHeight: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  modeToggleText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
});
