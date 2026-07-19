import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getActiveLocale, strings } from '../../localization';
import { colors, metrics } from '../../theme';
import {
  androidUpdater,
  checkForAndroidUpdate,
  subscribeAndroidUpdateDownloadProgress,
  type AndroidUpdateCheck,
  type AndroidUpdateDownloadProgress,
} from '../../update/githubReleaseUpdater';
import { presentAndroidUpdateDownloadProgress } from '../../update/downloadProgress';

type UpdateCardState =
  | { kind: 'checking' }
  | { kind: 'ready'; result: AndroidUpdateCheck }
  | { kind: 'permission'; result: Extract<AndroidUpdateCheck, { kind: 'available' }> }
  | {
    kind: 'installing';
    result: Extract<AndroidUpdateCheck, { kind: 'available' }>;
    progress: AndroidUpdateDownloadProgress | null;
  }
  | { kind: 'submitted'; versionName: string }
  | { kind: 'error'; message: string };

function errorMessage(value: unknown): string {
  const detail = value instanceof Error ? value.message : String(value);
  return `${strings.profile.update.failed}: ${detail}`;
}

function AndroidUpdateProgress({
  progress,
}: {
  progress: AndroidUpdateDownloadProgress | null;
}) {
  const presentation = presentAndroidUpdateDownloadProgress(progress, getActiveLocale());
  return (
    <View
      testID="android-update-progress"
      accessibilityRole="progressbar"
      accessibilityLabel={presentation.accessibilityText}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      accessibilityValue={presentation.percent === null || presentation.total === null
        ? { text: presentation.accessibilityText }
        : {
          min: 0,
          max: 100,
          now: presentation.percent,
          text: presentation.accessibilityText,
        }}
      style={styles.progressBox}
    >
      {presentation.percent === null ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.accent} />
          <Text testID="android-update-progress-text" style={styles.body}>
            {presentation.visibleText}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.progressTrack}>
            <View
              testID="android-update-progress-fill"
              style={[styles.progressFill, { width: `${presentation.percent}%` }]}
            />
          </View>
          <Text testID="android-update-progress-text" style={styles.progressText}>
            {presentation.visibleText}
          </Text>
        </>
      )}
    </View>
  );
}

export default function AndroidUpdateCard() {
  const [state, setState] = useState<UpdateCardState>({ kind: 'checking' });
  const checkAttemptRef = useRef(0);
  const installAttemptRef = useRef(0);
  const installingRef = useRef(false);

  const check = useCallback(async () => {
    const attempt = checkAttemptRef.current + 1;
    checkAttemptRef.current = attempt;
    installAttemptRef.current += 1;
    installingRef.current = false;
    setState({ kind: 'checking' });
    try {
      const result = await checkForAndroidUpdate();
      if (checkAttemptRef.current === attempt) setState({ kind: 'ready', result });
    } catch (error) {
      if (checkAttemptRef.current === attempt) {
        setState({ kind: 'error', message: errorMessage(error) });
      }
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    void Promise.resolve().then(check);
    return () => {
      checkAttemptRef.current += 1;
      installAttemptRef.current += 1;
      installingRef.current = false;
    };
  }, [check]);

  if (Platform.OS !== 'android') return null;

  const install = async (
    result: Extract<AndroidUpdateCheck, { kind: 'available' }>,
  ) => {
    if (installingRef.current) return;
    installingRef.current = true;
    const attempt = installAttemptRef.current + 1;
    installAttemptRef.current = attempt;
    let unsubscribe: (() => void) | null = null;
    try {
      const installation = await androidUpdater.getInstallationInfo();
      if (installAttemptRef.current !== attempt) return;
      if (!installation.canRequestPackageInstalls) {
        await androidUpdater.openInstallPermissionSettings();
        if (installAttemptRef.current === attempt) setState({ kind: 'permission', result });
        return;
      }
      setState({ kind: 'installing', result, progress: null });
      unsubscribe = subscribeAndroidUpdateDownloadProgress(
        (progress) => {
          if (installAttemptRef.current !== attempt) return;
          setState((current) => (
            current.kind === 'installing'
              ? { ...current, progress }
              : current
          ));
        },
        () => {
          if (installAttemptRef.current === attempt) {
            setState({
              kind: 'error',
              message: errorMessage(new Error('Android update progress event was invalid')),
            });
          }
        },
      );
      const submitted = await androidUpdater.downloadAndInstall(
        result.release.apkUrl,
        result.release.apkDigest,
        result.release.versionName,
      );
      if (submitted.status !== 'awaiting-user-confirmation') {
        throw new Error(`Unexpected Android installer state: ${submitted.status}`);
      }
      if (installAttemptRef.current === attempt) {
        setState({ kind: 'submitted', versionName: submitted.versionName });
      }
    } catch (error) {
      if (installAttemptRef.current === attempt) {
        setState({ kind: 'error', message: errorMessage(error) });
      }
    } finally {
      unsubscribe?.();
      if (installAttemptRef.current === attempt) installingRef.current = false;
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
          {state.kind === 'installing' ? (
            <AndroidUpdateProgress progress={state.progress} />
          ) : null}
          <Pressable
            testID="android-update-install"
            accessibilityRole="button"
            accessibilityLabel={state.kind === 'installing'
              ? strings.profile.update.downloading
              : state.kind === 'permission'
                ? strings.profile.update.retryInstall
                : strings.profile.update.install}
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
  progressBox: { gap: 8 },
  progressTrack: {
    height: 10,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  progressText: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
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
