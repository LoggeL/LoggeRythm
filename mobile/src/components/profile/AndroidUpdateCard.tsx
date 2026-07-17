import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { strings } from '../../localization';
import { colors, metrics } from '../../theme';
import {
  androidUpdater,
  checkForAndroidUpdate,
  type AndroidUpdateCheck,
} from '../../update/githubReleaseUpdater';

type UpdateCardState =
  | { kind: 'checking' }
  | { kind: 'ready'; result: AndroidUpdateCheck }
  | { kind: 'permission'; result: Extract<AndroidUpdateCheck, { kind: 'available' }> }
  | { kind: 'installing'; result: Extract<AndroidUpdateCheck, { kind: 'available' }> }
  | { kind: 'submitted'; versionName: string }
  | { kind: 'error'; message: string };

function errorMessage(value: unknown): string {
  const detail = value instanceof Error ? value.message : String(value);
  return `${strings.profile.update.failed}: ${detail}`;
}

export default function AndroidUpdateCard() {
  const [state, setState] = useState<UpdateCardState>({ kind: 'checking' });

  const check = useCallback(async () => {
    setState({ kind: 'checking' });
    try {
      setState({ kind: 'ready', result: await checkForAndroidUpdate() });
    } catch (error) {
      setState({ kind: 'error', message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    void checkForAndroidUpdate().then(
      (result) => {
        if (active) setState({ kind: 'ready', result });
      },
      (error: unknown) => {
        if (active) setState({ kind: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (Platform.OS !== 'android') return null;

  const install = async (
    result: Extract<AndroidUpdateCheck, { kind: 'available' }>,
  ) => {
    try {
      const installation = await androidUpdater.getInstallationInfo();
      if (!installation.canRequestPackageInstalls) {
        await androidUpdater.openInstallPermissionSettings();
        setState({ kind: 'permission', result });
        return;
      }
      setState({ kind: 'installing', result });
      const submitted = await androidUpdater.downloadAndInstall(
        result.release.apkUrl,
        result.release.apkDigest,
        result.release.versionName,
      );
      if (submitted.status !== 'awaiting-user-confirmation') {
        throw new Error(`Unexpected Android installer state: ${submitted.status}`);
      }
      setState({ kind: 'submitted', versionName: submitted.versionName });
    } catch (error) {
      setState({ kind: 'error', message: errorMessage(error) });
    }
  };

  const available =
    state.kind === 'ready' && state.result.kind === 'available'
      ? state.result
      : state.kind === 'permission' || state.kind === 'installing'
        ? state.result
        : null;

  return (
    <View testID="android-update-card" style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        {strings.profile.update.title}
      </Text>
      {state.kind === 'checking' ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.accent} />
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {strings.profile.update.checking}
          </Text>
        </View>
      ) : null}
      {state.kind === 'ready' && state.result.kind === 'up-to-date' ? (
        <Text testID="android-update-current" style={styles.body}>
          {strings.profile.update.current(state.result.installedVersion)}
        </Text>
      ) : null}
      {available ? (
        <>
          <Text testID="android-update-available" style={styles.body}>
            {strings.profile.update.available(
              available.release.versionName,
              Math.ceil(available.release.apkSize / (1024 * 1024)),
            )}
          </Text>
          {state.kind === 'permission' ? (
            <Text accessibilityRole="alert" style={styles.permission}>
              {strings.profile.update.permission}
            </Text>
          ) : null}
          <Pressable
            testID="android-update-install"
            accessibilityRole="button"
            accessibilityState={{
              disabled: state.kind === 'installing',
              busy: state.kind === 'installing',
            }}
            disabled={state.kind === 'installing'}
            onPress={() => void install(available)}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              state.kind === 'installing' && styles.disabled,
            ]}
          >
            {state.kind === 'installing' ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : null}
            <Text style={styles.primaryText}>
              {state.kind === 'installing'
                ? strings.profile.update.downloading
                : state.kind === 'permission'
                  ? strings.profile.update.retryInstall
                  : strings.profile.update.install}
            </Text>
          </Pressable>
        </>
      ) : null}
      {state.kind === 'submitted' ? (
        <Text
          testID="android-update-submitted"
          accessibilityLiveRegion="assertive"
          style={styles.success}
        >
          {strings.profile.update.confirm(state.versionName)}
        </Text>
      ) : null}
      {state.kind === 'error' ? (
        <>
          <Text
            testID="android-update-error"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={styles.error}
          >
            {state.message}
          </Text>
          <Pressable
            testID="android-update-retry"
            accessibilityRole="button"
            onPress={() => void check()}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>{strings.common.retry}</Text>
          </Pressable>
        </>
      ) : null}
      <Text style={styles.note}>{strings.profile.update.safety}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  body: { flex: 1, color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  permission: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  success: { color: colors.success, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  note: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, opacity: 0.82 },
  primaryButton: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: colors.accent,
  },
  primaryText: { color: colors.onAccent, fontSize: 15, fontWeight: '900' },
  secondaryButton: {
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
