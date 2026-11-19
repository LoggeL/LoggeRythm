import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { activateLocale, catalogs, type AppLocale } from '../localization';
import type { AndroidUpdateStartupPhase } from './androidUpdateStore';
import {
  ANDROID_UPDATE_FINAL_INSTALL_CODES,
  AndroidUpdateError,
  androidUpdateFailure,
  type AndroidUpdateFailure,
} from './updateErrors';
import {
  ANDROID_UPDATE_STARTUP_TOAST_MAX_LENGTH,
  androidUpdateStartupFailureToast,
  androidUpdateStartupPhaseLabel,
  androidUpdateStartupStep,
  describeAndroidUpdateFailure,
  formatAndroidReleaseDate,
  formatAndroidUpdateCheckedAt,
  type AndroidUpdateFailureContext,
} from './updatePresentation';

const NATIVE_DIR = '../../modules/loggerythm-updater/android/src/main/java/top/logge/loggerythm/updater/';

function nativeCodes(file: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(`${NATIVE_DIR}${file}`, import.meta.url)), 'utf8');
  return Array.from(source.matchAll(/"(updater-[a-z0-9-]+)"/g), (match) => match[1]);
}

/** The installer receiver: every code it persists reaches the card as an install failure. */
const RECEIVER_CODES = nativeCodes('LoggeRythmUpdateInstallReceiver.kt');
/** Every code the module rejects a promise with. */
const MODULE_CODES = nativeCodes('LoggeRythmUpdaterModule.kt');

/**
 * The module's catch-all for a non-updater exception keeps the "unknown"
 * cause: its raw message in the detail is the only honest description.
 */
const UNLOCALIZED_NATIVE_CODES = new Set(['updater-native-failed']);

const CONTEXT: AndroidUpdateFailureContext = {
  phase: 'install',
  releaseVersion: '1.0.17',
  installedBuild: 10090,
  detailBelow: true,
};

function failure(code: string | null, overrides: Partial<AndroidUpdateFailure> = {}): AndroidUpdateFailure {
  return { code, message: `raw ${code ?? 'error'}`, httpStatus: null, ...overrides };
}

afterEach(() => {
  activateLocale('de');
});

describe.each<AppLocale>(['de', 'en'])('describeAndroidUpdateFailure (%s)', (locale) => {
  const t = catalogs[locale].profile.update;
  const e = t.errors;

  it.each<[string, AndroidUpdateFailure, Partial<AndroidUpdateFailureContext>, () => string]>([
    ['network', failure('network'), {}, () => e.network],
    ['github-rate-limited', failure('github-rate-limited', { httpStatus: 403 }), {}, () => e.rateLimited(403)],
    ['github-http', failure('github-http', { httpStatus: 503 }), {}, () => e.http(503)],
    ['release-version-code-missing', failure('release-version-code-missing'), {}, () => e.releaseVersionCodeMissing('1.0.17')],
    ['release-version-code-ambiguous', failure('release-version-code-ambiguous'), {}, () => e.releaseVersionCodeAmbiguous('1.0.17')],
    ['release-invalid', failure('release-invalid'), {}, () => e.releaseInvalid],
    ['installed-version-invalid', failure('installed-version-invalid', { installedVersion: '1.0.15-dev' }), {}, () => e.installedVersionInvalid('1.0.15-dev')],
    ['update-marker-invalid', failure('update-marker-invalid'), {}, () => e.markerInvalid],
    ['updater-install-permission-required', failure('updater-install-permission-required'), {}, () => e.permissionRequired],
    ['updater-digest-mismatch', failure('updater-digest-mismatch'), {}, () => e.digestMismatch],
    ['updater-signature-mismatch', failure('updater-signature-mismatch'), {}, () => e.signatureMismatch],
    ['updater-signature-missing', failure('updater-signature-missing'), {}, () => e.signatureMismatch],
    ['updater-apk-not-newer', failure('updater-apk-not-newer'), {}, () => e.apkNotNewer('1.0.17', 10090)],
    ['updater-apk-version-mismatch', failure('updater-apk-version-mismatch'), {}, () => e.apkVersionMismatch('1.0.17')],
    ['updater-apk-version-code-mismatch', failure('updater-apk-version-code-mismatch'), {}, () => e.apkVersionCodeMismatch('1.0.17')],
    ['updater-install-busy', failure('updater-install-busy'), {}, () => e.installBusy],
    ['updater-install-session-failed', failure('updater-install-session-failed'), {}, () => e.installSession],
    ['updater-install-commit-failed', failure('updater-install-commit-failed'), {}, () => e.installSession],
    ['updater-install-aborted', failure('updater-install-aborted'), {}, () => e.installAborted],
    ['updater-install-failed', failure('updater-install-failed'), {}, () => e.installRejected],
    ['updater-install-confirmation-blocked', failure('updater-install-confirmation-blocked'), {}, () => e.confirmationBlocked],
    ['updater-install-incompatible', failure('updater-install-incompatible'), {}, () => e.installIncompatible],
    ['updater-install-blocked', failure('updater-install-blocked'), {}, () => e.installBlocked],
    ['updater-install-conflict', failure('updater-install-conflict'), {}, () => e.installConflict],
    ['updater-install-outcome-unsaved', failure('updater-install-outcome-unsaved'), {}, () => e.outcomeUnsaved],
    ['updater-install-settings-unavailable', failure('updater-install-settings-unavailable'), {}, () => e.permissionSettingsUnavailable],
    ['updater-installed-package-missing', failure('updater-installed-package-missing'), {}, () => e.installedUnreadable],
    ['updater-installed-version-missing', failure('updater-installed-version-missing'), {}, () => e.installedUnreadable],
    ['updater-module-invalidated', failure('updater-module-invalidated'), {}, () => e.moduleInvalidated],
    ['updater-install-outcome-invalid', failure('updater-install-outcome-invalid'), {}, () => e.markerInvalid],
    ['updater-package-mismatch', failure('updater-package-mismatch'), {}, () => e.packageMismatch],
    ['updater-apk-invalid', failure('updater-apk-invalid'), {}, () => e.apkInvalid],
    ['updater-apk-version-missing', failure('updater-apk-version-missing'), {}, () => e.apkInvalid],
    ...[
      'updater-version-code-invalid',
      'updater-version-invalid',
      'updater-digest-invalid',
      'updater-url-invalid',
      'updater-url-host-rejected',
      'updater-url-release-rejected',
    ].map((code): [string, AndroidUpdateFailure, Partial<AndroidUpdateFailureContext>, () => string] =>
      [code, failure(code), {}, () => e.releaseInvalid]),
    ...[
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
    ].map((code): [string, AndroidUpdateFailure, Partial<AndroidUpdateFailureContext>, () => string] =>
      [code, failure(code), {}, () => e.download]),
  ])('maps %s to its localized cause and keeps the raw detail', (code, value, context, expected) => {
    activateLocale(locale);
    expect(describeAndroidUpdateFailure(value, { ...CONTEXT, ...context })).toEqual({
      title: t.installFailedTitle,
      message: expected(),
      detail: t.detail(code, `raw ${code}`),
    });
  });

  it('uses the check title for check failures', () => {
    activateLocale(locale);
    expect(describeAndroidUpdateFailure(failure('network'), { ...CONTEXT, phase: 'check' }).title)
      .toBe(t.checkFailedTitle);
  });

  it('keeps the Android installer message in the detail', () => {
    activateLocale(locale);
    const rejected = failure('updater-install-failed', {
      message: 'INSTALL_FAILED_INSUFFICIENT_STORAGE (status 6)',
    });
    expect(describeAndroidUpdateFailure(rejected, CONTEXT)).toEqual({
      title: t.installFailedTitle,
      message: e.installRejected,
      detail: t.detail('updater-install-failed', 'INSTALL_FAILED_INSUFFICIENT_STORAGE (status 6)'),
    });
  });

  it('says "unknown" for an unmapped code or no code and keeps the raw text in the detail', () => {
    activateLocale(locale);
    expect(describeAndroidUpdateFailure(failure('updater-native-failed'), CONTEXT)).toEqual({
      title: t.installFailedTitle,
      message: e.unknown,
      detail: t.detail('updater-native-failed', 'raw updater-native-failed'),
    });
    expect(describeAndroidUpdateFailure(failure(null, { message: 'boom' }), CONTEXT)).toEqual({
      title: t.installFailedTitle,
      message: e.unknown,
      detail: t.detail('error', 'boom'),
    });
  });

  it('points to the detail below only where it is below (ErrorState), else says a short "unknown error"', () => {
    activateLocale(locale);
    expect(describeAndroidUpdateFailure(failure(null, { message: 'boom' }), { ...CONTEXT, detailBelow: false }))
      .toEqual({
        title: t.installFailedTitle,
        message: e.unknownShort,
        detail: t.detail('error', 'boom'),
      });
    // A localized cause does not depend on it.
    expect(describeAndroidUpdateFailure(failure('network'), { ...CONTEXT, detailBelow: false }).message)
      .toBe(e.network);
  });

  it('maps a failed hand-over of the app language to its own cause', () => {
    activateLocale(locale);
    for (const code of ['updater-locale-invalid', 'updater-locale-unsaved']) {
      expect(describeAndroidUpdateFailure(failure(code), CONTEXT).message, code).toBe(e.appLocale);
    }
  });

  it('says "unknown" when a mapped cause lacks the data it names, with the raw detail', () => {
    activateLocale(locale);
    const none = { phase: 'check' as const, releaseVersion: null, installedBuild: null, detailBelow: true };
    for (const code of [
      'release-version-code-missing',
      'release-version-code-ambiguous',
      'updater-apk-not-newer',
      'updater-apk-version-mismatch',
      'updater-apk-version-code-mismatch',
      'installed-version-invalid',
      'github-http',
      'github-rate-limited',
    ]) {
      expect(describeAndroidUpdateFailure(failure(code), none)).toEqual({
        title: t.checkFailedTitle,
        message: e.unknown,
        detail: t.detail(code, `raw ${code}`),
      });
    }
  });

  it('gives every final install code and every native code in the Kotlin sources a localized cause', () => {
    activateLocale(locale);
    const nativeSourceCodes = [...RECEIVER_CODES, ...MODULE_CODES];
    // The scan must still see the installer outcomes, or it guards nothing.
    expect(nativeSourceCodes).toEqual(expect.arrayContaining([
      'updater-install-aborted',
      'updater-install-failed',
      'updater-install-confirmation-blocked',
      'updater-install-incompatible',
      'updater-install-blocked',
      'updater-install-conflict',
      'updater-install-outcome-unsaved',
      'updater-native-failed',
    ]));
    for (const code of [...ANDROID_UPDATE_FINAL_INSTALL_CODES, ...nativeSourceCodes]) {
      if (UNLOCALIZED_NATIVE_CODES.has(code)) continue;
      expect(describeAndroidUpdateFailure(failure(code), CONTEXT).message, code).not.toBe(e.unknown);
    }
  });

  it('treats the final installer outcomes as final and the rest as retryable', () => {
    for (const code of ['updater-install-incompatible', 'updater-install-blocked', 'updater-install-conflict']) {
      expect(ANDROID_UPDATE_FINAL_INSTALL_CODES.has(code), code).toBe(true);
    }
    for (const code of [
      'updater-install-failed',
      'updater-install-aborted',
      'updater-install-confirmation-blocked',
      'updater-install-outcome-unsaved',
    ]) {
      expect(ANDROID_UPDATE_FINAL_INSTALL_CODES.has(code), code).toBe(false);
    }
  });
});

describe('update wording', () => {
  it('names the real platform behaviour and the German platform labels', () => {
    const de = catalogs.de.profile.update;
    const en = catalogs.en.profile.update;
    expect(de.titleUninstallable).toBe('Update nicht installierbar');
    expect(de.errors.installIncompatible).toBe('Dieses Gerät erfüllt die Anforderungen des Updates nicht.');
    expect(de.errors.installBlocked).toBe('Eine Geräterichtlinie blockiert die Installation.');
    expect(de.errors.installConflict).toBe('Android meldet einen Konflikt mit der installierten App.');
    expect(de.startupPhase.installOutcomeUnavailable).toBe('Status des letzten Updates nicht lesbar');
    // Android does not relaunch a self-updated app; the user opens it.
    expect(de.confirmHint).toBe(
      'Nach der Installation öffnest du die neue Version über die Benachrichtigung oder das App-Symbol. Kein Dialog zu sehen? Starte die Installation erneut.',
    );
    expect(de.confirmHint).not.toMatch(/startet .*neu/);
    expect(en.confirmHint).not.toMatch(/restart/i);
    // The toggle label as German Android shows it.
    expect(de.permission).toContain('„Dieser Quelle vertrauen“');
    expect(en.permission).toContain('“Allow from this source”');
  });

  it('promises an offer only for a higher version number, not a higher build number', () => {
    // The version name decides whether a release counts as newer at all.
    expect(catalogs.de.profile.update.installedNewerHint).toBe(
      'Das passiert bei Test- und Entwicklungs-Builds. Sobald ein Release mit höherer Versionsnummer erscheint, wird es hier angeboten.',
    );
    expect(catalogs.en.profile.update.installedNewerHint).toBe(
      'This happens with test and development builds. A release with a higher version number will be offered here once it is out.',
    );
    for (const locale of ['de', 'en'] as const) {
      expect(catalogs[locale].profile.update.installedNewerHint).not.toMatch(/build[- ]?(nummer|number)/i);
    }
  });

  it('labels the header dot of an unseen final failure as a failed update', () => {
    expect(catalogs.de.navigation.openProfileUpdateFailed).toBe('Profil öffnen, Update fehlgeschlagen');
    expect(catalogs.en.navigation.openProfileUpdateFailed).toBe('Open profile, update failed');
  });

  it('has a short "unknown error" for toasts and notes and keeps the pointer only for the ErrorState', () => {
    expect(catalogs.de.profile.update.errors.unknownShort).toBe('Unbekannter Fehler.');
    expect(catalogs.en.profile.update.errors.unknownShort).toBe('Unknown error.');
    expect(catalogs.de.profile.update.errors.unknown).toBe('Unbekannter Fehler – Details stehen darunter.');
    expect(catalogs.en.profile.update.errors.unknown).toBe('Unknown error – details below.');
  });

  it('says an equal build number is the same build, not a newer one, and blames the release line', () => {
    expect(catalogs.de.profile.update.installedSameBuild('1.0.18', 10042)).toBe(
      'Release 1.0.18 hat dieselbe Build-Nummer (10042) wie diese Installation und kann deshalb nicht installiert werden.',
    );
    expect(catalogs.en.profile.update.installedSameBuild('1.0.18', 10042)).toBe(
      'Release 1.0.18 has the same build number (10042) as this installation, so it can’t be installed.',
    );
    for (const locale of ['de', 'en'] as const) {
      const update = catalogs[locale].profile.update;
      expect(update.installedSameBuild('1.0.18', 10042)).not.toMatch(/neuer|newer/i);
      expect(update.installedSameBuildHint).toContain('Android-Versioncode');
      expect(update.installedSameBuildHint).not.toMatch(/Entwicklung|development|Test/i);
    }
  });

  it('keeps the startup toast to phase and profile pointer', () => {
    expect(catalogs.de.profile.update.startupFailureToast('Letztes Update nicht installiert'))
      .toBe('Letztes Update nicht installiert – Details im Profil');
    expect(catalogs.en.profile.update.startupFailureToast('Last update not installed'))
      .toBe('Last update not installed – details in your profile');
  });

  it('announces how a finished check ended, short enough to be heard at once', () => {
    const de = catalogs.de.profile.update.checkAnnouncement;
    const en = catalogs.en.profile.update.checkAnnouncement;
    expect([de.upToDate, de.available('1.0.16'), de.installedNewer, de.uninstallable('1.0.16')]).toEqual([
      'Keine neue Version.',
      'Update 1.0.16 verfügbar.',
      'Diese Installation ist neuer als das letzte Release.',
      'Update 1.0.16 kann nicht installiert werden.',
    ]);
    expect([en.upToDate, en.available('1.0.16'), en.installedNewer, en.uninstallable('1.0.16')]).toEqual([
      'No new version.',
      'Update 1.0.16 available.',
      'This installation is newer than the latest release.',
      'Update 1.0.16 can’t be installed.',
    ]);
  });
});

describe('startup failure phases', () => {
  it('names every phase like the toast did and assigns it to its step', () => {
    activateLocale('en');
    const labels = catalogs.en.profile.update.startupPhase;
    expect(androidUpdateStartupPhaseLabel('check')).toBe(labels.check);
    expect(androidUpdateStartupPhaseLabel('pending-install')).toBe(labels.pendingInstall);
    expect(androidUpdateStartupPhaseLabel('install-outcome')).toBe(labels.installOutcome);
    expect(androidUpdateStartupPhaseLabel('install-outcome-unavailable')).toBe(labels.installOutcomeUnavailable);
    expect(androidUpdateStartupPhaseLabel('app-locale')).toBe(labels.appLocale);
    expect(labels.appLocale).toBe('Language of update notices not set');
    expect(catalogs.de.profile.update.startupPhase.appLocale).toBe('Sprache der Update-Hinweise nicht gesetzt');
    expect(androidUpdateStartupStep('check')).toBe('check');
    expect(androidUpdateStartupStep('pending-install')).toBe('check');
    expect(androidUpdateStartupStep('install-outcome')).toBe('install');
    expect(androidUpdateStartupStep('install-outcome-unavailable')).toBe('install');
    expect(androidUpdateStartupStep('app-locale')).toBe('install');
  });
});

/** Every startup phase; `satisfies` fails the build when a phase is added and not listed. */
const STARTUP_PHASES = {
  check: true,
  'pending-install': true,
  'install-outcome': true,
  'install-outcome-unavailable': true,
  'app-locale': true,
} satisfies Record<AndroidUpdateStartupPhase, true>;

describe('startup failure toast', () => {
  it.each<AppLocale>(['de', 'en'])('fits two toast lines for every phase in %s', (locale) => {
    activateLocale(locale);
    const toasts = (Object.keys(STARTUP_PHASES) as AndroidUpdateStartupPhase[])
      .map(androidUpdateStartupFailureToast);
    expect(toasts).toHaveLength(5);
    const tooLong = toasts
      .filter((toast) => toast.length > ANDROID_UPDATE_STARTUP_TOAST_MAX_LENGTH)
      .map((toast) => `"${toast}" (${toast.length})`);
    expect(tooLong).toEqual([]);
    for (const toast of toasts) {
      // Phase and pointer only: no cause, no raw detail.
      expect(toast).toContain(locale === 'de' ? '– Details im Profil' : '– details in your profile');
      expect(toast).not.toContain(':');
    }
  });

  it('names the phase first and points to the profile', () => {
    activateLocale('de');
    expect(androidUpdateStartupFailureToast('install-outcome'))
      .toBe('Letztes Update nicht installiert – Details im Profil');
    activateLocale('en');
    expect(androidUpdateStartupFailureToast('check')).toBe('Update check failed – details in your profile');
  });
});

describe('failure context from the error itself', () => {
  it('prefers the release version the check error carries', () => {
    activateLocale('en');
    const value = androidUpdateFailure(
      new AndroidUpdateError('release-version-code-missing', 'no line', null, { releaseVersion: '1.0.18' }),
    );
    expect(
      describeAndroidUpdateFailure(value, { phase: 'check', releaseVersion: null, installedBuild: null, detailBelow: true }),
    ).toEqual({
      title: catalogs.en.profile.update.checkFailedTitle,
      message: catalogs.en.profile.update.errors.releaseVersionCodeMissing('1.0.18'),
      detail: catalogs.en.profile.update.detail('release-version-code-missing', 'no line'),
    });
  });
});

describe('formatAndroidUpdateCheckedAt', () => {
  const now = new Date(2026, 10, 19, 15, 30).getTime();

  it.each<[AppLocale, number, string]>([
    ['de', now - 20_000, 'gerade eben'],
    ['en', now - 20_000, 'just now'],
    ['de', now + 5_000, 'gerade eben'],
    ['de', now - 5 * 60_000, 'vor 5 Min.'],
    ['en', now - 59 * 60_000 - 59_000, '59 min ago'],
    ['de', new Date(2026, 10, 19, 9, 5).getTime(), 'heute, 09:05'],
    ['en', new Date(2026, 10, 19, 9, 5).getTime(), 'today, 9:05 AM'],
    ['de', new Date(2026, 10, 17, 14, 5).getTime(), '17. November, 14:05'],
    ['en', new Date(2026, 10, 17, 14, 5).getTime(), 'November 17, 2:05 PM'],
  ])('%s %#', (locale, checkedAt, expected) => {
    // The process locale is the other one: the argument decides.
    activateLocale(locale === 'de' ? 'en' : 'de');
    expect(formatAndroidUpdateCheckedAt(checkedAt, now, locale).replace(/ /g, ' ')).toBe(expected);
  });

  it('rejects a non-finite timestamp', () => {
    expect(() => formatAndroidUpdateCheckedAt(Number.NaN, now, 'de')).toThrow('not a finite timestamp');
  });
});

describe('formatAndroidReleaseDate', () => {
  it('formats the release date per locale', () => {
    const publishedAt = new Date(2026, 10, 17, 12, 0).toISOString();
    expect(formatAndroidReleaseDate(publishedAt, 'de')).toBe('17. November 2026');
    expect(formatAndroidReleaseDate(publishedAt, 'en')).toBe('November 17, 2026');
  });

  it('throws on an invalid publish date', () => {
    expect(() => formatAndroidReleaseDate('not a date', 'de')).toThrow(
      'GitHub release publish date "not a date" is not a valid date',
    );
  });
});
