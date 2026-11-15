import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { getActiveLocale, strings } from '../../localization';
import { colors, radii, spacing } from '../../theme';
import { ActionButton, AppText, RetryButton } from '../ui';
import { ProfileGroup } from './ProfileGroup';
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
          <ActivityIndicator accessible={false} color={colors.accent} size="small" />
          <AppText
            testID="android-update-progress-text"
            variant="callout"
            color="secondary"
            style={styles.statusText}
          >
            {presentation.visibleText}
          </AppText>
        </View>
      ) : (
        <>
          <View style={styles.progressTrack}>
            <View
              testID="android-update-progress-fill"
              style={[styles.progressFill, { width: `${presentation.percent}%` }]}
            />
          </View>
          <AppText testID="android-update-progress-text" variant="caption" color="secondary">
            {presentation.visibleText}
          </AppText>
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
      // Best effort: when the app is backgrounded during the download, the
      // installer confirmation arrives via a notification — which needs the
      // runtime permission on Android 13+. A denial is a valid user choice;
      // the foreground flow keeps working without it.
      if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        if (installAttemptRef.current !== attempt) return;
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

  const installing = state.kind === 'installing';
  const installLabel = installing
    ? strings.profile.update.downloading
    : state.kind === 'permission'
      ? strings.profile.update.retryInstall
      : strings.profile.update.install;

  return (
    <ProfileGroup
      testID="android-update-card"
      icon="cellphone-arrow-down"
      title={strings.profile.update.title}
    >
      {state.kind === 'checking' ? (
        <View style={styles.statusRow}>
          <ActivityIndicator accessible={false} color={colors.accent} size="small" />
          <AppText
            variant="callout"
            color="secondary"
            accessibilityLiveRegion="polite"
            style={styles.statusText}
          >
            {strings.profile.update.checking}
          </AppText>
        </View>
      ) : null}
      {state.kind === 'ready' && state.result.kind === 'up-to-date' ? (
        <AppText testID="android-update-current" variant="callout" color="secondary">
          {strings.profile.update.current(state.result.installedVersion)}
        </AppText>
      ) : null}
      {available ? (
        <>
          <AppText testID="android-update-available" variant="bodyStrong" color="accent">
            {strings.profile.update.available(
              available.release.versionName,
              Math.ceil(available.release.apkSize / (1024 * 1024)),
            )}
          </AppText>
          {state.kind === 'permission' ? (
            <AppText variant="callout" color="warning" accessibilityRole="alert">
              {strings.profile.update.permission}
            </AppText>
          ) : null}
          {state.kind === 'installing' ? (
            <AndroidUpdateProgress progress={state.progress} />
          ) : null}
          <ActionButton
            testID="android-update-install"
            variant="secondary"
            icon="download"
            label={installLabel}
            busy={installing}
            fullWidth
            onPress={() => void install(available)}
          />
        </>
      ) : null}
      {state.kind === 'submitted' ? (
        <AppText
          testID="android-update-submitted"
          variant="callout"
          color="success"
          accessibilityLiveRegion="assertive"
        >
          {strings.profile.update.confirm(state.versionName)}
        </AppText>
      ) : null}
      {state.kind === 'error' ? (
        <>
          <AppText
            testID="android-update-error"
            variant="callout"
            color="danger"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            {state.message}
          </AppText>
          <RetryButton testID="android-update-retry" onRetry={() => void check()} />
        </>
      ) : null}
      <AppText variant="caption" color="muted">{strings.profile.update.safety}</AppText>
    </ProfileGroup>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { flex: 1 },
  progressBox: { gap: spacing.xs },
  progressTrack: {
    height: spacing.xs,
    overflow: 'hidden',
    borderRadius: radii.pill,
    backgroundColor: colors.fillStrong,
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
});
