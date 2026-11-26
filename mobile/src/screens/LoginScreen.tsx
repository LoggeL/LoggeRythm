import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { isValidEmail, normalizeEmail } from '../auth/email';
import { presentError } from '../auth/presentationError';
import { buildRegisterRequest, RegistrationValidationError } from '../auth/registration';
import { registrationLinkFromUrl } from '../auth/inviteLink';
import AppIcon from '../components/AppIcon';
import AuthBackdrop from '../components/AuthBackdrop';
import BrandLockup from '../components/BrandLockup';
import { FormField, PasswordField } from '../components/FormField';
import { GuestJamEntry } from '../components/party/GuestJamEntry';
import { ActionButton, AppText } from '../components/ui';
import {
  getCurrentApiBase,
  MAX_API_ORIGIN_LENGTH,
  normalizeSignInApiBase,
  PRODUCTION_API_BASE,
} from '../config';
import { strings } from '../localization';
import { colors, layout, metrics, opacity, radii, spacing } from '../theme';
import { authErrorField } from './authErrorField';

type AuthMode = 'sign-in' | 'create-account';

const formGutter = spacing.xl;
/** The form never grows wider than a phone column on tablets and in landscape. */
const FORM_MAX_WIDTH = layout.artwork.hero * 2;

export default function LoginScreen() {
  const { login, register } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [serverUrl, setServerUrl] = useState(getCurrentApiBase());
  const serverUrlRef = useRef(serverUrl);
  const authRequestInFlightRef = useRef(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverSwitchNotice, setServerSwitchNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const applyUrl = (url: string | null) => {
      if (!active || url === null) return;
      const registrationLink = registrationLinkFromUrl(url);
      if (registrationLink === null) return;
      // Never repaint or clear the form for a link while an authentication
      // request is already bound to the currently visible origin. Otherwise a
      // production link could make an in-flight custom-server login appear to
      // have switched destinations even though its response will persist the
      // original custom origin. The link can be opened again after a failure.
      if (authRequestInFlightRef.current) return;
      // A production registration link must not silently send its invite or
      // credentials to a previously selected custom server. The originless app
      // scheme intentionally remains relative to the visible form selection.
      if (registrationLink.source === 'production-https') {
        let switchingServer = true;
        try {
          switchingServer =
            normalizeSignInApiBase(serverUrlRef.current) !== PRODUCTION_API_BASE;
        } catch {
          // An invalid draft is still a different destination and must not keep
          // credentials when a production link replaces it.
        }
        if (switchingServer) {
          setDisplayName('');
          setEmail('');
          setPassword('');
          setConfirmPassword('');
          setInvite('');
        }
        serverUrlRef.current = PRODUCTION_API_BASE;
        setServerUrl(PRODUCTION_API_BASE);
        if (switchingServer) {
          setServerSwitchNotice(strings.auth.productionLinkServerChanged);
          AccessibilityInfo.announceForAccessibility(
            strings.auth.productionLinkServerChanged,
          );
        }
      }
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
    if (authRequestInFlightRef.current) return;
    setError(null);
    let normalizedServer: string;
    try {
      normalizedServer = normalizeSignInApiBase(serverUrlRef.current);
    } catch {
      setError(strings.auth.serverInvalid);
      return;
    }
    serverUrlRef.current = normalizedServer;
    setServerUrl(normalizedServer);
    let action: () => Promise<void>;
    if (mode === 'sign-in') {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || !password) {
        setError(strings.auth.credentialsRequired);
        return;
      }
      if (!isValidEmail(normalizedEmail)) {
        setError(strings.auth.emailInvalid);
        return;
      }
      action = () => login(normalizedEmail, password, normalizedServer);
    } else {
      try {
        const request = buildRegisterRequest({
          displayName,
          email,
          password,
          confirmPassword,
          invite,
        });
        action = () => register(request, normalizedServer);
      } catch (cause) {
        setError(
          cause instanceof RegistrationValidationError
            ? cause.message
            : strings.auth.createAccountFailed,
        );
        return;
      }
    }

    let authenticationCommitted = false;
    authRequestInFlightRef.current = true;
    setBusy(true);
    try {
      await action();
      authenticationCommitted = true;
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
      if (!authenticationCommitted) authRequestInFlightRef.current = false;
      setBusy(false);
    }
  };

  const changeMode = () => {
    setMode((current) => (current === 'sign-in' ? 'create-account' : 'sign-in'));
    setError(null);
    setServerSwitchNotice(null);
  };

  const changeServerUrl = (value: string) => {
    serverUrlRef.current = value;
    setServerUrl(value);
    setServerSwitchNotice(null);
  };

  const requiredMissing =
    !serverUrl.trim() ||
    !email.trim() ||
    !password ||
    (mode === 'create-account' && (!displayName.trim() || !confirmPassword));
  const creatingAccount = mode === 'create-account';
  const submitLabel = creatingAccount ? strings.auth.createAccount : strings.auth.signIn;
  const busyLabel = creatingAccount ? strings.auth.creatingAccount : strings.auth.signingIn;

  // A local validation message belongs under its input; anything else
  // (server responses, link failures) stays in the form-level alert.
  const errorField = authErrorField(error);
  const fieldError = (field: NonNullable<typeof errorField>) =>
    errorField === field ? error : null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AuthBackdrop />
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
          <AppText variant="title" align="center" accessibilityRole="header">{submitLabel}</AppText>

          <View style={styles.fields}>
            <FormField
              testID="login-server"
              label={strings.auth.server}
              accessibilityLabel={strings.auth.server}
              placeholder={strings.auth.serverPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={serverUrl}
              onChangeText={changeServerUrl}
              maxLength={MAX_API_ORIGIN_LENGTH + 1}
              returnKeyType="next"
              editable={!busy}
              error={fieldError('server')}
            />
            <AppText testID="login-server-hint" variant="caption" color="secondary">
              {strings.auth.serverCredentialNotice}
            </AppText>
            {serverSwitchNotice ? (
              <AppText testID="login-server-switch-notice" variant="callout" color="warning">
                {serverSwitchNotice}
              </AppText>
            ) : null}

            {creatingAccount ? (
              <FormField
                testID="register-display-name"
                label={strings.auth.displayName}
                accessibilityLabel={strings.auth.displayName}
                value={displayName}
                onChangeText={setDisplayName}
                autoComplete="name"
                maxLength={120}
                returnKeyType="next"
                editable={!busy}
                error={fieldError('displayName')}
              />
            ) : null}
            <FormField
              testID="login-email"
              label={strings.auth.email}
              accessibilityLabel={strings.auth.email}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              autoComplete="email"
              returnKeyType="next"
              editable={!busy}
              error={fieldError('email')}
            />
            <PasswordField
              testID="login-password"
              label={strings.auth.password}
              accessibilityLabel={strings.auth.password}
              value={password}
              onChangeText={setPassword}
              autoComplete={creatingAccount ? 'new-password' : 'current-password'}
              returnKeyType={creatingAccount ? 'next' : 'done'}
              onSubmitEditing={creatingAccount ? undefined : () => void onSubmit()}
              editable={!busy}
              error={fieldError('password')}
            />
            {creatingAccount ? (
              <>
                <PasswordField
                  testID="register-confirm-password"
                  label={strings.auth.confirmPassword}
                  accessibilityLabel={strings.auth.confirmPassword}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  autoComplete="new-password"
                  returnKeyType="next"
                  editable={!busy}
                  error={fieldError('confirmPassword')}
                />
                <FormField
                  testID="register-invite"
                  label={strings.auth.inviteOptional}
                  accessibilityLabel={strings.auth.inviteOptional}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={invite}
                  onChangeText={setInvite}
                  returnKeyType="done"
                  onSubmitEditing={() => void onSubmit()}
                  editable={!busy}
                />
              </>
            ) : null}
          </View>

          {error !== null && errorField === null ? (
            <View
              testID="auth-error"
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={styles.error}
            >
              <AppIcon name="alert-circle-outline" color={colors.danger} size={20} />
              <AppText variant="callout" color="danger" style={styles.errorText}>{error}</AppText>
            </View>
          ) : null}

          <View style={styles.actions}>
            {busy ? (
              <View
                testID="auth-submit-progress"
                accessibilityRole="progressbar"
                accessibilityLabel={busyLabel}
                accessibilityLiveRegion="polite"
              >
                <AppText variant="callout" color="secondary" align="center">{busyLabel}</AppText>
              </View>
            ) : null}
            <ActionButton
              testID={creatingAccount ? 'register-submit' : 'login-submit'}
              label={submitLabel}
              accessibilityLabel={busy ? busyLabel : submitLabel}
              busy={busy}
              disabled={requiredMissing}
              fullWidth
              onPress={onSubmit}
            />
            <Pressable
              testID="auth-mode-toggle"
              accessibilityLabel={creatingAccount ? strings.auth.signInInstead : strings.auth.createAccountInstead}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [
                styles.modeToggle,
                pressed ? styles.pressed : null,
                busy ? styles.disabled : null,
              ]}
              onPress={changeMode}
              disabled={busy}
            >
              <AppText variant="label" color="accent" align="center">
                {creatingAccount ? strings.auth.existingAccountPrompt : strings.auth.newAccountPrompt}
              </AppText>
            </Pressable>
            <GuestJamEntry serverUrl={serverUrl} disabled={busy} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  card: { gap: spacing.xl, width: '100%', maxWidth: FORM_MAX_WIDTH },
  logo: { alignSelf: 'center' },
  fields: { gap: layout.stackGap },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSubtle,
  },
  errorText: { flex: 1 },
  actions: { gap: spacing.xs },
  modeToggle: {
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
