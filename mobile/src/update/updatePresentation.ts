import { catalogs, strings, type AppLocale } from '../localization';
import type { AndroidUpdateStartupPhase } from './androidUpdateStore';
import type { AndroidUpdateCheck } from './githubReleaseUpdater';
import type { AndroidUpdateFailure } from './updateErrors';

export interface AndroidUpdateFailurePresentation {
  title: string;
  /**
   * Localized cause. A failure without one (unmapped code, or a mapped cause
   * missing the data it names) says so and points to `detail`; the raw
   * message never stands in for the localized text.
   */
  message: string;
  /** Always the raw code and message, so the real cause stays visible. */
  detail: string;
}

export interface AndroidUpdateFailureContext {
  phase: 'check' | 'install';
  /** The release the failure is about, if known. */
  releaseVersion: string | null;
  /** The installed versionCode, if known. */
  installedBuild: number | null;
  /** The installed versionName as Android reports it, if known. */
  installedVersion?: string | null;
  /**
   * True only where `detail` is shown below the message (the ErrorState):
   * only there may a failure without a localized cause point to it. Toasts
   * and inline notes get the short "unknown error".
   */
  detailBelow: boolean;
}

const DOWNLOAD_CODES = new Set([
  'updater-download-insecure',
  'updater-download-redirect-limit',
  'updater-download-redirect-invalid',
  'updater-download-http',
  'updater-download-too-large',
  'updater-download-incomplete',
  'updater-download-io',
  'updater-download-unreachable',
  'updater-cache-unavailable',
  'updater-cache-cleanup-failed',
  'updater-cache-finalize-failed',
]);

function localizedCause(
  failure: AndroidUpdateFailure,
  context: AndroidUpdateFailureContext,
): string | null {
  const t = strings.profile.update.errors;
  // The failing step knows best which release it was about.
  const version = failure.releaseVersion ?? context.releaseVersion;
  const installedVersion = failure.installedVersion ?? context.installedVersion ?? null;
  switch (failure.code) {
    case 'network':
      return t.network;
    case 'github-rate-limited':
      return failure.httpStatus === null ? null : t.rateLimited(failure.httpStatus);
    case 'github-http':
      return failure.httpStatus === null ? null : t.http(failure.httpStatus);
    case 'release-version-code-missing':
      return version === null ? null : t.releaseVersionCodeMissing(version);
    case 'release-version-code-ambiguous':
      return version === null ? null : t.releaseVersionCodeAmbiguous(version);
    case 'release-invalid':
    // The release's declared data, rejected natively before the download.
    case 'updater-version-code-invalid':
    case 'updater-version-invalid':
    case 'updater-digest-invalid':
    case 'updater-url-invalid':
    case 'updater-url-host-rejected':
    case 'updater-url-release-rejected':
      return t.releaseInvalid;
    case 'installed-version-invalid':
      return installedVersion === null ? null : t.installedVersionInvalid(installedVersion);
    case 'update-marker-invalid':
    // The stored installer outcome was corrupt; native cleared it.
    case 'updater-install-outcome-invalid':
      return t.markerInvalid;
    case 'updater-package-mismatch':
      return t.packageMismatch;
    case 'updater-apk-invalid':
    case 'updater-apk-version-missing':
      return t.apkInvalid;
    case 'updater-install-permission-required':
      return t.permissionRequired;
    case 'updater-digest-mismatch':
      return t.digestMismatch;
    case 'updater-signature-mismatch':
    case 'updater-signature-missing':
      return t.signatureMismatch;
    case 'updater-apk-not-newer':
      return version === null || context.installedBuild === null
        ? null
        : t.apkNotNewer(version, context.installedBuild);
    case 'updater-apk-version-mismatch':
      return version === null ? null : t.apkVersionMismatch(version);
    case 'updater-apk-version-code-mismatch':
      return version === null ? null : t.apkVersionCodeMismatch(version);
    case 'updater-install-busy':
      return t.installBusy;
    case 'updater-install-session-failed':
    case 'updater-install-commit-failed':
      return t.installSession;
    // Reported after the Android installer finished; Android's own status
    // message and code stay in the detail.
    case 'updater-install-aborted':
      return t.installAborted;
    case 'updater-install-failed':
      return t.installRejected;
    // Final installer outcomes: the same release fails the same way again.
    case 'updater-install-incompatible':
      return t.installIncompatible;
    case 'updater-install-blocked':
      return t.installBlocked;
    case 'updater-install-conflict':
      return t.installConflict;
    case 'updater-install-confirmation-blocked':
      return t.confirmationBlocked;
    case 'updater-install-outcome-unsaved':
      return t.outcomeUnsaved;
    case 'updater-install-settings-unavailable':
      return t.permissionSettingsUnavailable;
    case 'updater-installed-package-missing':
    case 'updater-installed-version-missing':
      return t.installedUnreadable;
    case 'updater-module-invalidated':
      return t.moduleInvalidated;
    case 'updater-locale-invalid':
    case 'updater-locale-unsaved':
      return t.appLocale;
    default:
      return failure.code !== null && DOWNLOAD_CODES.has(failure.code) ? t.download : null;
  }
}

export function describeAndroidUpdateFailure(
  failure: AndroidUpdateFailure,
  context: AndroidUpdateFailureContext,
): AndroidUpdateFailurePresentation {
  const update = strings.profile.update;
  return {
    title: context.phase === 'check' ? update.checkFailedTitle : update.installFailedTitle,
    message:
      localizedCause(failure, context) ??
      (context.detailBelow ? update.errors.unknown : update.errors.unknownShort),
    detail: update.detail(failure.code ?? 'error', failure.message),
  };
}

/** How a startup failure is named: in the startup toast and as the card's note. */
export function androidUpdateStartupPhaseLabel(phase: AndroidUpdateStartupPhase): string {
  const labels = strings.profile.update.startupPhase;
  switch (phase) {
    case 'check':
      return labels.check;
    case 'pending-install':
      return labels.pendingInstall;
    case 'install-outcome':
      return labels.installOutcome;
    case 'install-outcome-unavailable':
      return labels.installOutcomeUnavailable;
    case 'app-locale':
      return labels.appLocale;
  }
}

export type AndroidInstalledNewerResult = Extract<AndroidUpdateCheck, { kind: 'installed-newer' }>;

/**
 * Why the latest release is not offered when the installation counts as
 * newer. The profile card and the TalkBack announcement both read this one
 * decision, so what is shown and what is heard cannot drift apart.
 * `same-build`: the release declares the installed build's own number, so it
 * is not newer, only not installable (most likely a wrong
 * "Android-Versioncode" line). `newer-build`: the installed build number is
 * higher than the release's. `newer-name`: a development build of an
 * upcoming version.
 */
export type AndroidInstalledNewerCase =
  | { kind: 'newer-name' }
  | { kind: 'same-build'; latestVersionCode: number }
  | { kind: 'newer-build'; latestVersionCode: number };

export function androidInstalledNewerCase(result: AndroidInstalledNewerResult): AndroidInstalledNewerCase {
  if (result.reason === 'newer-name') return { kind: 'newer-name' };
  if (result.latestVersionCode === null) {
    throw new Error(
      `Installed-newer result for release ${result.latestVersion} has no release versionCode`,
    );
  }
  return result.latestVersionCode === result.installed.versionCode
    ? { kind: 'same-build', latestVersionCode: result.latestVersionCode }
    : { kind: 'newer-build', latestVersionCode: result.latestVersionCode };
}

/** Longest startup toast that still fits the two lines Android 12+ shows. */
export const ANDROID_UPDATE_STARTUP_TOAST_MAX_LENGTH = 70;

/**
 * The startup failure toast: phase and a pointer to the profile, nothing
 * else. Android 12+ cuts a text toast after two lines, so the localized cause
 * and the raw detail stay on the profile card, which shows every startup
 * failure (the store's check failure, install card or `startupNotes`).
 */
export function androidUpdateStartupFailureToast(phase: AndroidUpdateStartupPhase): string {
  return strings.profile.update.startupFailureToast(androidUpdateStartupPhaseLabel(phase));
}

/**
 * The step a startup failure belongs to: the installer's outcome, its channel
 * and the language of the installer's notices are about installing, the
 * others about checking.
 */
export function androidUpdateStartupStep(phase: AndroidUpdateStartupPhase): 'check' | 'install' {
  return phase === 'install-outcome' || phase === 'install-outcome-unavailable' || phase === 'app-locale'
    ? 'install'
    : 'check';
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function intlLocale(locale: AppLocale): string {
  return locale === 'de' ? 'de-DE' : 'en-US';
}

/** "gerade eben", "vor 5 Min.", "heute, 14:05" or "17. November, 14:05". */
export function formatAndroidUpdateCheckedAt(
  checkedAt: number,
  now: number,
  locale: AppLocale,
): string {
  if (!Number.isFinite(checkedAt) || !Number.isFinite(now)) {
    throw new Error(`Update check time ${checkedAt} or current time ${now} is not a finite timestamp`);
  }
  // The caller's locale, not the process-wide one, so text and date formats always agree.
  const update = catalogs[locale].profile.update;
  const age = Math.max(0, now - checkedAt);
  if (age < MINUTE_MS) return update.justNow;
  if (age < HOUR_MS) return update.minutesAgo(Math.floor(age / MINUTE_MS));
  const checked = new Date(checkedAt);
  // de "14:05", en "2:05 PM".
  const time = new Intl.DateTimeFormat(intlLocale(locale), {
    hour: locale === 'de' ? '2-digit' : 'numeric',
    minute: '2-digit',
  }).format(checked);
  if (checked.toDateString() === new Date(now).toDateString()) return update.todayAt(time);
  // Date and time are formatted apart: ICU joins a combined pattern with
  // "um"/"at", while the spec wants "17. November, 14:05".
  const date = new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'long',
  }).format(checked);
  return update.checkedOnDay(date, time);
}

/** Release date such as "17. November 2026" / "November 17, 2026". */
export function formatAndroidReleaseDate(publishedAt: string, locale: AppLocale): string {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`GitHub release publish date "${publishedAt}" is not a valid date`);
  }
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
