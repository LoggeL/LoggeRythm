import { NativeModules, Platform } from 'react-native';

const LATEST_RELEASE_URL =
  'https://api.github.com/repos/LoggeL/LoggeRythm/releases/latest';
const RELEASE_DOWNLOAD_PREFIX =
  '/LoggeL/LoggeRythm/releases/download/';
const MAX_APK_BYTES = 300 * 1024 * 1024;
const STABLE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface AndroidInstallationInfo {
  versionName: string;
  versionCode: number;
  canRequestPackageInstalls: boolean;
}

export interface AndroidUpdateRelease {
  versionName: string;
  tagName: string;
  releaseName: string;
  releaseUrl: string;
  publishedAt: string;
  apkName: string;
  apkUrl: string;
  apkDigest: string;
  apkSize: number;
}

export type AndroidUpdateCheck =
  | {
    kind: 'up-to-date';
    installedVersion: string;
    latestVersion: string;
  }
  | {
    kind: 'available';
    installedVersion: string;
    release: AndroidUpdateRelease;
  };

export interface AndroidUpdaterPort {
  getInstallationInfo(): Promise<AndroidInstallationInfo>;
  openInstallPermissionSettings(): Promise<void>;
  downloadAndInstall(
    url: string,
    digest: string,
    versionName: string,
  ): Promise<{
    status: 'awaiting-user-confirmation';
    versionName: string;
    versionCode: number;
  }>;
}

type FetchLike = (
  input: string,
  init?: {
    headers?: Record<string, string>;
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

export function parseLatestRelease(
  value: unknown,
  installedVersionName: string,
): AndroidUpdateCheck {
  const installed = semanticVersion(installedVersionName, 'Installed app version');
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
  const installedVersion = normalizedVersion(installed);
  if (compareVersions(latest, installed) <= 0) {
    return { kind: 'up-to-date', installedVersion, latestVersion };
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
    installedVersion,
    release: {
      versionName: latestVersion,
      tagName,
      releaseName:
        typeof release.name === 'string' && release.name.trim().length > 0
          ? release.name.trim()
          : tagName,
      releaseUrl: validateReleaseUrl(
        text(release.html_url, 'GitHub release URL'),
        tagName,
        false,
      ),
      publishedAt: text(release.published_at, 'GitHub release publish date'),
      apkName,
      apkUrl: validateReleaseUrl(
        text(asset.browser_download_url, 'GitHub APK URL'),
        tagName,
        true,
      ),
      apkDigest,
      apkSize,
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
  downloadAndInstall: (url, digest, versionName) =>
    linkedAndroidUpdater().downloadAndInstall(url, digest, versionName),
};

export async function checkForAndroidUpdate(
  fetcher: FetchLike = fetch,
  updater: AndroidUpdaterPort = androidUpdater,
): Promise<AndroidUpdateCheck> {
  const installation = await updater.getInstallationInfo();
  const response = await fetcher(LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub update check failed with HTTP ${response.status}`);
  }
  return parseLatestRelease(await response.json(), installation.versionName);
}
