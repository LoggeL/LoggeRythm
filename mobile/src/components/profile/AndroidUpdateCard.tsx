import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, View } from 'react-native';
import { getActiveLocale, strings, type AppLocale } from '../../localization';
import { colors, radii, spacing } from '../../theme';
import type { AppIconName } from '../AppIcon';
import { ActionButton, AppText, ErrorState } from '../ui';
import { AndroidReleaseLink } from './AndroidReleaseLink';
import { ProfileGroup } from './ProfileGroup';
import {
  androidUpdateResultCheckedAt,
  androidUpdateStore,
  availableAndroidUpdate,
  currentAndroidUpdateResult,
  useAndroidUpdateSnapshot,
  visibleAndroidUpdateStartupNotes,
  type AndroidInstalledDisplay,
  type AndroidUpdateInstallState,
  type AndroidUpdateSnapshot,
  type AndroidUpdateStartupPhase,
} from '../../update/androidUpdateStore';
import { announceAndroidUpdateCheckOutcomes } from '../../update/checkAnnouncement';
import {
  formatAndroidUpdateBytes,
  presentAndroidUpdateDownloadProgress,
  type AndroidUpdateDownloadProgress,
} from '../../update/downloadProgress';
import type { AndroidUpdateCheck, AndroidUpdateRelease } from '../../update/githubReleaseUpdater';
import {
  androidFinalFailureCause,
  androidInstallFailureIsFinal,
  type AndroidUpdateFailure,
} from '../../update/updateErrors';
import {
  androidInstalledNewerCase,
  androidUpdateStartupPhaseLabel,
  androidUpdateStartupStep,
  describeAndroidUpdateFailure,
  formatAndroidReleaseDate,
  formatAndroidUpdateCheckedAt,
  type AndroidInstalledNewerResult,
} from '../../update/updatePresentation';

function AndroidUpdateProgress({
  progress,
}: {
  progress: AndroidUpdateDownloadProgress | null;
}) {
  const presentation = presentAndroidUpdateDownloadProgress(progress, getActiveLocale());
  // No live region: progress events arrive many times a second, and TalkBack
  // would queue an announcement for each. The bar exposes its value on focus;
  // the "downloading" line above announces the start once.
  // One focus stop: a static label, the progress only as the value, and the
  // visible text hidden from TalkBack so nothing is read twice.
  return (
    <View
      testID="android-update-progress"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={strings.profile.update.progressLabel}
      accessibilityState={{ busy: true }}
      accessibilityValue={presentation.percent === null || presentation.total === null
        ? { text: presentation.accessibilityValueText }
        : {
          min: 0,
          max: 100,
          now: presentation.percent,
          text: presentation.accessibilityValueText,
        }}
      style={styles.block}
    >
      {presentation.percent === null ? (
        <View style={styles.statusRow}>
          <ActivityIndicator accessible={false} color={colors.accent} size="small" />
          <AppText
            testID="android-update-progress-text"
            variant="callout"
            color="secondary"
            accessible={false}
            importantForAccessibility="no"
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
          <AppText
            testID="android-update-progress-text"
            variant="caption"
            color="secondary"
            accessible={false}
            importantForAccessibility="no"
          >
            {presentation.visibleText}
          </AppText>
        </>
      )}
    </View>
  );
}

function StatusRow({ testID, text }: { testID: string; text: string }) {
  return (
    <View style={styles.statusRow}>
      <ActivityIndicator accessible={false} color={colors.accent} size="small" />
      <AppText
        testID={testID}
        variant="callout"
        color="secondary"
        accessibilityLiveRegion="polite"
        style={styles.statusText}
      >
        {text}
      </AppText>
    </View>
  );
}

/** `detailBelow`: the ErrorState shows the detail under the message; a note does not. */
function describeFailure(
  failure: AndroidUpdateFailure,
  phase: 'check' | 'install',
  releaseVersion: string | null,
  installed: AndroidInstalledDisplay | null,
  detailBelow: boolean,
) {
  return describeAndroidUpdateFailure(failure, {
    phase,
    releaseVersion,
    installedBuild: installed === null ? null : installed.versionCode,
    installedVersion: installed === null ? null : installed.versionName,
    detailBelow,
  });
}

function UpdateFailure({
  failure,
  phase,
  releaseVersion,
  installed,
  retry,
  hint,
}: {
  failure: AndroidUpdateFailure;
  phase: 'check' | 'install';
  releaseVersion: string | null;
  installed: AndroidInstalledDisplay | null;
  /** null when retrying cannot help or another step is still running. */
  retry: { label: string; onPress: () => void } | null;
  /** Why no retry is offered, shown under the detail. */
  hint?: string;
}) {
  const presentation = describeFailure(failure, phase, releaseVersion, installed, true);
  return (
    <View style={styles.block}>
      <ErrorState
        testID="android-update-error"
        retryTestID="android-update-retry"
        layout="inline"
        kind={failure.code === 'network' ? 'offline' : 'error'}
        title={presentation.title}
        message={presentation.message}
        retryLabel={retry === null ? undefined : retry.label}
        onRetry={retry === null ? undefined : retry.onPress}
      />
      <AppText testID="android-update-error-detail" variant="caption" color="muted" selectable>
        {presentation.detail}
      </AppText>
      {hint !== undefined ? (
        <AppText testID="android-update-final-hint" variant="caption" color="secondary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * A failed check next to a failed install: the install failure keeps the one
 * ErrorState, the check failure folds into a muted line with its raw detail.
 * No ErrorState announces it, so the line is a polite live region: TalkBack
 * still hears that the check failed (the install ErrorState is assertive).
 */
function CheckFailureNote({
  failure,
  installed,
}: {
  failure: AndroidUpdateFailure;
  installed: AndroidInstalledDisplay | null;
}) {
  const presentation = describeFailure(failure, 'check', null, installed, false);
  return (
    <AppText
      testID="android-update-check-failure"
      variant="caption"
      color="muted"
      selectable
      accessibilityLiveRegion="polite"
    >
      {`${presentation.title}: ${presentation.message} ${presentation.detail}`}
    </AppText>
  );
}

/**
 * A failure no other part of the card shows: an installer outcome (or a
 * failure of the outcome channel) that names no build while no release card
 * could take it, or a startup failure the short startup toast pointed here
 * for. A muted line with the phase, the localized cause and the raw detail,
 * without an ErrorState or a retry.
 */
function FailureNote({
  testID,
  phase,
  failure,
  installed,
}: {
  testID: string;
  phase: AndroidUpdateStartupPhase;
  failure: AndroidUpdateFailure;
  installed: AndroidInstalledDisplay | null;
}) {
  const presentation = describeFailure(failure, androidUpdateStartupStep(phase), null, installed, false);
  return (
    <AppText testID={testID} variant="caption" color="muted" selectable>
      {`${androidUpdateStartupPhaseLabel(phase)}: ${presentation.message} ${presentation.detail}`}
    </AppText>
  );
}

/**
 * The progress report broke, but the verified APK still reached Android's
 * installer: nothing failed, so no ErrorState and no retry, only a muted line
 * that keeps the raw cause visible.
 */
function ProgressWarning({ warning }: { warning: AndroidUpdateFailure }) {
  const update = strings.profile.update;
  return (
    <AppText testID="android-update-progress-warning" variant="caption" color="muted" selectable>
      {`${update.progressWarning} ${update.detail(warning.code ?? 'error', warning.message)}`}
    </AppText>
  );
}

/** Installing this release again cannot succeed (bad APK, device policy…). */
function installFailedForGood(state: AndroidUpdateInstallState): boolean {
  return state.kind === 'failed' && androidInstallFailureIsFinal(state.failure);
}

function InstalledVersion({
  installed,
  updatedTo,
}: {
  installed: AndroidInstalledDisplay | null;
  updatedTo: string | null;
}) {
  const update = strings.profile.update;
  return (
    <>
      {installed ? (
        <View style={styles.version}>
          <AppText testID="android-update-installed-version" variant="bodyStrong">
            {update.installedVersion(installed.versionName)}
          </AppText>
          <AppText testID="android-update-installed-build" variant="caption" color="muted">
            {update.installedBuild(installed.versionCode)}
          </AppText>
        </View>
      ) : null}
      {updatedTo !== null ? (
        <AppText
          testID="android-update-updated-to"
          variant="callout"
          color="success"
          accessibilityLiveRegion="polite"
        >
          {update.updatedTo(updatedTo)}
        </AppText>
      ) : null}
    </>
  );
}

function install() {
  void androidUpdateStore.install();
}

function recheck() {
  void androidUpdateStore.check('manual');
}

function ReleaseOffer({
  snapshot,
  release,
  locale,
}: {
  snapshot: AndroidUpdateSnapshot;
  release: AndroidUpdateRelease;
  locale: AppLocale;
}) {
  const update = strings.profile.update;
  const installed = snapshot.installed;
  if (installed === null) {
    throw new Error(
      `Android update ${release.versionName} is offered, but the installed build was never read`,
    );
  }
  const size = formatAndroidUpdateBytes(release.apkSize, locale);
  const state = snapshot.install;
  const installBusy = state.kind === 'preparing' || state.kind === 'downloading';
  const uninstallable = installFailedForGood(state);

  return (
    <>
      <View style={styles.block}>
        {uninstallable ? (
          // The release's facts stay; the accent "from → to" would promise an install.
          <AppText testID="android-update-release-version" variant="bodyStrong">
            {update.releaseVersion(release.versionName)}
          </AppText>
        ) : (
          <AppText testID="android-update-available" variant="bodyStrong" color="accent">
            {update.transition(installed.versionName, release.versionName)}
          </AppText>
        )}
        <AppText testID="android-update-available-meta" variant="caption" color="secondary">
          {update.availableMeta(size, formatAndroidReleaseDate(release.publishedAt, locale))}
        </AppText>
      </View>
      {release.summary !== null ? (
        <View style={styles.block}>
          <AppText variant="overline" color="muted">{update.notesLabel}</AppText>
          <AppText testID="android-update-release-notes" variant="callout" numberOfLines={3}>
            {release.summary}
          </AppText>
        </View>
      ) : null}
      {state.kind === 'preparing' ? (
        <StatusRow testID="android-update-preparing" text={update.preparing} />
      ) : null}
      {state.kind === 'downloading' ? (
        <View style={styles.block}>
          <AppText
            testID="android-update-downloading"
            variant="callout"
            color="secondary"
            accessibilityLiveRegion="polite"
          >
            {update.downloading(release.versionName)}
          </AppText>
          <AndroidUpdateProgress progress={state.progress} />
        </View>
      ) : null}
      {state.kind === 'awaiting-confirmation' ? (
        <View style={styles.block}>
          <AppText
            testID="android-update-submitted"
            variant="callout"
            color="success"
            accessibilityLiveRegion="assertive"
          >
            {update.confirm(release.versionName)}
          </AppText>
          <AppText variant="caption" color="muted">{update.confirmHint}</AppText>
          {state.warning !== undefined ? <ProgressWarning warning={state.warning} /> : null}
        </View>
      ) : null}
      {state.kind === 'permission' ? (
        <AppText
          testID="android-update-permission"
          variant="callout"
          color="warning"
          accessibilityRole="alert"
        >
          {update.permission}
        </AppText>
      ) : null}
      {state.kind === 'failed' ? (
        // A final failure (bad signature, digest, version, device policy…)
        // fails the same way on every retry: no retry, a hint and the release
        // link below.
        uninstallable ? (
          <UpdateFailure
            failure={state.failure}
            phase="install"
            releaseVersion={release.versionName}
            installed={installed}
            retry={null}
            hint={update.finalFailureHint[androidFinalFailureCause(state.failure)]}
          />
        ) : (
          <UpdateFailure
            failure={state.failure}
            phase="install"
            releaseVersion={release.versionName}
            installed={installed}
            retry={{ label: update.retryInstall, onPress: install }}
          />
        )
      ) : null}
      {state.kind === 'idle' || state.kind === 'permission' || installBusy ? (
        <ActionButton
          testID="android-update-install"
          variant="accent"
          icon="download"
          label={state.kind === 'permission' ? update.permissionContinue : update.install(size)}
          busy={installBusy}
          fullWidth
          onPress={install}
        />
      ) : null}
      {state.kind === 'awaiting-confirmation' ? (
        <ActionButton
          testID="android-update-restart"
          variant="ghost"
          icon="restart"
          label={update.restartInstall}
          style={styles.inlineAction}
          onPress={install}
        />
      ) : null}
      <AndroidReleaseLink
        testID="android-update-release-link"
        // An uninstallable release has nothing to install: the link leads to
        // the release page that explains why, not to a changelog.
        label={uninstallable ? update.viewRelease : update.releaseLink}
        url={release.releaseUrl}
      />
    </>
  );
}

const LAST_CHECKED_REFRESH_MS = 60 * 1000;

function LastChecked({ checkedAt, locale }: { checkedAt: number; locale: AppLocale }) {
  const [now, setNow] = useState(() => Date.now());
  // "vor 5 Min." keeps counting while the profile stays open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), LAST_CHECKED_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <AppText testID="android-update-last-checked" variant="caption" color="muted">
      {strings.profile.update.lastChecked(formatAndroidUpdateCheckedAt(checkedAt, now, locale))}
    </AppText>
  );
}

/**
 * Why the latest release is not offered, and a hint. An equal build number is
 * not "newer": the release most likely declares the wrong Android-Versioncode,
 * so its hint points there instead of to a development build. The case comes
 * from `androidInstalledNewerCase`, the same decision the announcement reads.
 */
function installedNewerText(result: AndroidInstalledNewerResult): { text: string; hint: string } {
  const update = strings.profile.update;
  const decision = androidInstalledNewerCase(result);
  switch (decision.kind) {
    case 'newer-name':
      return { text: update.installedNewerName(result.latestVersion), hint: update.installedNewerHint };
    case 'same-build':
      return {
        text: update.installedSameBuild(result.latestVersion, decision.latestVersionCode),
        hint: update.installedSameBuildHint,
      };
    case 'newer-build':
      return {
        text: update.installedNewerBuild(
          result.installed.versionCode,
          result.latestVersion,
          decision.latestVersionCode,
        ),
        hint: update.installedNewerHint,
      };
  }
}

function CheckResult({
  result,
  checkedAt,
  locale,
}: {
  result: AndroidUpdateCheck;
  checkedAt: number | null;
  locale: AppLocale;
}) {
  const update = strings.profile.update;
  // Keyed by the check time: a newer check remounts it and reads the clock again.
  // In between it refreshes itself every minute.
  const lastChecked = checkedAt === null
    ? null
    : <LastChecked key={checkedAt} checkedAt={checkedAt} locale={locale} />;
  if (result.kind === 'up-to-date') {
    return (
      <View style={styles.block}>
        <AppText testID="android-update-current" variant="callout" color="success">
          {update.upToDate}
        </AppText>
        {lastChecked}
      </View>
    );
  }
  if (result.kind === 'installed-newer') {
    const explanation = installedNewerText(result);
    return (
      <>
        <View style={styles.block}>
          <AppText testID="android-update-installed-newer" variant="callout" color="warning">
            {explanation.text}
          </AppText>
          <AppText testID="android-update-installed-newer-hint" variant="caption" color="muted">
            {explanation.hint}
          </AppText>
          {lastChecked}
        </View>
        <AndroidReleaseLink
          testID="android-update-release-link"
          label={update.viewRelease}
          url={result.releaseUrl}
        />
      </>
    );
  }
  // An 'available' result is shown as the release offer, never here.
  return null;
}

function cardHeader(
  release: AndroidUpdateRelease | null,
  result: AndroidUpdateCheck | null,
  uninstallable: boolean,
): { icon: AppIconName; title: string } {
  const update = strings.profile.update;
  if (release !== null && uninstallable) {
    return { icon: 'alert-octagon-outline', title: update.titleUninstallable };
  }
  if (release !== null) return { icon: 'cellphone-arrow-down', title: update.titleAvailable };
  if (result?.kind === 'installed-newer') return { icon: 'flask-outline', title: update.titleVersion };
  return { icon: 'cellphone-check', title: update.titleVersion };
}

export interface AndroidUpdateCardProps {
  /** Optional guard suppressing duplicate announcements while a parent screen is covered. */
  shouldAnnounce?: () => boolean;
}

/**
 * The app's own version and its update state, read from the shared Android
 * update store. Opening the profile asks the store for a check; the store
 * skips a fresh result and joins one already running. The profile mounts it
 * once per visit, in the slot `useAndroidUpdatePlacement` latched; the card
 * renders in every state there (nothing off Android).
 */
export default function AndroidUpdateCard({
  shouldAnnounce,
}: AndroidUpdateCardProps = {}) {
  const snapshot = useAndroidUpdateSnapshot();

  useEffect(() => {
    // Subscribed before the profile check, so its outcome is announced too;
    // a result that was already there when the profile opened is not.
    const stopAnnouncing = announceAndroidUpdateCheckOutcomes(
      androidUpdateStore,
      (text) => {
        if (shouldAnnounce?.() !== false) {
          AccessibilityInfo.announceForAccessibility(text);
        }
      },
    );
    void androidUpdateStore.check('profile');
    return () => {
      stopAnnouncing();
      // Leaving the profile acknowledges a final failure of this process: the
      // next visit shows it at the bottom, without the header dot.
      androidUpdateStore.acknowledgeFinalFailure();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount lifecycle owns check & acknowledgment
  }, []);

  if (!snapshot.supported) return null;

  const locale = getActiveLocale();
  const update = strings.profile.update;
  const check = snapshot.check;
  const release = availableAndroidUpdate(snapshot);
  // A failed check shows its failure, not the older result it replaced;
  // the re-check after it shows that older result again, dated by its own check.
  const result = check.kind === 'failed' ? null : currentAndroidUpdateResult(snapshot);
  const installKind = snapshot.install.kind;
  // A running download blocks a re-check; the Android dialog does not, so a
  // dismissed dialog never leaves the card stuck.
  const installBusy = installKind === 'preparing' || installKind === 'downloading';
  // Two failures never stack two ErrorStates: the install failure keeps it.
  const checkFailureFolded = check.kind === 'failed' && installKind === 'failed';
  const uninstallable = installFailedForGood(snapshot.install);
  const header = cardHeader(release, result, uninstallable);
  const recheckButton = (
    <ActionButton
      testID="android-update-recheck"
      variant="ghost"
      icon="refresh"
      label={update.recheck}
      busy={check.kind === 'checking'}
      disabled={installBusy}
      style={styles.inlineAction}
      onPress={recheck}
    />
  );

  return (
    <ProfileGroup testID="android-update-card" icon={header.icon} title={header.title}>
      <InstalledVersion installed={snapshot.installed} updatedTo={snapshot.updatedTo} />
      {check.kind === 'checking' ? (
        <StatusRow testID="android-update-checking" text={update.checking} />
      ) : null}
      {release !== null ? (
        <ReleaseOffer snapshot={snapshot} release={release} locale={locale} />
      ) : result !== null ? (
        <CheckResult
          result={result}
          checkedAt={androidUpdateResultCheckedAt(snapshot)}
          locale={locale}
        />
      ) : null}
      {visibleAndroidUpdateStartupNotes(snapshot).map((note, index) => (
        <FailureNote
          // Notes have no identity of their own, and two may be equal.
          key={`${note.phase}-${index}`}
          testID="android-update-startup-note"
          phase={note.phase}
          failure={note.failure}
          installed={snapshot.installed}
        />
      ))}
      {snapshot.orphanedInstallFailure !== null ? (
        <FailureNote
          testID="android-update-orphaned-failure"
          phase={snapshot.orphanedInstallFailure.phase}
          failure={snapshot.orphanedInstallFailure.failure}
          installed={snapshot.installed}
        />
      ) : null}
      {check.kind === 'failed' && checkFailureFolded ? (
        <>
          <CheckFailureNote failure={check.failure} installed={snapshot.installed} />
          {recheckButton}
        </>
      ) : check.kind === 'failed' ? (
        <UpdateFailure
          failure={check.failure}
          phase="check"
          releaseVersion={null}
          installed={snapshot.installed}
          // Same rule as the ghost re-check: no retry while a download runs.
          retry={installBusy ? null : { label: update.recheck, onPress: recheck }}
        />
      ) : recheckButton}
      {release !== null && !uninstallable ? (
        // What gets verified before an install; nothing will be installed here.
        <AppText variant="caption" color="muted">{update.safety}</AppText>
      ) : null}
    </ProfileGroup>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.xs },
  version: { gap: spacing.xxs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { flex: 1 },
  inlineAction: { alignSelf: 'flex-start' },
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
