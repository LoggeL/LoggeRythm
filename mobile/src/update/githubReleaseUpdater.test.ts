import { NativeModules } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkForAndroidUpdate,
  checkLatestAndroidRelease,
  GITHUB_CHECK_TIMEOUT_MS,
  installedBuild,
  parseInstallationInfo,
  parseLatestRelease,
  releaseSummary,
  releaseVersionCode,
  subscribeAndroidUpdateDownloadProgress,
  type AndroidInstalledBuild,
  type AndroidUpdaterPort,
  type FetchLike,
} from './githubReleaseUpdater';
import { AndroidUpdateError, androidUpdateFailure } from './updateErrors';

const nativeListeners = new Map<string, (value: unknown) => void>();
const nativeSubscriptionRemove = vi.fn();

vi.mock('react-native', () => ({
  NativeModules: {},
  NativeEventEmitter: class {
    addListener(eventName: string, listener: (value: unknown) => void) {
      nativeListeners.set(eventName, listener);
      return { remove: nativeSubscriptionRemove };
    }
  },
  Platform: { OS: 'android' },
}));

/** The v1.0.16 release text as GitHub returns it (shortened prose, same structure). */
const V1016_BODY = [
  'Die Warteschlange lässt sich jetzt durch Ziehen umsortieren.',
  '',
  '**Warteschlange**',
  '- Jede kommende Zeile hat rechts einen Griff.',
  '- Ein Tipp auf den Griff blendet die Tasten ein.',
  '',
  'Der native Player ist gegenüber 1.0.15 unverändert.',
  '',
  '**Stand der Prüfung**',
  'Die Veröffentlichung folgt auf einen erfolgreichen Android-CI-Lauf.',
  '',
  'CI: https://github.com/LoggeL/LoggeRythm/actions/runs/44194885163',
  'Android-Versioncode: 10079',
  'APK SHA-256: `fa7997907f8649660c5d7b2f8575c3b8eabecfb58a6ae1d989a925fbd035d032`',
  '',
].join('\n');

const APK = {
  name: 'LoggeRythm-v1.0.16.apk',
  state: 'uploaded',
  size: 27_884_636,
  content_type: 'application/vnd.android.package-archive',
  digest: `sha256:${'a'.repeat(64)}`,
  browser_download_url:
    'https://github.com/LoggeL/LoggeRythm/releases/download/v1.0.16/LoggeRythm-v1.0.16.apk',
};

function release(overrides: Record<string, unknown> = {}) {
  return {
    draft: false,
    prerelease: false,
    tag_name: 'v1.0.16',
    name: 'LoggeRythm 1.0.16',
    html_url: 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.0.16',
    published_at: '2026-11-17T23:25:14Z',
    body: V1016_BODY,
    assets: [APK],
    ...overrides,
  };
}

function installed(versionName: string, versionCode: number): AndroidInstalledBuild {
  return { versionName, versionCode };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AndroidUpdateError) return error.code;
    throw new Error(`Expected an AndroidUpdateError, got ${String(error)}`);
  }
  throw new Error('Expected the call to throw');
}

describe('parseLatestRelease', () => {
  it('offers the release only when both its tag and its declared versionCode are higher', () => {
    expect(parseLatestRelease(release(), installed('1.0.15', 10071))).toEqual({
      kind: 'available',
      installed: installed('1.0.15', 10071),
      release: {
        versionName: '1.0.16',
        versionCode: 10079,
        tagName: 'v1.0.16',
        releaseName: 'LoggeRythm 1.0.16',
        releaseUrl: 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.0.16',
        publishedAt: '2026-11-17T23:25:14Z',
        apkName: 'LoggeRythm-v1.0.16.apk',
        apkUrl: APK.browser_download_url,
        apkDigest: APK.digest,
        apkSize: 27_884_636,
        summary: 'Die Warteschlange lässt sich jetzt durch Ziehen umsortieren.',
      },
    });
  });

  it('reports the real incident (local 1.0.15 build 10090 vs v1.0.16 build 10079) as newer-build without reading assets', () => {
    // Assets would be invalid: the result must not depend on them.
    const result = parseLatestRelease(release({ assets: 'not read' }), installed('1.0.15', 10090));
    expect(result).toEqual({
      kind: 'installed-newer',
      reason: 'newer-build',
      installed: installed('1.0.15', 10090),
      latestVersion: '1.0.16',
      latestVersionCode: 10079,
      releaseUrl: 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.0.16',
    });
  });

  it('treats an equal versionCode as not installable (newer-build)', () => {
    expect(parseLatestRelease(release(), installed('1.0.15', 10079))).toMatchObject({
      kind: 'installed-newer',
      reason: 'newer-build',
      latestVersionCode: 10079,
    });
  });

  it('reports a newer installed version name without reading the versionCode or assets', () => {
    expect(
      parseLatestRelease(release({ body: null, assets: null }), installed('1.0.17', 1)),
    ).toEqual({
      kind: 'installed-newer',
      reason: 'newer-name',
      installed: installed('1.0.17', 1),
      latestVersion: '1.0.16',
      latestVersionCode: null,
      releaseUrl: 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.0.16',
    });
  });

  it('is up to date on an equal version name, whatever the body or assets say', () => {
    expect(
      parseLatestRelease(release({ body: null, assets: [] }), installed('1.0.16', 10081)),
    ).toEqual({
      kind: 'up-to-date',
      installed: installed('1.0.16', 10081),
      latestVersion: '1.0.16',
    });
  });

  it.each([
    ['no versionCode line', 'Nur Text.', 'release-version-code-missing'],
    ['no body at all', null, 'release-version-code-missing'],
    ['two versionCode lines', 'Android-Versioncode: 10079\nAndroid-Versioncode: 10080', 'release-version-code-ambiguous'],
    ['a non-numeric versionCode', 'Android-Versioncode: 10079a', 'release-invalid'],
    ['a zero versionCode', 'Android-Versioncode: 0', 'release-invalid'],
    ['an empty versionCode', 'Android-Versioncode:', 'release-invalid'],
    ['a non-string body', 42, 'release-invalid'],
  ])('fails loudly on a newer release with %s', (_name, body, code) => {
    expect(codeOf(() => parseLatestRelease(release({ body }), installed('1.0.15', 10071)))).toBe(code);
  });

  it('carries the normalized release version on versionCode failures', () => {
    try {
      parseLatestRelease(release({ body: 'kein Code' }), installed('1.0.15', 10071));
      throw new Error('expected a failure');
    } catch (error) {
      expect(androidUpdateFailure(error)).toMatchObject({
        code: 'release-version-code-missing',
        releaseVersion: '1.0.16',
      });
    }
  });

  it('accepts the versionCode in backticks and with CRLF line endings', () => {
    expect(releaseVersionCode('Text\r\nAndroid-Versioncode: `10079`\r\n', 'v1.0.16')).toBe(10079);
  });

  it.each([
    ['prerelease', release({ prerelease: true })],
    ['draft', release({ draft: true })],
    ['missing digest', release({ assets: [{ ...APK, digest: null }] })],
    ['foreign APK URL', release({
      assets: [{ ...APK, browser_download_url: 'https://example.com/LoggeRythm.apk' }],
    })],
    ['ambiguous APKs', release({ assets: [APK, { ...APK, name: 'other.apk' }] })],
    ['an APK that is still uploading', release({ assets: [{ ...APK, state: 'starter' }] })],
    ['an unstable tag', release({ tag_name: 'v1.0.16-rc1' })],
  ])('rejects %s release metadata as release-invalid', (_name, candidate) => {
    expect(codeOf(() => parseLatestRelease(candidate, installed('1.0.15', 10071)))).toBe(
      'release-invalid',
    );
  });
});

describe('releaseSummary', () => {
  it('returns the first prose paragraph of the real v1.0.16 body', () => {
    expect(releaseSummary(V1016_BODY)).toBe(
      'Die Warteschlange lässt sich jetzt durch Ziehen umsortieren.',
    );
  });

  it('drops headings, bullets, emphasis, links and the versionCode line', () => {
    const body = [
      '**Neu**',
      '- Die **Suche** kennt jetzt die [Bibliothek](https://example.com/x) und `Alben`.',
      'Android-Versioncode: 10090',
    ].join('\n');
    expect(releaseSummary(body)).toBe('Die Suche kennt jetzt die Bibliothek und Alben.');
  });

  it('skips paragraphs that are only headings', () => {
    expect(releaseSummary('## Änderungen\n\n__Hinweis__\n\nEin Satz.')).toBe('Ein Satz.');
  });

  it('has no summary for a missing or empty body', () => {
    expect(releaseSummary(null)).toBeNull();
    expect(releaseSummary(undefined)).toBeNull();
    expect(releaseSummary('**Nur Überschrift**\n\nAndroid-Versioncode: 1\n')).toBeNull();
  });

  it('rejects a non-string body', () => {
    expect(codeOf(() => releaseSummary({}))).toBe('release-invalid');
  });
});

describe('installation info', () => {
  it('accepts a well-formed bridge value', () => {
    expect(
      parseInstallationInfo({ versionName: ' 1.0.15 ', versionCode: 10090, canRequestPackageInstalls: true }),
    ).toEqual({ versionName: '1.0.15', versionCode: 10090, canRequestPackageInstalls: true });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['an empty versionName', { versionName: ' ', versionCode: 1, canRequestPackageInstalls: true }],
    ['a zero versionCode', { versionName: '1.0.15', versionCode: 0, canRequestPackageInstalls: true }],
    ['a fractional versionCode', { versionName: '1.0.15', versionCode: 1.5, canRequestPackageInstalls: true }],
    ['a string versionCode', { versionName: '1.0.15', versionCode: '10090', canRequestPackageInstalls: true }],
    ['a missing permission flag', { versionName: '1.0.15', versionCode: 10090 }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseInstallationInfo(value)).toThrow();
  });

  it('normalizes the installed version or fails with installed-version-invalid', () => {
    expect(installedBuild({ versionName: 'v1.0.15', versionCode: 7, canRequestPackageInstalls: false }))
      .toEqual({ versionName: '1.0.15', versionCode: 7 });
    let thrown: unknown;
    try {
      installedBuild({ versionName: '1.0.15-dev', versionCode: 7, canRequestPackageInstalls: false });
    } catch (error) {
      thrown = error;
    }
    expect(androidUpdateFailure(thrown)).toMatchObject({
      code: 'installed-version-invalid',
      installedVersion: '1.0.15-dev',
    });
  });
});

describe('checkLatestAndroidRelease', () => {
  function respond(status: number, payload: unknown = release()): FetchLike {
    return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => payload }));
  }

  async function failureOf(fetcher: FetchLike) {
    try {
      await checkLatestAndroidRelease(installed('1.0.15', 10071), fetcher);
    } catch (error) {
      return androidUpdateFailure(error);
    }
    throw new Error('Expected the check to fail');
  }

  it('asks GitHub for the latest release and parses it', async () => {
    const fetcher = respond(200);
    await expect(checkLatestAndroidRelease(installed('1.0.15', 10071), fetcher)).resolves
      .toMatchObject({ kind: 'available' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/LoggeL/LoggeRythm/releases/latest',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/vnd.github+json' }) }),
    );
  });

  it('maps a network failure to network', async () => {
    const fetcher: FetchLike = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    expect(await failureOf(fetcher)).toEqual({
      code: 'network',
      message: 'GitHub could not be reached: Network request failed',
      httpStatus: null,
    });
  });

  it.each([403, 429])('maps HTTP %i to github-rate-limited', async (status) => {
    expect(await failureOf(respond(status))).toMatchObject({
      code: 'github-rate-limited',
      httpStatus: status,
    });
  });

  it('maps other HTTP errors to github-http', async () => {
    expect(await failureOf(respond(503))).toMatchObject({
      code: 'github-http',
      httpStatus: 503,
      message: 'GitHub update check failed with HTTP 503',
    });
  });

  it('maps an unreadable response to release-invalid', async () => {
    const fetcher: FetchLike = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    expect(await failureOf(fetcher)).toMatchObject({ code: 'release-invalid' });
  });

  describe('deadline', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** A request (or body) that never settles, as a stalled OkHttp call without timeouts. */
    function stalled<T>(): Promise<T> {
      return new Promise<T>(() => undefined);
    }

    async function timedOutFailure(fetcher: FetchLike) {
      const running = failureOf(fetcher);
      await vi.advanceTimersByTimeAsync(GITHUB_CHECK_TIMEOUT_MS);
      return running;
    }

    it('is 20 s, the API client budget', () => {
      expect(GITHUB_CHECK_TIMEOUT_MS).toBe(20_000);
    });

    it('fails a stalled request with network after 20 s and aborts it', async () => {
      let signal: AbortSignal | undefined;
      const fetcher: FetchLike = vi.fn((_url, init) => {
        signal = init?.signal;
        return stalled<Awaited<ReturnType<FetchLike>>>();
      });

      expect(await timedOutFailure(fetcher)).toEqual({
        code: 'network',
        message: 'GitHub did not answer within 20 s',
        httpStatus: null,
      });
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps waiting until the deadline itself', async () => {
      let settled = false;
      const fetcher: FetchLike = vi.fn(() => stalled<Awaited<ReturnType<FetchLike>>>());
      const running = checkLatestAndroidRelease(installed('1.0.15', 10071), fetcher).catch(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(GITHUB_CHECK_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(settled).toBe(true);
    });

    it('names the timeout, not the abort error, when the fetch rejects on abort', async () => {
      const fetcher: FetchLike = vi.fn((_url, init) =>
        new Promise<Awaited<ReturnType<FetchLike>>>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }));

      expect(await timedOutFailure(fetcher)).toMatchObject({
        code: 'network',
        message: 'GitHub did not answer within 20 s',
      });
    });

    it('covers reading the body as well', async () => {
      let signal: AbortSignal | undefined;
      const fetcher: FetchLike = vi.fn(async (_url, init) => {
        signal = init?.signal;
        return { ok: true, status: 200, json: () => stalled<unknown>() };
      });

      expect(await timedOutFailure(fetcher)).toEqual({
        code: 'network',
        message: 'GitHub did not answer within 20 s',
        httpStatus: null,
      });
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      ['a finished check', respond(200)],
      ['an HTTP failure', respond(503)],
      ['an unreachable GitHub', vi.fn(async () => {
        throw new TypeError('Network request failed');
      }) as FetchLike],
    ])('clears its timer after %s', async (_name, fetcher) => {
      await checkLatestAndroidRelease(installed('1.0.15', 10071), fetcher).catch(() => undefined);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('reads the installed build first and fails loudly on GitHub HTTP errors', async () => {
    const updater: AndroidUpdaterPort = {
      getInstallationInfo: vi.fn(async () => ({
        versionName: '1.0.3',
        versionCode: 3,
        canRequestPackageInstalls: false,
      })),
      openInstallPermissionSettings: vi.fn(),
      downloadAndInstall: vi.fn(),
    };
    await expect(checkForAndroidUpdate(respond(503), updater)).rejects.toThrow(
      'GitHub update check failed with HTTP 503',
    );
    expect(updater.getInstallationInfo).toHaveBeenCalledOnce();
  });
});

describe('download progress events', () => {
  // Every test links its own module and starts without listeners, so none
  // depends on what an earlier test left behind.
  beforeEach(() => {
    (NativeModules as Record<string, unknown>).LoggeRythmUpdater = {
      getInstallationInfo: vi.fn(),
      openInstallPermissionSettings: vi.fn(),
      downloadAndInstall: vi.fn(),
    };
    nativeListeners.clear();
    nativeSubscriptionRemove.mockClear();
  });

  function emitProgress(value: unknown) {
    const emit = nativeListeners.get('LoggeRythmUpdaterDownloadProgress');
    if (emit === undefined) throw new Error('No native download progress listener is registered');
    emit(value);
  }

  it('forwards valid native progress and reports invalid payloads with their cause', () => {
    const listener = vi.fn();
    const invalid = vi.fn();

    const unsubscribe = subscribeAndroidUpdateDownloadProgress(listener, invalid);
    emitProgress({ downloadedBytes: 2048, totalBytes: 4096 });
    emitProgress({ downloadedBytes: 8192, totalBytes: 4096 });
    unsubscribe();

    expect(listener).toHaveBeenCalledWith({ downloadedBytes: 2048, totalBytes: 4096 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(invalid).toHaveBeenCalledOnce();
    expect(invalid.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(nativeSubscriptionRemove).toHaveBeenCalledOnce();
  });

  it('does not disguise a throwing listener as an invalid event', () => {
    const invalid = vi.fn();
    subscribeAndroidUpdateDownloadProgress(() => {
      throw new Error('listener bug');
    }, invalid);
    expect(() => emitProgress({ downloadedBytes: 1, totalBytes: 2 })).toThrow('listener bug');
    expect(invalid).not.toHaveBeenCalled();
  });

  it('fails loudly when the native module is not linked', () => {
    delete (NativeModules as Record<string, unknown>).LoggeRythmUpdater;
    expect(() => subscribeAndroidUpdateDownloadProgress(vi.fn(), vi.fn()))
      .toThrow('LoggeRythm updater native module is not linked');
    expect(nativeListeners.size).toBe(0);
  });
});
