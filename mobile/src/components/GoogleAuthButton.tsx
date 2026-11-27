import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError } from '../api/client';
import { getAuthProviders } from '../api/endpoints';
import { presentError } from '../auth/presentationError';
import { normalizeSignInApiBase } from '../config';
import { strings } from '../localization';
import { colors, spacing } from '../theme';
import { ActionButton, AppText } from './ui';

export interface GoogleAuthButtonProps {
  serverUrl: string;
  creatingAccount: boolean;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
}

type ProviderLookupState =
  | { server: string; kind: 'hidden' }
  | { server: string; kind: 'ready'; google: boolean }
  | { server: string; kind: 'error'; message: string };

const PROVIDER_DEBOUNCE_MS = 250;

export function GoogleAuthButton({
  serverUrl,
  creatingAccount,
  disabled = false,
  busy = false,
  onPress,
}: GoogleAuthButtonProps) {
  const [state, setState] = useState<ProviderLookupState | null>(null);
  const hasCheckedRef = useRef(false);

  let normalizedServer: string | null = null;
  try {
    normalizedServer = normalizeSignInApiBase(serverUrl);
  } catch {
    normalizedServer = null;
  }

  useEffect(() => {
    if (normalizedServer === null) return undefined;

    const targetServer = normalizedServer;
    const controller = new AbortController();
    const delayMs = hasCheckedRef.current ? PROVIDER_DEBOUNCE_MS : 0;
    hasCheckedRef.current = true;

    const runLookup = () => {
      void getAuthProviders(targetServer, controller.signal)
        .then((providers) => {
          if (controller.signal.aborted) return;
          setState(
            providers.google
              ? { server: targetServer, kind: 'ready', google: true }
              : { server: targetServer, kind: 'hidden' },
          );
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          if (cause instanceof ApiError && cause.status === 404) {
            setState({ server: targetServer, kind: 'hidden' });
            return;
          }
          setState({
            server: targetServer,
            kind: 'error',
            message: presentError(cause, strings.auth.googleProvidersUnavailable).message,
          });
        });
    };

    if (delayMs === 0) {
      runLookup();
      return () => {
        controller.abort();
      };
    }

    const timer = setTimeout(runLookup, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedServer]);

  if (normalizedServer === null || state === null || state.server !== normalizedServer) {
    return null;
  }

  if (state.kind === 'hidden') return null;

  if (state.kind === 'error') {
    return (
      <AppText
        testID="google-auth-provider-error"
        variant="caption"
        color="danger"
        align="center"
        accessibilityRole="alert"
      >
        {state.message}
      </AppText>
    );
  }

  if (!state.google) return null;

  const label = creatingAccount
    ? strings.auth.registerWithGoogle
    : strings.auth.continueWithGoogle;

  return (
    <View style={styles.container}>
      <View style={styles.dividerRow} accessible={false} importantForAccessibility="no-hide-descendants">
        <View style={styles.dividerLine} />
        <AppText variant="caption" color="muted">
          {strings.auth.orDivider}
        </AppText>
        <View style={styles.dividerLine} />
      </View>
      <ActionButton
        testID="google-auth-submit"
        label={label}
        accessibilityLabel={label}
        icon="google"
        variant="secondary"
        fullWidth
        busy={busy}
        disabled={disabled}
        onPress={onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.hairline,
  },
});
