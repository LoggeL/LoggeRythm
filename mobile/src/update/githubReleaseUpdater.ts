import { NativeEventEmitter, NativeModules, Platform, type EmitterSubscription } from 'react-native';
import type { AppLocale } from '../localization';
import {
  decodeAndroidUpdateDownloadProgress,
  type AndroidUpdateDownloadProgress,
} from './downloadProgress';
import { AndroidUpdateError } from './updateErrors';

const LATEST_RELEASE_URL =
  'https://api.github.com/repos/LoggeL/LoggeRythm/releases/latest';
const RELEASE_DOWNLOAD_PREFIX =
  '/LoggeL/LoggeRythm/releases/download/';
const MAX_APK_BYTES = 300 * 1024 * 1024;
const STABLE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const DOWNLOAD_PROGRESS_EVENT = 'LoggeRythmUpdaterDownloadProgress';
const INSTALL_OUTCOME_EVENT = 'LoggeRythmUpdaterInstallOutcome';
const NATIVE_FAILURE_CODE = /^updater-[a-z0-9-]+$/;
/**
 * Release contract: the GitHub release text names the APK's Android
 * versionCode on exactly one line, e.g. `Android-Versioncode: 10079`. The app
 * compares it with the installed build before downloading, because Android
 * (and the native gate) only accept an APK whose versionCode is higher.
 */
const RELEASE_VERSION_CODE_LABEL = /^[ \t]*Android-Versioncode[ \t]*:(.*)$/gim;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
/**
 * Deadline of the GitHub release check, for the request and reading its body.
 * React Native's OkHttp client has no timeouts of its own, so without it a
 * stalled request would keep the single-flight check (and the startup report)
 * waiting forever. Same budget as the API client's `REQUEST_TIMEOUT_MS`.
 */
export const GITHUB_CHECK_TIMEOUT_MS = 20_000;

export interface AndroidInstallationInfo {
  versionName: string;
  versionCode: number;
  canRequestPackageInstalls: boolean;
}

/** The installed app, as Android's PackageManager reports it. */
export interface AndroidInstalledBuild {
  /** Normalized stable semantic version, e.g. `1.0.16`. */
  versionName: string;
  versionCode: number;
}

export interface AndroidUpdateRelease {
  versionName: string;
  /** The APK's Android versionCode, declared in the release text. */
  versionCode: number;
  tagName: string;
  releaseName: string;
  releaseUrl: string;
  publishedAt: string;
  apkName: string;
  apkUrl: string;
  apkDigest: string;
  apkSize: number;
  /** First paragraph of the release text as plain text, or null if the release has none. */
  summary: string | null;
}

export type AndroidUpdateCheck =
  | {
    kind: 'up-to-date';
    installed: AndroidInstalledBuild;
    latestVersion: string;
  }
  | {
    /**
     * The installation is newer than the latest release, so the release
     * cannot be installed over it. `newer-name`: a development build of an
     * upcoming version. `newer-build`: the release has a higher version name
     * but an equal or lower versionCode (for example a local or QA build), and
     * Android would refuse it after the download.
     */
    kind: 'installed-newer';
    reason: 'newer-name' | 'newer-build';
    installed: AndroidInstalledBuild;
    latestVersion: string;
    /** Known for `newer-build`; not read for `newer-name`. */
    latestVersionCode: number | null;
    releaseUrl: string;
  }
  | {
    kind: 'available';
    installed: AndroidInstalledBuild;
    release: AndroidUpdateRelease;
  };

export interface AndroidUpdaterPort {
  getInstallationInfo(): Promise<AndroidInstallationInfo>;
  openInstallPermissionSettings(): Promise<void>;
  downloadAndInstall(
    url: string,
    digest: string,
    versionName: string,
    versionCode: number,
  ): Promise<{
    status: 'awaiting-user-confirmation';
    versionName: string;
    versionCode: number;
    /** The PackageInstaller session the APK was committed to. */
    sessionId: number;
  }>;
}

export type { AndroidUpdateDownloadProgress };

/**
 * How Android's installer ended a session without success, as the native
 * install receiver stored it: `updater-install-aborted` (the user cancelled
 * the system dialog), `updater-install-incompatible`, `updater-install-blocked`
 * and `updater-install-conflict` (final: the device, a policy or the installed
 * app rejects this APK), `updater-install-failed` (any other PackageInstaller
 * failure, e.g. storage; the message carries Android's status message and
 * status code) or `updater-install-confirmation-blocked` (the app was in the
 * background and the confirmation notification is blocked). `sessionId` is
 * the PackageInstaller session it ended; `versionName`/`versionCode` name the
 * release the session installed, null only when the session did not say.
 */
export interface AndroidInstallOutcome {
  code: string;
  message: string;
  sessionId: number;
  versionName: string | null;
  versionCode: number | null;
}

/** Native module methods outside {@link AndroidUpdaterPort}. */
interface AndroidInstallOutcomePort {
  consumeInstallOutcome(): Promise<unknown>;
}

export type FetchLike = (
  input: string,
  init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

type SemanticVersion = readonly [number, number, number];

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

function semanticVersion(value: string, name: string): SemanticVersion {
  const match = STABLE_VERSION.exec(value.trim());
  if (!match) throw new Error(`${name} must be a stable semantic version`);
  const result = match.slice(1).map(Number);
  if (result.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`${name} exceeds the supported version range`);
  }
  return result as unknown as SemanticVersion;
}

function normalizedVersion(value: SemanticVersion): string {
  return value.join('.');
}

function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function validateReleaseUrl(value: string, tagName: string, apk: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`GitHub ${apk ? 'APK' : 'release'} URL is invalid`);
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hostname !== 'github.com' ||
    parsed.hash !== ''
  ) {
    throw new Error(`GitHub ${apk ? 'APK' : 'release'} URL is not trusted`);
  }
  if (apk) {
    const prefix = `${RELEASE_DOWNLOAD_PREFIX}${encodeURIComponent(tagName)}/`;
    if (!parsed.pathname.startsWith(prefix) || !parsed.pathname.toLowerCase().endsWith('.apk')) {
      throw new Error('GitHub APK URL does not belong to the selected LoggeRythm release');
    }
  } else if (!parsed.pathname.startsWith('/LoggeL/LoggeRythm/releases/')) {
    throw new Error('GitHub release URL does not belong to LoggeRythm');
  }
  return parsed.toString();
}

function invalidInstallOutcome(message: string): Error {
  return Object.assign(new Error(`Android install outcome is invalid: ${message}`), {
    code: 'updater-install-outcome-invalid',
  });
}

/**
 * Validates an install outcome from the native module. A malformed bridge
 * value throws an Error with code `updater-install-outcome-invalid`.
 */
export function parseInstallOutcome(value: unknown): AndroidInstallOutcome {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidInstallOutcome(`expected an object, got ${value === null ? 'null' : typeof value}`);
  }
  const outcome = value as Record<string, unknown>;
  if (typeof outcome.code !== 'string' || !NATIVE_FAILURE_CODE.test(outcome.code)) {
    throw invalidInstallOutcome(`code ${JSON.stringify(outcome.code)} is not an updater code`);
  }
  if (typeof outcome.message !== 'string' || outcome.message.trim() === '') {
    throw invalidInstallOutcome(`${outcome.code} has no message`);
  }
  const { sessionId, versionName, versionCode } = outcome;
  if (!Number.isSafeInteger(sessionId) || (sessionId as number) <= 0) {
    throw invalidInstallOutcome(`${outcome.code} has sessionId ${JSON.stringify(sessionId)}`);
  }
  if (versionName !== null && (typeof versionName !== 'string' || versionName.trim() === '')) {
    throw invalidInstallOutcome(`${outcome.code} has versionName ${JSON.stringify(versionName)}`);
  }
  if (versionCode !== null && (!Number.isSafeInteger(versionCode) || (versionCode as number) <= 0)) {
    throw invalidInstallOutcome(`${outcome.code} has versionCode ${JSON.stringify(versionCode)}`);
  }
  return {
    code: outcome.code,
    message: outcome.message,
    sessionId: sessionId as number,
    versionName: versionName === null ? null : (versionName as string).trim(),
    versionCode: versionCode as number | null,
  };
}

/** Validates the native installation info; a malformed bridge value fails loudly. */
export function parseInstallationInfo(value: unknown): AndroidInstallationInfo {
  const info = record(value, 'Android installation info');
  return {
    versionName: text(info.versionName, 'Installed app version'),
    versionCode: positiveVersionCode(info.versionCode, 'Installed app versionCode'),
    canRequestPackageInstalls: boolean(
      info.canRequestPackageInstalls,
      'Android install permission state',
    ),
  };
}

function positiveVersionCode(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value as number;
}

/** Normalizes the installed build or throws `installed-version-invalid`. */
export function installedBuild(info: AndroidInstallationInfo): AndroidInstalledBuild {
  let versionName: string;
  try {
    versionName = normalizedVersion(semanticVersion(info.versionName, 'Installed app version'));
  } catch (error) {
    throw new AndroidUpdateError(
      'installed-version-invalid',
      `Installed app version "${info.versionName}" is not a stable semantic version`,
      null,
      { cause: error, installedVersion: info.versionName },
    );
  }
  return { versionName, versionCode: info.versionCode };
}

/** `v1.0.17` → `1.0.17`; any other tag is shown as it is. */
function tagVersion(tagName: string): string {
  const match = STABLE_VERSION.exec(tagName.trim());
  return match ? match.slice(1).map(Number).join('.') : tagName;
}

/** Reads the single `Android-Versioncode: N` line of a release text. */
export function releaseVersionCode(body: unknown, tagName: string): number {
  const releaseVersion = tagVersion(tagName);
  if (body !== null && body !== undefined && typeof body !== 'string') {
    throw new AndroidUpdateError('release-invalid', 'GitHub release body must be a string', null, {
      releaseVersion,
    });
  }
  const matches = [...(typeof body === 'string' ? body : '').matchAll(RELEASE_VERSION_CODE_LABEL)];
  if (matches.length === 0) {
    throw new AndroidUpdateError(
      'release-version-code-missing',
      `GitHub release ${tagName} has no "Android-Versioncode: N" line`,
      null,
      { releaseVersion },
    );
  }
  if (matches.length > 1) {
    throw new AndroidUpdateError(
      'release-version-code-ambiguous',
      `GitHub release ${tagName} has ${matches.length} "Android-Versioncode" lines`,
      null,
      { releaseVersion },
    );
  }
  const value = matches[0][1].trim().replace(/^`(.*)`$/, '$1');
  const code = Number(value);
  if (!POSITIVE_INTEGER.test(value) || !Number.isSafeInteger(code)) {
    throw new AndroidUpdateError(
      'release-invalid',
      `GitHub release ${tagName} declares an invalid Android-Versioncode "${value}"`,
      null,
      { releaseVersion },
    );
  }
  return code;
}

const BOLD_HEADING = /^(\*\*|__)[^*_]+(\*\*|__):?$/;
const VERSION_CODE_LINE = /^Android-Versioncode[ \t]*:/i;

/**
 * The release text's first prose paragraph as plain text. Headings, the
 * versionCode line and Markdown emphasis are dropped. A release without text
 * has no summary (null); that is not an error.
 */
export function releaseSummary(body: unknown): string | null {
  if (body === null || body === undefined) return null;
  if (typeof body !== 'string') {
    throw new AndroidUpdateError('release-invalid', 'GitHub release body must be a string');
  }
  for (const paragraph of body.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    // A heading line ("**Warteschlange**") or the versionCode line is never prose,
    // even when it shares a paragraph with the text below it.
    const lines = paragraph
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 &&
          !line.startsWith('#') &&
          !BOLD_HEADING.test(line) &&
          !VERSION_CODE_LINE.test(line),
      );
    if (lines.length === 0) continue;
    const plain = lines
      .map((line) => line.replace(/^[-*+]\s+/, ''))
      .join(' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|__|`/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (plain.length > 0) return plain;
  }
  return null;
}

export function parseLatestRelease(
  value: unknown,
  installed: AndroidInstalledBuild,
): AndroidUpdateCheck {
  try {
    return parseLatestReleaseUnchecked(value, installed);
  } catch (error) {
    if (error instanceof AndroidUpdateError) throw error;
    const tagName =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).tag_name
        : undefined;
    throw new AndroidUpdateError(
      'release-invalid',
      error instanceof Error ? error.message : String(error),
      null,
      typeof tagName === 'string' && STABLE_VERSION.test(tagName.trim())
        ? { cause: error, releaseVersion: tagVersion(tagName) }
        : { cause: error },
    );
  }
}

function parseLatestReleaseUnchecked(
  value: unknown,
  installed: AndroidInstalledBuild,
): AndroidUpdateCheck {
  const installedVersion = semanticVersion(installed.versionName, 'Installed app version');
  const release = record(value, 'GitHub release');
  if (boolean(release.draft, 'GitHub release draft')) {
    throw new Error('GitHub latest release unexpectedly points to a draft');
  }
  if (boolean(release.prerelease, 'GitHub release prerelease')) {
    throw new Error('GitHub latest release unexpectedly points to a prerelease');
  }
  const tagName = text(release.tag_name, 'GitHub release tag');
  const latest = semanticVersion(tagName, 'GitHub release tag');
  const latestVersion = normalizedVersion(latest);
  const comparison = compareVersions(latest, installedVersion);
  if (comparison === 0) {
    return { kind: 'up-to-date', installed, latestVersion };
  }
  const releaseUrl = validateReleaseUrl(
    text(release.html_url, 'GitHub release URL'),
    tagName,
    false,
  );
  if (comparison < 0) {
    return {
      kind: 'installed-newer',
      reason: 'newer-name',
      installed,
      latestVersion,
      latestVersionCode: null,
      releaseUrl,
    };
  }

  const versionCode = releaseVersionCode(release.body, tagName);
  if (versionCode <= installed.versionCode) {
    return {
      kind: 'installed-newer',
      reason: 'newer-build',
      installed,
      latestVersion,
      latestVersionCode: versionCode,
      releaseUrl,
    };
  }

  if (!Array.isArray(release.assets)) {
    throw new Error('GitHub release assets must be an array');
  }
  const apkAssets = release.assets
    .map((asset, index) => record(asset, `GitHub release asset ${index}`))
    .filter((asset) => {
      const name = text(asset.name, 'GitHub release asset name');
      return name.toLowerCase().endsWith('.apk');
    });
  if (apkAssets.length !== 1) {
    throw new Error(
      `GitHub release must contain exactly one APK asset, found ${apkAssets.length}`,
    );
  }
  const asset = apkAssets[0];
  const assetState = text(asset.state, 'GitHub APK state');
  if (assetState !== 'uploaded') throw new Error(`GitHub APK is not ready: ${assetState}`);
  const apkName = text(asset.name, 'GitHub APK name');
  const apkSize = integer(asset.size, 'GitHub APK size');
  if (apkSize === 0 || apkSize > MAX_APK_BYTES) {
    throw new Error('GitHub APK size is empty or exceeds the 300 MiB safety limit');
  }
  const apkDigest = text(asset.digest, 'GitHub APK digest').toLowerCase();
  if (!SHA256_DIGEST.test(apkDigest)) {
    throw new Error('GitHub APK has no valid SHA-256 digest');
  }
  const contentType = text(asset.content_type, 'GitHub APK content type').toLowerCase();
  if (![
    'application/vnd.android.package-archive',
    'application/octet-stream',
  ].includes(contentType)) {
    throw new Error(`GitHub APK has unsupported content type ${contentType}`);
  }

  return {
    kind: 'available',
    installed,
    release: {
      versionName: latestVersion,
      versionCode,
      tagName,
      releaseName:
        typeof release.name === 'string' && release.name.trim().length > 0
          ? release.name.trim()
          : tagName,
      releaseUrl,
      publishedAt: text(release.published_at, 'GitHub release publish date'),
      apkName,
      apkUrl: validateReleaseUrl(
        text(asset.browser_download_url, 'GitHub APK URL'),
        tagName,
        true,
      ),
      apkDigest,
      apkSize,
      summary: releaseSummary(release.body),
    },
  };
}

function linkedAndroidUpdater(): AndroidUpdaterPort {
  if (Platform.OS !== 'android') {
    throw new Error('LoggeRythm release updater is supported on Android only');
  }
  const module = NativeModules.LoggeRythmUpdater as AndroidUpdaterPort | undefined;
  if (!module) throw new Error('LoggeRythm updater native module is not linked');
  return module;
}

export const androidUpdater: AndroidUpdaterPort = {
  getInstallationInfo: () => linkedAndroidUpdater().getInstallationInfo(),
  openInstallPermissionSettings: () =>
    linkedAndroidUpdater().openInstallPermissionSettings(),
  downloadAndInstall: (url, digest, versionName, versionCode) =>
    linkedAndroidUpdater().downloadAndInstall(url, digest, versionName, versionCode),
};

/**
 * Forwards decoded native download progress. A malformed event goes to
 * `onInvalid` with its decode error; an error thrown by `listener` itself is
 * not mistaken for a malformed event and propagates.
 */
export function subscribeAndroidUpdateDownloadProgress(
  listener: (progress: AndroidUpdateDownloadProgress) => void,
  onInvalid: (error: unknown) => void,
): () => void {
  const module = linkedAndroidUpdater() as AndroidUpdaterPort & { addListener?: unknown };
  let subscription: EmitterSubscription;
  try {
    subscription = new NativeEventEmitter(module as never).addListener(
      DOWNLOAD_PROGRESS_EVENT,
      (value) => {
        let progress: AndroidUpdateDownloadProgress;
        try {
          progress = decodeAndroidUpdateDownloadProgress(value);
        } catch (error) {
          onInvalid(error);
          return;
        }
        listener(progress);
      },
    );
  } catch (error) {
    throw new Error('LoggeRythm updater progress events are unavailable', { cause: error });
  }
  return () => subscription.remove();
}

/**
 * Reads and clears the install outcome the native receiver stored, or null
 * when Android's installer has reported nothing since.
 */
export async function consumeAndroidInstallOutcome(): Promise<AndroidInstallOutcome | null> {
  const module = linkedAndroidUpdater() as AndroidUpdaterPort & Partial<AndroidInstallOutcomePort>;
  if (typeof module.consumeInstallOutcome !== 'function') {
    throw new Error('LoggeRythm updater native module has no consumeInstallOutcome');
  }
  const value = await module.consumeInstallOutcome();
  return value === null ? null : parseInstallOutcome(value);
}

/**
 * Hands the language chosen in the app to the native updater, whose install
 * receiver shows its toasts and notifications in it (instead of the system
 * language). Rejects with `updater-locale-invalid` / `updater-locale-unsaved`.
 */
export async function setAndroidUpdaterAppLocale(locale: AppLocale): Promise<void> {
  const module = linkedAndroidUpdater() as AndroidUpdaterPort & { setAppLocale?: unknown };
  if (typeof module.setAppLocale !== 'function') {
    throw new Error('LoggeRythm updater native module has no setAppLocale');
  }
  await (module.setAppLocale as (value: AppLocale) => Promise<unknown>)(locale);
}

/**
 * Forwards install outcomes the native receiver reports while the app runs.
 * The outcome is also stored natively until {@link consumeAndroidInstallOutcome}
 * reads it. A malformed event goes to `onInvalid`; an error thrown by
 * `listener` itself propagates.
 */
export function subscribeAndroidInstallOutcome(
  listener: (outcome: AndroidInstallOutcome) => void,
  onInvalid: (error: unknown) => void,
): () => void {
  const module = linkedAndroidUpdater();
  let subscription: EmitterSubscription;
  try {
    subscription = new NativeEventEmitter(module as never).addListener(
      INSTALL_OUTCOME_EVENT,
      (value) => {
        let outcome: AndroidInstallOutcome;
        try {
          outcome = parseInstallOutcome(value);
        } catch (error) {
          onInvalid(error);
          return;
        }
        listener(outcome);
      },
    );
  } catch (error) {
    throw new Error('LoggeRythm updater install outcome events are unavailable', { cause: error });
  }
  return () => subscription.remove();
}

/** Reads and validates the installed build and its install permission. */
export async function readAndroidInstallation(
  updater: AndroidUpdaterPort = androidUpdater,
): Promise<AndroidInstallationInfo> {
  return parseInstallationInfo(await updater.getInstallationInfo());
}

/** Compares the installed build with GitHub's latest stable release. */
export async function checkForAndroidUpdate(
  fetcher: FetchLike = fetch,
  updater: AndroidUpdaterPort = androidUpdater,
): Promise<AndroidUpdateCheck> {
  return checkLatestAndroidRelease(
    installedBuild(await readAndroidInstallation(updater)),
    fetcher,
  );
}

/**
 * Compares `installed` with GitHub's latest stable release. The request and
 * reading its body share one {@link GITHUB_CHECK_TIMEOUT_MS} deadline; when it
 * passes, the request is aborted and the check fails with `network`.
 */
export async function checkLatestAndroidRelease(
  installed: AndroidInstalledBuild,
  fetcher: FetchLike = fetch,
): Promise<AndroidUpdateCheck> {
  const controller = new AbortController();
  const timeoutError = new AndroidUpdateError(
    'network',
    `GitHub did not answer within ${GITHUB_CHECK_TIMEOUT_MS / 1000} s`,
  );
  let timedOut = false;
  let rejectDeadline!: (error: AndroidUpdateError) => void;
  // Raced against the request and the body: a fetch that ignores the abort
  // signal still cannot outlive the deadline.
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    // Rejected before aborting, so the race settles with the timeout and not
    // with the abort error the fetch may raise synchronously.
    rejectDeadline(timeoutError);
    controller.abort();
  }, GITHUB_CHECK_TIMEOUT_MS);
  try {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await Promise.race([
        fetcher(LATEST_RELEASE_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: controller.signal,
        }),
        deadline,
      ]);
    } catch (error) {
      if (timedOut) throw timeoutError;
      throw new AndroidUpdateError(
        'network',
        `GitHub could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        null,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new AndroidUpdateError(
        response.status === 403 || response.status === 429 ? 'github-rate-limited' : 'github-http',
        `GitHub update check failed with HTTP ${response.status}`,
        response.status,
      );
    }
    let payload: unknown;
    try {
      payload = await Promise.race([response.json(), deadline]);
    } catch (error) {
      if (timedOut) throw timeoutError;
      throw new AndroidUpdateError(
        'release-invalid',
        'GitHub returned an unreadable release response',
        null,
        { cause: error },
      );
    }
    return parseLatestRelease(payload, installed);
  } finally {
    clearTimeout(timer);
  }
}
