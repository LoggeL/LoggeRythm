import { describe, expect, it, vi } from 'vitest';
import {
  checkForAndroidUpdate,
  parseLatestRelease,
  type AndroidUpdaterPort,
} from './githubReleaseUpdater';

vi.mock('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'android' },
}));

function release(overrides: Record<string, unknown> = {}) {
  return {
    draft: false,
    prerelease: false,
    tag_name: 'v1.2.0',
    name: 'LoggeRythm 1.2.0',
    html_url: 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.2.0',
    published_at: '2026-07-17T12:00:00Z',
    assets: [{
      name: 'LoggeRythm-v1.2.0.apk',
      state: 'uploaded',
      size: 42_000_000,
      content_type: 'application/vnd.android.package-archive',
      digest: `sha256:${'a'.repeat(64)}`,
      browser_download_url:
        'https://github.com/LoggeL/LoggeRythm/releases/download/v1.2.0/LoggeRythm-v1.2.0.apk',
    }],
    ...overrides,
  };
}

describe('GitHub release updater', () => {
  it('selects one newer stable GitHub APK with its required digest', () => {
    expect(parseLatestRelease(release(), '1.1.9')).toEqual({
      kind: 'available',
      installedVersion: '1.1.9',
      release: expect.objectContaining({
        versionName: '1.2.0',
        tagName: 'v1.2.0',
        apkName: 'LoggeRythm-v1.2.0.apk',
        apkDigest: `sha256:${'a'.repeat(64)}`,
      }),
    });
  });

  it('does not require an asset download when the installed version is current', () => {
    expect(parseLatestRelease(release({ assets: [] }), '1.2.0')).toEqual({
      kind: 'up-to-date',
      installedVersion: '1.2.0',
      latestVersion: '1.2.0',
    });
  });

  it.each([
    ['prerelease', release({ prerelease: true })],
    ['draft', release({ draft: true })],
    ['missing digest', release({
      assets: [{ ...(release().assets[0] as object), digest: null }],
    })],
    ['foreign APK URL', release({
      assets: [{
        ...(release().assets[0] as object),
        browser_download_url: 'https://example.com/LoggeRythm.apk',
      }],
    })],
    ['ambiguous APKs', release({
      assets: [
        release().assets[0],
        { ...(release().assets[0] as object), name: 'other.apk' },
      ],
    })],
  ])('rejects %s release metadata', (_name, candidate) => {
    expect(() => parseLatestRelease(candidate, '1.1.0')).toThrow();
  });

  it('reads installed version first and fails loudly on GitHub HTTP errors', async () => {
    const updater: AndroidUpdaterPort = {
      getInstallationInfo: vi.fn(async () => ({
        versionName: '1.0.3',
        versionCode: 3,
        canRequestPackageInstalls: false,
      })),
      openInstallPermissionSettings: vi.fn(),
      downloadAndInstall: vi.fn(),
    };
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => release(),
    }));

    await expect(checkForAndroidUpdate(fetcher, updater)).rejects.toThrow(
      'GitHub update check failed with HTTP 503',
    );
    expect(updater.getInstallationInfo).toHaveBeenCalledOnce();
  });
});
