import { describe, expect, it, vi } from 'vitest';
import {
  FINAL_FAILURE_STORAGE_KEY,
  FOREGROUND_RECHECK_MS,
  PENDING_INSTALL_STORAGE_KEY,
  PROFILE_RECHECK_MS,
  androidUpdateAttention,
  androidUpdateNeedsAttention,
  androidUpdateResultCheckedAt,
  availableAndroidUpdate,
  createAndroidUpdateStore,
  currentAndroidUpdateResult,
  visibleAndroidUpdateStartupNotes,
  type AndroidUpdateSnapshot,
  type AndroidUpdateStoreDependencies,
} from './androidUpdateStore';
import {
  GITHUB_CHECK_TIMEOUT_MS,
  type AndroidInstallationInfo,
  type AndroidInstallOutcome,
  type AndroidUpdateDownloadProgress,
  type AndroidUpdateRelease,
  type FetchLike,
} from './githubReleaseUpdater';
import {
  activateLocale,
  getActiveLocale,
  onLocaleActivated,
  type AppLocale,
} from '../localization';

vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  NativeEventEmitter: class {},
  NativeModules: {},
  PermissionsAndroid: { request: vi.fn(), PERMISSIONS: { POST_NOTIFICATIONS: 'post' } },
  Platform: { OS: 'android', Version: 35 },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));

const APK_URL =
  'https://github.com/LoggeL/LoggeRythm/releases/download/v1.0.17/LoggeRythm-v1.0.17.apk';

function githubRelease(tag = 'v1.0.17', versionCode = 10085) {
  return {
    draft: false,
    prerelease: false,
    tag_name: tag,
    name: `LoggeRythm ${tag}`,
    html_url: `https://github.com/LoggeL/LoggeRythm/releases/tag/${tag}`,
    published_at: '2026-11-18T10:00:00Z',
    body: `Neue Funktionen.\n\nAndroid-Versioncode: ${versionCode}\n`,
    assets: [{
      name: `LoggeRythm-${tag}.apk`,
      state: 'uploaded',
      size: 28_000_000,
      content_type: 'application/vnd.android.package-archive',
      digest: `sha256:${'b'.repeat(64)}`,
      browser_download_url: `https://github.com/LoggeL/LoggeRythm/releases/download/${tag}/LoggeRythm-${tag}.apk`,
    }],
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<AndroidUpdateStoreDependencies> = {}) {
  const calls: string[] = [];
  let clock = 1_000_000;
  let installation: AndroidInstallationInfo = {
    versionName: '1.0.16',
    versionCode: 10079,
    canRequestPackageInstalls: true,
  };
  let payload: unknown = githubRelease();
  const storage = new Map<string, string>();
  const appStateListeners: ((state: string) => void)[] = [];
  let progressListener: ((progress: AndroidUpdateDownloadProgress) => void) | null = null;
  let progressInvalid: ((error: unknown) => void) | null = null;
  const unsubscribeProgress = vi.fn();
  let storedOutcome: AndroidInstallOutcome | null = null;
  let outcomeListener: ((outcome: AndroidInstallOutcome) => void) | null = null;
  let outcomeInvalid: ((error: unknown) => void) | null = null;
  // Android numbers sessions; the first one this harness submits is 101.
  let lastSessionId = 100;
  let appLocale: AppLocale = 'de';
  const localeListeners = new Set<(locale: AppLocale) => void>();

  const fetcher = vi.fn<FetchLike>(async () => {
    calls.push('fetch');
    return { ok: true, status: 200, json: async () => payload };
  });
  const updater = {
    getInstallationInfo: vi.fn(async () => {
      calls.push('getInstallationInfo');
      return { ...installation };
    }),
    openInstallPermissionSettings: vi.fn(async () => {
      calls.push('openInstallPermissionSettings');
    }),
    downloadAndInstall: vi.fn(
      async (_url: string, _digest: string, versionName: string, versionCode: number) => {
        calls.push('downloadAndInstall');
        lastSessionId += 1;
        return { status: 'awaiting-user-confirmation' as const, versionName, versionCode, sessionId: lastSessionId };
      },
    ),
  };
  const deps: AndroidUpdateStoreDependencies = {
    platformOS: 'android',
    platformVersion: 35,
    updater,
    fetcher,
    now: () => clock,
    storage: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        calls.push(`setItem:${value}`);
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        calls.push('removeItem');
        storage.delete(key);
      }),
    },
    appState: {
      addEventListener: vi.fn((_type: 'change', listener: (state: string) => void) => {
        appStateListeners.push(listener);
        return { remove: vi.fn() };
      }),
    },
    requestNotificationPermission: vi.fn(async () => {
      calls.push('requestNotificationPermission');
      return 'granted';
    }),
    subscribeProgress: vi.fn((listener, onInvalid) => {
      calls.push('subscribeProgress');
      progressListener = listener;
      progressInvalid = onInvalid;
      return unsubscribeProgress;
    }),
    // Mirrors the native side: the receiver stores the outcome, consuming reads and clears it.
    consumeInstallOutcome: vi.fn(async () => {
      calls.push('consumeInstallOutcome');
      const outcome = storedOutcome;
      storedOutcome = null;
      return outcome;
    }),
    subscribeInstallOutcome: vi.fn((listener, onInvalid) => {
      outcomeListener = listener;
      outcomeInvalid = onInvalid;
      return vi.fn();
    }),
    setAppLocale: vi.fn(async (_locale: AppLocale) => undefined),
    activeLocale: () => appLocale,
    subscribeLocale: vi.fn((listener: (locale: AppLocale) => void) => {
      localeListeners.add(listener);
      return () => {
        localeListeners.delete(listener);
      };
    }),
    ...overrides,
  };
  const store = createAndroidUpdateStore(deps);
  return {
    store,
    /** A new process: a fresh store on the same storage and native side. */
    restart() {
      return createAndroidUpdateStore(deps);
    },
    lastSessionId: () => lastSessionId,
    deps,
    updater,
    fetcher,
    calls,
    storage,
    unsubscribeProgress,
    advance(ms: number) {
      clock += ms;
    },
    setInstallation(next: Partial<AndroidInstallationInfo>) {
      installation = { ...installation, ...next };
    },
    setPayload(next: unknown) {
      payload = next;
    },
    emitAppState(state: string) {
      appStateListeners.forEach((listener) => listener(state));
    },
    emitProgress(progress: AndroidUpdateDownloadProgress) {
      if (progressListener === null) throw new Error('no progress subscription');
      progressListener(progress);
    },
    emitInvalidProgress(error: unknown) {
      if (progressInvalid === null) throw new Error('no progress subscription');
      progressInvalid(error);
    },
    /** The native receiver stored an outcome (no live module told JS). */
    storeOutcome(outcome: AndroidInstallOutcome) {
      storedOutcome = outcome;
    },
    storedOutcome: () => storedOutcome,
    /** The native receiver stored an outcome and the live module emitted it. */
    reportOutcome(outcome: AndroidInstallOutcome) {
      if (outcomeListener === null) throw new Error('no install outcome subscription');
      storedOutcome = outcome;
      outcomeListener(outcome);
    },
    /** The app activated `locale` (bootstrap or the user's choice). */
    activateLocale(locale: AppLocale) {
      appLocale = locale;
      localeListeners.forEach((listener) => listener(locale));
    },
    emitInvalidOutcome(error: unknown) {
      if (outcomeInvalid === null) throw new Error('no install outcome subscription');
      outcomeInvalid(error);
    },
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function nativeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Ends session 101, the first one a harness submits. */
const ABORTED: AndroidInstallOutcome = {
  code: 'updater-install-aborted',
  message: 'Install aborted (status 3)',
  sessionId: 101,
  versionName: '1.0.17',
  versionCode: 10085,
};

type Submitted = {
  status: 'awaiting-user-confirmation';
  versionName: string;
  versionCode: number;
  sessionId: number;
};
const SUBMITTED: Submitted = {
  status: 'awaiting-user-confirmation',
  versionName: '1.0.17',
  versionCode: 10085,
  sessionId: 900,
};
const MARKER_17 = JSON.stringify({ versionName: '1.0.17', versionCode: 10085 });

describe('androidUpdateStore checks', () => {
  it('single-flights concurrent checks into one GitHub request', async () => {
    const { store, fetcher } = setup();
    const first = store.check('manual');
    const second = store.check('profile');
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(store.getSnapshot().check).toMatchObject({ kind: 'done', result: { kind: 'available' } });
    expect(store.getSnapshot().installed).toEqual({ versionName: '1.0.16', versionCode: 10079 });
  });

  it('skips fresh results for foreground and profile, never for manual', async () => {
    const harness = setup();
    await harness.store.check('startup');
    await harness.store.check('foreground');
    await harness.store.check('profile');
    expect(harness.fetcher).toHaveBeenCalledTimes(1);

    harness.advance(PROFILE_RECHECK_MS);
    await harness.store.check('foreground');
    expect(harness.fetcher).toHaveBeenCalledTimes(1);
    await harness.store.check('profile');
    expect(harness.fetcher).toHaveBeenCalledTimes(2);

    harness.advance(FOREGROUND_RECHECK_MS);
    await harness.store.check('foreground');
    expect(harness.fetcher).toHaveBeenCalledTimes(3);

    await harness.store.check('manual');
    await harness.store.check('manual');
    expect(harness.fetcher).toHaveBeenCalledTimes(5);
  });

  it('keeps the previous result visible while checking and after a failure', async () => {
    const harness = setup();
    await harness.store.check('startup');
    const firstCheckedAt = androidUpdateResultCheckedAt(harness.store.getSnapshot());
    const firstResult = currentAndroidUpdateResult(harness.store.getSnapshot());
    expect(firstResult?.kind).toBe('available');

    harness.advance(5_000);
    const gate = deferred<Awaited<ReturnType<FetchLike>>>();
    harness.fetcher.mockImplementationOnce(() => gate.promise);
    const running = harness.store.check('manual');
    await flush();
    const checking = harness.store.getSnapshot();
    expect(checking.check).toEqual({
      kind: 'checking',
      previous: firstResult,
      previousCheckedAt: firstCheckedAt,
    });
    expect(currentAndroidUpdateResult(checking)).toBe(firstResult);
    expect(androidUpdateNeedsAttention(checking)).toBe(true);

    gate.resolve({ ok: false, status: 503, json: async () => null });
    await running;
    const failed = harness.store.getSnapshot();
    expect(failed.check).toMatchObject({
      kind: 'failed',
      failure: { code: 'github-http', httpStatus: 503 },
      checkedAt: firstCheckedAt! + 5_000,
      previous: firstResult,
      previousCheckedAt: firstCheckedAt,
    });
    expect(currentAndroidUpdateResult(failed)).toBe(firstResult);
    // The result shown is still the one of the last finished check.
    expect(androidUpdateResultCheckedAt(failed)).toBe(firstCheckedAt);
  });

  it('dates the kept result by the last finished check when a re-check follows a failure', async () => {
    const harness = setup();
    await harness.store.check('startup');
    const doneAt = androidUpdateResultCheckedAt(harness.store.getSnapshot());
    expect(doneAt).not.toBeNull();
    const doneResult = currentAndroidUpdateResult(harness.store.getSnapshot());

    harness.advance(60_000);
    harness.fetcher.mockResolvedValueOnce({ ok: false, status: 503, json: async () => null });
    await harness.store.check('manual');
    expect(harness.store.getSnapshot().check).toMatchObject({
      kind: 'failed',
      checkedAt: doneAt! + 60_000,
      previous: doneResult,
      previousCheckedAt: doneAt,
    });

    harness.advance(60_000);
    const gate = deferred<Awaited<ReturnType<FetchLike>>>();
    harness.fetcher.mockImplementationOnce(() => gate.promise);
    const running = harness.store.check('manual');
    await flush();
    // Not the failed check's time: that check produced no result.
    expect(harness.store.getSnapshot().check).toEqual({
      kind: 'checking',
      previous: doneResult,
      previousCheckedAt: doneAt,
    });

    // A second failure in a row still carries the same time.
    gate.resolve({ ok: false, status: 503, json: async () => null });
    await running;
    expect(harness.store.getSnapshot().check).toMatchObject({
      kind: 'failed',
      checkedAt: doneAt! + 120_000,
      previous: doneResult,
      previousCheckedAt: doneAt,
    });
  });

  it('carries no check time when a check fails before any finished', async () => {
    const harness = setup();
    harness.fetcher.mockResolvedValueOnce({ ok: false, status: 503, json: async () => null });
    await harness.store.check('startup');
    expect(harness.store.getSnapshot().check).toMatchObject({
      kind: 'failed',
      previous: null,
      previousCheckedAt: null,
    });
    expect(androidUpdateResultCheckedAt(harness.store.getSnapshot())).toBeNull();
  });

  it('reports the incident build as installed-newer and never offers it', async () => {
    const harness = setup();
    harness.setInstallation({ versionName: '1.0.15', versionCode: 10090 });
    harness.setPayload(githubRelease('v1.0.16', 10079));
    await harness.store.check('manual');
    const snapshot = harness.store.getSnapshot();
    expect(currentAndroidUpdateResult(snapshot)).toMatchObject({
      kind: 'installed-newer',
      reason: 'newer-build',
      latestVersionCode: 10079,
    });
    expect(availableAndroidUpdate(snapshot)).toBeNull();
    expect(androidUpdateNeedsAttention(snapshot)).toBe(false);
  });

  it('fails the check with the native code when the installation cannot be read', async () => {
    const harness = setup();
    harness.updater.getInstallationInfo.mockRejectedValueOnce(
      nativeError('updater-installed-package-missing', 'Package missing'),
    );
    await harness.store.check('manual');
    expect(harness.store.getSnapshot().check).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-installed-package-missing', message: 'Package missing' },
      previous: null,
    });
    expect(harness.fetcher).not.toHaveBeenCalled();
  });

  it('does not check while the update downloads', async () => {
    const harness = setup();
    await harness.store.check('startup');
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    const installing = harness.store.install();
    await flush();
    expect(harness.store.getSnapshot().install.kind).toBe('downloading');

    await harness.store.check('manual');
    expect(harness.fetcher).toHaveBeenCalledOnce();

    download.resolve(SUBMITTED);
    await installing;
  });

  it('keeps checking while it waits for the installer confirmation', async () => {
    const harness = setup();
    await harness.store.check('startup');
    await harness.store.install();
    expect(harness.store.getSnapshot().install.kind).toBe('awaiting-confirmation');

    // Same release still offered: the wait stays.
    await harness.store.check('manual');
    expect(harness.fetcher).toHaveBeenCalledTimes(2);
    expect(harness.store.getSnapshot().install.kind).toBe('awaiting-confirmation');

    // A newer release replaced it: the old wait is stale.
    harness.setPayload(githubRelease('v1.0.18', 10090));
    await harness.store.check('manual');
    expect(harness.store.getSnapshot().install).toEqual({ kind: 'idle' });
    expect(availableAndroidUpdate(harness.store.getSnapshot())?.versionName).toBe('1.0.18');
  });

  it('re-checks after a failed check on the next trigger, but keeps the throttle after a rate limit', async () => {
    const harness = setup();
    harness.fetcher.mockRejectedValueOnce(new TypeError('Network request failed'));
    await harness.store.check('startup');
    expect(harness.store.getSnapshot().check).toMatchObject({ kind: 'failed', failure: { code: 'network' } });

    await harness.store.check('foreground');
    expect(harness.fetcher).toHaveBeenCalledTimes(2);
    expect(harness.store.getSnapshot().check.kind).toBe('done');

    harness.fetcher.mockResolvedValueOnce({ ok: false, status: 500, json: async () => null });
    await harness.store.check('manual');
    await harness.store.check('profile');
    expect(harness.fetcher).toHaveBeenCalledTimes(4);

    harness.fetcher.mockResolvedValueOnce({ ok: false, status: 403, json: async () => null });
    await harness.store.check('manual');
    expect(harness.store.getSnapshot().check).toMatchObject({
      kind: 'failed',
      failure: { code: 'github-rate-limited' },
    });
    await harness.store.check('profile');
    await harness.store.check('foreground');
    expect(harness.fetcher).toHaveBeenCalledTimes(5);
    harness.advance(PROFILE_RECHECK_MS);
    await harness.store.check('profile');
    expect(harness.fetcher).toHaveBeenCalledTimes(6);
  });

  it('drops a failed install of a release the next check no longer offers', async () => {
    const harness = setup();
    await harness.store.check('startup');
    harness.updater.downloadAndInstall.mockRejectedValueOnce(
      nativeError('updater-digest-mismatch', 'Digest mismatch'),
    );
    await harness.store.install();
    expect(harness.store.getSnapshot().install.kind).toBe('failed');

    // Same release still offered: the failure stays visible.
    await harness.store.check('manual');
    expect(harness.store.getSnapshot().install.kind).toBe('failed');

    // The installation caught up (e.g. installed by hand): nothing to install any more.
    harness.setInstallation({ versionName: '1.0.17', versionCode: 10085 });
    await harness.store.check('manual');
    const snapshot = harness.store.getSnapshot();
    expect(snapshot.install).toEqual({ kind: 'idle' });
    expect(androidUpdateNeedsAttention(snapshot)).toBe(false);
  });

  it('does nothing on an unsupported platform', async () => {
    const harness = setup({ platformOS: 'ios' });
    await harness.store.check('manual');
    await harness.store.install();
    await expect(harness.store.start()).resolves.toEqual({ updatedTo: null, failures: [] });
    expect(harness.fetcher).not.toHaveBeenCalled();
    expect(harness.updater.getInstallationInfo).not.toHaveBeenCalled();
    expect(harness.deps.appState.addEventListener).not.toHaveBeenCalled();
    expect(harness.store.getSnapshot()).toEqual({
      supported: false,
      installed: null,
      check: { kind: 'idle' },
      install: { kind: 'idle' },
      updatedTo: null,
      orphanedInstallFailure: null,
      startupNotes: [],
    });
  });
});

describe('androidUpdateStore install', () => {
  it('writes the marker before the download and walks through progress to confirmation', async () => {
    const harness = setup();
    await harness.store.check('startup');
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(async (...args) => {
      harness.calls.push('downloadAndInstall');
      expect(args).toEqual([APK_URL, `sha256:${'b'.repeat(64)}`, '1.0.17', 10085]);
      return download.promise;
    });
    harness.calls.length = 0;

    const installing = harness.store.install();
    await flush();
    const marker = JSON.stringify({ versionName: '1.0.17', versionCode: 10085 });
    expect(harness.calls).toEqual([
      'getInstallationInfo',
      'requestNotificationPermission',
      `setItem:${marker}`,
      'subscribeProgress',
      'downloadAndInstall',
    ]);
    expect(harness.storage.get(PENDING_INSTALL_STORAGE_KEY)).toBe(marker);
    expect(harness.store.getSnapshot().install).toMatchObject({ kind: 'downloading', progress: null });

    harness.emitProgress({ downloadedBytes: 1_000, totalBytes: 28_000_000 });
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'downloading',
      progress: { downloadedBytes: 1_000, totalBytes: 28_000_000 },
    });

    download.resolve(SUBMITTED);
    await installing;
    const snapshot = harness.store.getSnapshot();
    expect(snapshot.install).toMatchObject({
      kind: 'awaiting-confirmation',
      release: { versionName: '1.0.17', versionCode: 10085 },
    });
    expect(harness.unsubscribeProgress).toHaveBeenCalledOnce();
    expect(androidUpdateNeedsAttention(snapshot)).toBe(true);
  });

  it('opens the permission settings and re-reads the permission on return to the app', async () => {
    const harness = setup();
    harness.setInstallation({ canRequestPackageInstalls: false });
    await harness.store.start();
    await harness.store.install();
    expect(harness.updater.openInstallPermissionSettings).toHaveBeenCalledOnce();
    expect(harness.updater.downloadAndInstall).not.toHaveBeenCalled();
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
    expect(harness.store.getSnapshot().install.kind).toBe('permission');

    // Returning without granting keeps the permission state.
    harness.emitAppState('active');
    await flush();
    expect(harness.store.getSnapshot().install.kind).toBe('permission');
    harness.emitAppState('background');

    harness.setInstallation({ canRequestPackageInstalls: true });
    harness.emitAppState('active');
    await flush();
    const snapshot = harness.store.getSnapshot();
    expect(snapshot.install).toEqual({ kind: 'idle' });
    expect(availableAndroidUpdate(snapshot)?.versionName).toBe('1.0.17');
    expect(harness.updater.downloadAndInstall).not.toHaveBeenCalled();
  });

  it('asks for the notification permission once per process, only on API 33+', async () => {
    const modern = setup();
    await modern.store.check('startup');
    await modern.store.install();
    await modern.store.install();
    expect(modern.deps.requestNotificationPermission).toHaveBeenCalledOnce();
    expect(modern.updater.downloadAndInstall).toHaveBeenCalledTimes(2);

    const legacy = setup({ platformVersion: 32 });
    await legacy.store.check('startup');
    await legacy.store.install();
    expect(legacy.deps.requestNotificationPermission).not.toHaveBeenCalled();
    expect(legacy.updater.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it('shows a native rejection as a failed install with the native code', async () => {
    const harness = setup();
    await harness.store.check('startup');
    harness.updater.downloadAndInstall.mockRejectedValueOnce(
      nativeError('updater-apk-not-newer', 'Update APK version code is not newer than the installed app'),
    );
    await harness.store.install();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      release: { versionName: '1.0.17' },
      failure: {
        code: 'updater-apk-not-newer',
        message: 'Update APK version code is not newer than the installed app',
      },
    });
    expect(harness.unsubscribeProgress).toHaveBeenCalledOnce();
  });

  it.each([
    ['another versionCode', { status: 'awaiting-user-confirmation', versionName: '1.0.17', versionCode: 10084 }, 'versionCode 10084'],
    ['another versionName', { status: 'awaiting-user-confirmation', versionName: '1.0.18', versionCode: 10085 }, 'version 1.0.18'],
    ['an unknown status', { status: 'installed', versionName: '1.0.17', versionCode: 10085 }, 'Unexpected Android installer state'],
    ['no session id', { status: 'awaiting-user-confirmation', versionName: '1.0.17', versionCode: 10085 }, 'session id undefined'],
    ['null', null, 'returned null'],
  ])('fails when the native result reports %s', async (_name, result, message) => {
    const harness = setup();
    await harness.store.check('startup');
    harness.updater.downloadAndInstall.mockResolvedValueOnce(result as never);
    await harness.store.install();
    const install = harness.store.getSnapshot().install;
    expect(install.kind).toBe('failed');
    expect(install.kind === 'failed' && install.failure.message).toContain(message);
  });

  it('reports an invalid progress event once the download settled, as a warning when Android got the APK', async () => {
    const harness = setup();
    await harness.store.start();
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    const installing = harness.store.install();
    await flush();
    harness.emitInvalidProgress(new Error('downloadedBytes exceeds totalBytes'));
    // The native download still runs: the card keeps showing it, and a check
    // cannot reset it.
    expect(harness.store.getSnapshot().install.kind).toBe('downloading');
    await harness.store.check('manual');
    expect(harness.fetcher).toHaveBeenCalledOnce();
    harness.emitProgress({ downloadedBytes: 5_000, totalBytes: 28_000_000 });
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'downloading',
      progress: { downloadedBytes: 5_000 },
    });

    download.resolve(SUBMITTED);
    await installing;
    // Android's installer has the verified APK and asks the user: the wait is
    // real, so the card shows it, with the bridge bug next to it.
    expect(harness.store.getSnapshot().install).toEqual({
      kind: 'awaiting-confirmation',
      release: expect.objectContaining({ versionName: '1.0.17' }),
      warning: {
        code: null,
        httpStatus: null,
        message:
          "Android update progress event was invalid: downloadedBytes exceeds totalBytes. The verified APK was still handed to Android's installer",
      },
    });
    // The APK reached Android's installer, so its own outcome decides the marker.
    expect(harness.storage.get(PENDING_INSTALL_STORAGE_KEY)).toBe(MARKER_17);
    expect(harness.updater.downloadAndInstall).toHaveBeenCalledOnce();
    // Its outcome still ends the wait.
    harness.reportOutcome({ ...ABORTED, sessionId: 900 });
    await flush();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-install-aborted' },
    });
  });

  it('adds an invalid progress event to a native failure of the same download', async () => {
    const harness = setup();
    await harness.store.check('startup');
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    const installing = harness.store.install();
    await flush();
    harness.emitInvalidProgress(new Error('totalBytes is negative'));
    download.reject(nativeError('updater-download-io', 'Update APK download failed'));
    await installing;
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: {
        code: 'updater-download-io',
        message:
          'Update APK download failed (also: Android update progress event was invalid: totalBytes is negative)',
      },
    });
  });

  it('refuses a second install while one runs instead of ignoring the tap', async () => {
    const harness = setup();
    await harness.store.check('startup');
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    const installing = harness.store.install();
    await flush();
    await expect(harness.store.install()).rejects.toThrow('Android update install is already running');
    expect(harness.updater.downloadAndInstall).toHaveBeenCalledOnce();
    download.resolve(SUBMITTED);
    await installing;
    // Settled: a new attempt may start (e.g. the confirmation got lost).
    await harness.store.install();
    expect(harness.updater.downloadAndInstall).toHaveBeenCalledTimes(2);
  });

  it('removes the pending-install marker when the native install rejects', async () => {
    const harness = setup();
    await harness.store.check('startup');
    harness.updater.downloadAndInstall.mockRejectedValueOnce(
      nativeError('updater-download-http', 'Update download failed with HTTP 502'),
    );
    await harness.store.install();
    expect(harness.store.getSnapshot().install.kind).toBe('failed');
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
  });

  it('keeps the marker when Android has the APK but its reply is malformed', async () => {
    const harness = setup();
    await harness.store.check('startup');
    harness.updater.downloadAndInstall.mockResolvedValueOnce({ ...SUBMITTED, versionCode: 10084 });
    await harness.store.install();
    expect(harness.store.getSnapshot().install.kind).toBe('failed');
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(true);
  });

  it('shows a failed marker removal together with the install failure', async () => {
    const harness = setup();
    await harness.store.check('startup');
    harness.updater.downloadAndInstall.mockRejectedValueOnce(
      nativeError('updater-download-io', 'Update APK download failed'),
    );
    vi.mocked(harness.deps.storage.removeItem).mockRejectedValueOnce(new Error('disk full'));
    await harness.store.install();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-download-io', message: 'Update APK download failed (also: disk full)' },
    });
  });

  it('keeps a final failure of this session on top until a manual re-check acknowledges it', async () => {
    const harness = setup();
    await harness.store.check('startup');
    harness.updater.downloadAndInstall.mockRejectedValueOnce(
      nativeError('updater-signature-mismatch', 'Update APK signing certificate does not match'),
    );
    await harness.store.install();
    const failed = harness.store.getSnapshot();
    expect(failed.install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-signature-mismatch' },
      unacknowledged: true,
    });
    // The user watched the download; the card stays where they look.
    expect(androidUpdateNeedsAttention(failed)).toBe(true);
    // A profile or foreground check is no answer from the user.
    harness.advance(PROFILE_RECHECK_MS);
    await harness.store.check('profile');
    expect(androidUpdateNeedsAttention(harness.store.getSnapshot())).toBe(true);

    await harness.store.check('manual');
    const acknowledged = harness.store.getSnapshot();
    expect(acknowledged.install).toEqual({
      kind: 'failed',
      release: expect.objectContaining({ versionCode: 10085 }),
      failure: expect.objectContaining({ code: 'updater-signature-mismatch' }),
    });
    expect(androidUpdateNeedsAttention(acknowledged)).toBe(false);
  });

  it('moves a final failure of this session to the bottom once the user left the profile', async () => {
    const harness = setup();
    await harness.store.check('startup');
    harness.updater.downloadAndInstall.mockRejectedValueOnce(
      nativeError('updater-digest-mismatch', 'Digest mismatch'),
    );
    await harness.store.install();
    expect(androidUpdateNeedsAttention(harness.store.getSnapshot())).toBe(true);
    harness.store.acknowledgeFinalFailure();
    expect(androidUpdateNeedsAttention(harness.store.getSnapshot())).toBe(false);
    // Idempotent, and a retryable failure is never moved.
    harness.store.acknowledgeFinalFailure();
    expect(harness.store.getSnapshot().install).toMatchObject({ kind: 'failed', failure: { code: 'updater-digest-mismatch' } });
    const retryable = setup();
    await retryable.store.check('startup');
    retryable.updater.downloadAndInstall.mockRejectedValueOnce(nativeError('updater-download-io', 'Update APK download failed'));
    await retryable.store.install();
    const before = retryable.store.getSnapshot();
    retryable.store.acknowledgeFinalFailure();
    expect(retryable.store.getSnapshot()).toBe(before);
    expect(androidUpdateNeedsAttention(before)).toBe(true);
  });

  it('throws when nothing is installable', async () => {
    const harness = setup();
    harness.setPayload(githubRelease('v1.0.16', 10079));
    await harness.store.check('startup');
    await expect(harness.store.install()).rejects.toThrow('No installable Android update is known');
  });
});

describe('androidUpdateStore start', () => {
  it('reports updatedTo when the installed versionCode reached the marker', async () => {
    const harness = setup();
    harness.storage.set(
      PENDING_INSTALL_STORAGE_KEY,
      JSON.stringify({ versionName: '1.0.16', versionCode: 10079 }),
    );
    harness.setPayload(githubRelease('v1.0.16', 10079));
    await expect(harness.store.start()).resolves.toEqual({ updatedTo: '1.0.16', failures: [] });
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
    expect(harness.store.getSnapshot().updatedTo).toBe('1.0.16');
    expect(harness.store.getSnapshot().check).toMatchObject({ result: { kind: 'up-to-date' } });
  });

  it('reports nothing when the installed versionCode is still lower than the marker', async () => {
    const harness = setup();
    harness.storage.set(
      PENDING_INSTALL_STORAGE_KEY,
      JSON.stringify({ versionName: '1.0.17', versionCode: 10085 }),
    );
    await expect(harness.store.start()).resolves.toEqual({ updatedTo: null, failures: [] });
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
    expect(harness.store.getSnapshot().updatedTo).toBeNull();
  });

  it('names the installed version when it is newer than the marker', async () => {
    const harness = setup();
    harness.storage.set(
      PENDING_INSTALL_STORAGE_KEY,
      JSON.stringify({ versionName: '1.0.17', versionCode: 10085 }),
    );
    harness.setInstallation({ versionName: '1.0.18', versionCode: 10090 });
    harness.setPayload(githubRelease('v1.0.18', 10090));
    await expect(harness.store.start()).resolves.toEqual({ updatedTo: '1.0.18', failures: [] });
    expect(harness.store.getSnapshot().updatedTo).toBe('1.0.18');
  });

  it.each([
    ['not JSON', '{oops'],
    ['a wrong shape', JSON.stringify({ versionName: '1.0.17', versionCode: '10085' })],
    ['null', 'null'],
  ])('reports an invalid marker (%s) as update-marker-invalid and removes it', async (_name, raw) => {
    const harness = setup();
    harness.storage.set(PENDING_INSTALL_STORAGE_KEY, raw);
    const report = await harness.store.start();
    expect(report.updatedTo).toBeNull();
    expect(report.failures).toEqual([
      { phase: 'pending-install', failure: expect.objectContaining({ code: 'update-marker-invalid' }) },
    ]);
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
    // The toast only names it; the card keeps the full detail.
    expect(harness.store.getSnapshot().startupNotes).toEqual(report.failures);
    // The startup check still runs.
    expect(harness.fetcher).toHaveBeenCalledOnce();
  });

  it('includes a failed startup check in the report', async () => {
    const harness = setup();
    harness.fetcher.mockRejectedValueOnce(new TypeError('Network request failed'));
    const report = await harness.store.start();
    expect(report.failures).toEqual([
      { phase: 'check', failure: expect.objectContaining({ code: 'network' }) },
    ]);
    // Kept as a note, which the card hides while the check state shows it.
    const snapshot = harness.store.getSnapshot();
    expect(snapshot.check).toMatchObject({ kind: 'failed', failure: report.failures[0].failure });
    expect(snapshot.startupNotes).toEqual(report.failures);
    expect(visibleAndroidUpdateStartupNotes(snapshot)).toEqual([]);
  });

  it('shows a failed startup check while the profile check runs, and drops it once that check is done', async () => {
    const harness = setup();
    harness.fetcher.mockRejectedValueOnce(new TypeError('Network request failed'));
    const report = await harness.store.start();
    // The toast pointed to the profile; opening it runs a new check.
    harness.advance(PROFILE_RECHECK_MS);
    const profileCheck = harness.store.check('profile');
    // While it runs, the note still leads to the cause the toast named.
    const running = harness.store.getSnapshot();
    expect(running.check.kind).toBe('checking');
    expect(visibleAndroidUpdateStartupNotes(running)).toEqual(report.failures);
    await profileCheck;
    // Done: the card shows the current truth, not the old failure under it.
    const snapshot = harness.store.getSnapshot();
    expect(snapshot.check.kind).toBe('done');
    expect(snapshot.startupNotes).toEqual([]);
  });

  it('replaces a failed startup check note with the failure of a later check', async () => {
    const harness = setup();
    harness.fetcher
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed again'));
    await harness.store.start();
    harness.advance(PROFILE_RECHECK_MS);
    await harness.store.check('profile');
    const snapshot = harness.store.getSnapshot();
    // One check failure on the card: the current one, no old note under it.
    expect(snapshot.check).toMatchObject({ kind: 'failed', failure: { message: expect.stringContaining('again') } });
    expect(snapshot.startupNotes).toEqual([]);
    expect(visibleAndroidUpdateStartupNotes(snapshot)).toEqual([]);
  });

  it('drops only check notes after a later check; other phases keep their own rules', async () => {
    const harness = setup();
    harness.storage.set(PENDING_INSTALL_STORAGE_KEY, '{oops');
    harness.fetcher.mockRejectedValueOnce(new TypeError('Network request failed'));
    const report = await harness.store.start();
    expect(report.failures.map((entry) => entry.phase)).toEqual(['pending-install', 'check']);
    harness.advance(PROFILE_RECHECK_MS);
    await harness.store.check('profile');
    expect(harness.store.getSnapshot().check.kind).toBe('done');
    expect(harness.store.getSnapshot().startupNotes).toEqual([report.failures[0]]);
  });

  it('keeps a start that failed in its own setup as a note and still rejects', async () => {
    const harness = setup({
      appState: {
        addEventListener: vi.fn(() => {
          throw new Error('AppState is unavailable');
        }),
      },
    });
    await expect(harness.store.start()).rejects.toThrow('AppState is unavailable');
    expect(harness.store.getSnapshot().startupNotes).toEqual([
      { phase: 'check', failure: { code: null, message: 'AppState is unavailable', httpStatus: null } },
    ]);
    // A later successful check does not resolve a setup failure: the note stays.
    await harness.store.check('profile');
    expect(harness.store.getSnapshot().check.kind).toBe('done');
    expect(harness.store.getSnapshot().startupNotes).toEqual([
      { phase: 'check', failure: { code: null, message: 'AppState is unavailable', httpStatus: null } },
    ]);
  });

  it('keeps the startup notes until a manual re-check, which clears them', async () => {
    const harness = setup();
    harness.storage.set(PENDING_INSTALL_STORAGE_KEY, '{oops');
    await harness.store.start();
    expect(harness.store.getSnapshot().startupNotes).toHaveLength(1);
    harness.advance(FOREGROUND_RECHECK_MS);
    harness.emitAppState('active');
    await flush();
    expect(harness.fetcher).toHaveBeenCalledTimes(2);
    expect(harness.store.getSnapshot().startupNotes).toHaveLength(1);
    await harness.store.check('manual');
    expect(harness.store.getSnapshot().startupNotes).toEqual([]);
  });

  it('finishes the startup report when GitHub stalls, and later checks run again', async () => {
    vi.useFakeTimers();
    try {
      const harness = setup();
      // RN's OkHttp has no timeouts: this request would never settle on its own.
      harness.fetcher.mockImplementationOnce(() => new Promise(() => undefined));
      const starting = harness.store.start();
      await vi.advanceTimersByTimeAsync(GITHUB_CHECK_TIMEOUT_MS);

      const report = await starting;
      expect(report.failures).toEqual([
        {
          phase: 'check',
          failure: { code: 'network', message: 'GitHub did not answer within 20 s', httpStatus: null },
        },
      ]);
      // The single-flight check is free again: a re-check reaches GitHub.
      await harness.store.check('manual');
      expect(harness.fetcher).toHaveBeenCalledTimes(2);
      expect(harness.store.getSnapshot().check.kind).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is idempotent: one listener, one startup check', async () => {
    const harness = setup();
    const first = harness.store.start();
    const second = harness.store.start();
    expect(second).toBe(first);
    await first;
    await harness.store.start();
    expect(harness.deps.appState.addEventListener).toHaveBeenCalledOnce();
    expect(harness.fetcher).toHaveBeenCalledOnce();
  });

  it('re-checks on returning to the foreground only once the result is stale', async () => {
    const harness = setup();
    await harness.store.start();
    harness.emitAppState('active');
    await flush();
    expect(harness.fetcher).toHaveBeenCalledOnce();
    harness.advance(FOREGROUND_RECHECK_MS);
    harness.emitAppState('active');
    await flush();
    expect(harness.fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('androidUpdateStore installer outcome', () => {
  async function awaitingConfirmation() {
    const harness = setup();
    await harness.store.start();
    await harness.store.install();
    expect(harness.store.getSnapshot().install.kind).toBe('awaiting-confirmation');
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(true);
    return harness;
  }

  it('ends the confirmation wait when the live module reports a cancelled install', async () => {
    const harness = await awaitingConfirmation();
    harness.reportOutcome(ABORTED);
    await flush();
    const snapshot = harness.store.getSnapshot();
    expect(snapshot.install).toEqual({
      kind: 'failed',
      release: expect.objectContaining({ versionName: '1.0.17', versionCode: 10085 }),
      failure: {
        code: 'updater-install-aborted',
        message: 'Install aborted (status 3)',
        httpStatus: null,
        releaseVersion: '1.0.17',
      },
    });
    expect(harness.storedOutcome()).toBeNull();
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
    // Retryable: it still asks for attention and the install can start again.
    expect(androidUpdateNeedsAttention(snapshot)).toBe(true);
    await harness.store.install();
    expect(harness.updater.downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(harness.store.getSnapshot().install.kind).toBe('awaiting-confirmation');
  });

  it('reads a stored outcome on returning to the foreground (the Toast never showed)', async () => {
    const harness = await awaitingConfirmation();
    harness.storeOutcome({
      code: 'updater-install-failed',
      message: 'INSTALL_FAILED_INSUFFICIENT_STORAGE (status 6)',
      sessionId: 101,
      versionName: '1.0.17',
      versionCode: 10085,
    });
    harness.emitAppState('active');
    await flush();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-install-failed', message: 'INSTALL_FAILED_INSUFFICIENT_STORAGE (status 6)' },
    });
    expect(harness.storedOutcome()).toBeNull();
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
  });

  it('ignores an outcome for a versionCode that is installed after all', async () => {
    const harness = await awaitingConfirmation();
    harness.setInstallation({ versionName: '1.0.17', versionCode: 10085 });
    harness.reportOutcome(ABORTED);
    await flush();
    expect(harness.store.getSnapshot().install.kind).toBe('awaiting-confirmation');
  });

  it('shows a malformed outcome event loudly', async () => {
    const harness = await awaitingConfirmation();
    harness.emitInvalidOutcome(
      Object.assign(new Error('Android install outcome is invalid: code 42 is not an updater code'), {
        code: 'updater-install-outcome-invalid',
      }),
    );
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-install-outcome-invalid' },
    });
  });

  it('keeps a live outcome visible when applying it fails after reading cleared it', async () => {
    const harness = await awaitingConfirmation();
    harness.updater.getInstallationInfo.mockRejectedValueOnce(
      nativeError('updater-installed-package-missing', 'Package missing'),
    );
    harness.reportOutcome({ ...ABORTED, code: 'updater-install-incompatible', message: 'INSTALL_FAILED_OLDER_SDK (status 7)' });
    await flush();
    // Read and cleared on the native side: this is the only copy left.
    expect(harness.storedOutcome()).toBeNull();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: {
        code: 'updater-install-incompatible',
        message: 'INSTALL_FAILED_OLDER_SDK (status 7) (also: updater-installed-package-missing: Package missing)',
        releaseVersion: '1.0.17',
      },
      unacknowledged: true,
    });
    // The final code leads, so it is kept for the next start too.
    expect(JSON.parse(harness.storage.get(FINAL_FAILURE_STORAGE_KEY) ?? 'null')).toMatchObject({
      failure: { code: 'updater-install-incompatible' },
    });
  });

  it('keeps a held outcome visible when applying it fails once the install settles', async () => {
    const harness = await awaitingConfirmation();
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    const installing = harness.store.install();
    await flush();
    harness.reportOutcome({ ...ABORTED, sessionId: 900 });
    await flush();
    download.resolve(SUBMITTED);
    harness.updater.getInstallationInfo.mockRejectedValueOnce(
      nativeError('updater-installed-package-missing', 'Package missing'),
    );
    await installing;
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: {
        code: 'updater-install-aborted',
        message: 'Install aborted (status 3) (also: updater-installed-package-missing: Package missing)',
      },
    });
  });

  it('shows a failure to read the stored outcome', async () => {
    const harness = await awaitingConfirmation();
    vi.mocked(harness.deps.consumeInstallOutcome).mockRejectedValueOnce(
      nativeError('updater-install-outcome-invalid', 'Stored update outcome is corrupt'),
    );
    harness.emitAppState('active');
    await flush();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-install-outcome-invalid', message: 'Stored update outcome is corrupt' },
    });
  });

  it('holds an outcome of the new session that arrives before its id, and applies it once the install settles', async () => {
    const harness = await awaitingConfirmation();
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    const installing = harness.store.install();
    await flush();
    // Android blocked the confirmation of session 900 before JS heard of it.
    harness.reportOutcome({ ...ABORTED, code: 'updater-install-confirmation-blocked', sessionId: 900 });
    await flush();
    expect(harness.store.getSnapshot().install.kind).toBe('downloading');
    download.resolve(SUBMITTED);
    await installing;
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-install-confirmation-blocked' },
    });
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
  });

  it('drops a held outcome of the session the new install superseded', async () => {
    const harness = await awaitingConfirmation();
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    const installing = harness.store.install();
    await flush();
    // Session 101 ends while session 900 is being prepared.
    harness.reportOutcome(ABORTED);
    await flush();
    download.resolve(SUBMITTED);
    await installing;
    expect(harness.store.getSnapshot().install.kind).toBe('awaiting-confirmation');
    expect(harness.storage.get(PENDING_INSTALL_STORAGE_KEY)).toBe(MARKER_17);
    expect(harness.storedOutcome()).toBeNull();
  });

  it('holds a live outcome that install() overtakes while it is applied, instead of ending the new attempt', async () => {
    const harness = await awaitingConfirmation();
    const read = deferred<AndroidInstallationInfo>();
    harness.updater.getInstallationInfo.mockImplementationOnce(() => read.promise);
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    // Session 101 ends; applying its outcome waits for Android's installation info.
    harness.reportOutcome(ABORTED);
    await flush();
    // Meanwhile the user starts the update again.
    const installing = harness.store.install();
    await flush();
    expect(harness.store.getSnapshot().install.kind).toBe('downloading');
    read.resolve({ versionName: '1.0.16', versionCode: 10079, canRequestPackageInstalls: true });
    await flush();
    // The new attempt's marker and card are untouched.
    expect(harness.storage.get(PENDING_INSTALL_STORAGE_KEY)).toBe(MARKER_17);
    expect(harness.store.getSnapshot().install.kind).toBe('downloading');
    download.resolve(SUBMITTED);
    await installing;
    // Session 900 superseded 101: the held outcome is dropped, not shown as a channel failure.
    expect(harness.store.getSnapshot().install).toMatchObject({ kind: 'awaiting-confirmation' });
    expect(harness.storage.get(PENDING_INSTALL_STORAGE_KEY)).toBe(MARKER_17);
  });

  it('applies an overtaken live outcome once the new attempt fails before reaching the installer', async () => {
    const harness = await awaitingConfirmation();
    const read = deferred<AndroidInstallationInfo>();
    harness.updater.getInstallationInfo.mockImplementationOnce(() => read.promise);
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    harness.reportOutcome(ABORTED);
    await flush();
    const installing = harness.store.install();
    await flush();
    read.resolve({ versionName: '1.0.16', versionCode: 10079, canRequestPackageInstalls: true });
    await flush();
    download.reject(nativeError('updater-download-io', 'Update APK download failed'));
    await installing;
    // Session 101 still counted: the attempt's own failure leads, the outcome is appended.
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: {
        code: 'updater-download-io',
        message: 'Update APK download failed (also: updater-install-aborted: Install aborted (status 3))',
      },
    });
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
  });

  it('drops an overtaken live outcome whose application failed once the new attempt superseded its session', async () => {
    const harness = await awaitingConfirmation();
    const read = deferred<AndroidInstallationInfo>();
    harness.updater.getInstallationInfo.mockImplementationOnce(() => read.promise);
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    harness.reportOutcome(ABORTED);
    await flush();
    const installing = harness.store.install();
    await flush();
    read.reject(nativeError('updater-installed-package-missing', 'Package missing'));
    await flush();
    download.resolve(SUBMITTED);
    await installing;
    expect(harness.store.getSnapshot().install).toMatchObject({ kind: 'awaiting-confirmation' });
    expect(harness.storage.get(PENDING_INSTALL_STORAGE_KEY)).toBe(MARKER_17);
  });

  it('ignores a live outcome of another session than the one submitted last', async () => {
    const harness = await awaitingConfirmation();
    // Session 101 is current; 77 was abandoned for it.
    harness.reportOutcome({ ...ABORTED, sessionId: 77 });
    await flush();
    expect(harness.store.getSnapshot().install.kind).toBe('awaiting-confirmation');
    expect(harness.storage.get(PENDING_INSTALL_STORAGE_KEY)).toBe(MARKER_17);
    // Read once: it does not come back on the next foreground.
    expect(harness.storedOutcome()).toBeNull();
    harness.reportOutcome(ABORTED);
    await flush();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-install-aborted' },
    });
  });

  it('keeps the running attempt\'s own failure first when a held outcome ends the earlier session', async () => {
    const harness = await awaitingConfirmation();
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    const installing = harness.store.install();
    await flush();
    harness.reportOutcome(ABORTED);
    await flush();
    download.reject(nativeError('updater-download-io', 'Update APK download failed'));
    await installing;
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: {
        code: 'updater-download-io',
        message: 'Update APK download failed (also: updater-install-aborted: Install aborted (status 3))',
      },
    });
    // The earlier session is over now, so nothing waits for its marker.
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
  });

  it('keeps the earlier session\'s marker when a restart fails before reaching the installer', async () => {
    const harness = await awaitingConfirmation();
    // A newer release replaces the offer; its install fails during the download.
    harness.setPayload(githubRelease('v1.0.18', 10090));
    await harness.store.check('manual');
    harness.updater.downloadAndInstall.mockRejectedValueOnce(
      nativeError('updater-download-http', 'Update download failed with HTTP 502'),
    );
    await harness.store.install();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      release: { versionName: '1.0.18' },
      failure: { code: 'updater-download-http' },
    });
    // Session 101 (1.0.17) can still be confirmed: its marker is back.
    expect(harness.storage.get(PENDING_INSTALL_STORAGE_KEY)).toBe(MARKER_17);
  });

  it('keeps the marker of a submitted session whose reply was malformed when a restart fails early', async () => {
    const harness = setup();
    await harness.store.start();
    harness.updater.downloadAndInstall.mockResolvedValueOnce({ ...SUBMITTED, versionCode: 10084 });
    await harness.store.install();
    expect(harness.store.getSnapshot().install.kind).toBe('failed');
    harness.updater.downloadAndInstall.mockRejectedValueOnce(
      nativeError('updater-download-io', 'Update APK download failed'),
    );
    await harness.store.install();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-download-io' },
    });
    expect(harness.storage.get(PENDING_INSTALL_STORAGE_KEY)).toBe(MARKER_17);
    // That session is the one whose outcome still counts.
    harness.reportOutcome({ ...ABORTED, sessionId: 900 });
    await flush();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: {
        code: 'updater-download-io',
        message: 'Update APK download failed (also: updater-install-aborted: Install aborted (status 3))',
      },
    });
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(false);
  });

  it('reports an outcome of a session superseded during startup without touching the newer one', async () => {
    const harness = setup();
    await harness.store.check('manual');
    await harness.store.install();
    expect(harness.store.getSnapshot().install.kind).toBe('awaiting-confirmation');
    harness.storeOutcome({ ...ABORTED, sessionId: 55 });
    const report = await harness.store.start();
    expect(report.failures).toEqual([
      {
        phase: 'install-outcome',
        failure: expect.objectContaining({ code: 'updater-install-aborted', message: 'Install aborted (status 3)' }),
      },
    ]);
    expect(harness.store.getSnapshot().install.kind).toBe('awaiting-confirmation');
    expect(harness.store.getSnapshot().startupNotes).toEqual(report.failures);
  });

  it('reports a stored outcome at startup and shows it on the release the check offers', async () => {
    const harness = setup();
    harness.storage.set(
      PENDING_INSTALL_STORAGE_KEY,
      JSON.stringify({ versionName: '1.0.17', versionCode: 10085 }),
    );
    harness.storeOutcome(ABORTED);
    const report = await harness.store.start();
    expect(report).toEqual({
      updatedTo: null,
      failures: [{
        phase: 'install-outcome',
        failure: {
          code: 'updater-install-aborted',
          message: 'Install aborted (status 3)',
          httpStatus: null,
          releaseVersion: '1.0.17',
        },
      }],
    });
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      release: { versionCode: 10085 },
      failure: { code: 'updater-install-aborted' },
    });
    // On the install card already: not a second time as a note.
    expect(harness.store.getSnapshot().startupNotes).toEqual([]);
    expect(harness.storedOutcome()).toBeNull();
  });

  it('moves a stored outcome from the notes to the install card once a later check offers its build', async () => {
    const harness = setup();
    harness.storeOutcome(ABORTED);
    harness.fetcher.mockRejectedValueOnce(new TypeError('Network request failed'));
    const report = await harness.store.start();
    const outcome = report.failures.find((entry) => entry.phase === 'install-outcome');
    if (outcome === undefined) throw new Error('The outcome is missing from the startup report');
    const check = report.failures.find((entry) => entry.phase === 'check');
    if (check === undefined) throw new Error('The failed check is missing from the startup report');
    // Parked for its build; until a check offers it, the note carries it.
    // The failed check is shown by the check state for now.
    expect(harness.store.getSnapshot().startupNotes).toEqual([outcome, check]);
    expect(visibleAndroidUpdateStartupNotes(harness.store.getSnapshot())).toEqual([outcome]);

    harness.emitAppState('active');
    await flush();
    const snapshot = harness.store.getSnapshot();
    expect(snapshot.install).toMatchObject({
      kind: 'failed',
      release: { versionCode: 10085 },
      failure: { code: 'updater-install-aborted' },
    });
    // The outcome is on the install card; the finished check replaced the
    // failed startup check, so its note is gone too.
    expect(snapshot.startupNotes).toEqual([]);
  });

  it('reports an outcome of a superseded release at startup but keeps it off the newer offer', async () => {
    const harness = setup();
    harness.setPayload(githubRelease('v1.0.18', 10090));
    harness.storeOutcome(ABORTED);
    const report = await harness.store.start();
    expect(report.failures).toEqual([
      { phase: 'install-outcome', failure: expect.objectContaining({ code: 'updater-install-aborted', releaseVersion: '1.0.17' }) },
    ]);
    const snapshot = harness.store.getSnapshot();
    expect(snapshot.install).toEqual({ kind: 'idle' });
    expect(availableAndroidUpdate(snapshot)).toMatchObject({ versionName: '1.0.18', versionCode: 10090 });
    expect(snapshot.startupNotes).toEqual(report.failures);
  });

  it('keeps a live outcome of another build off the release offered now', async () => {
    const harness = await awaitingConfirmation();
    harness.reportOutcome({ ...ABORTED, versionName: '1.0.16', versionCode: 10080 });
    await flush();
    expect(harness.store.getSnapshot().install.kind).toBe('awaiting-confirmation');
    expect(harness.storage.has(PENDING_INSTALL_STORAGE_KEY)).toBe(true);
  });

  it('drops a stored outcome at startup once the installed build reached it', async () => {
    const harness = setup();
    harness.setInstallation({ versionName: '1.0.17', versionCode: 10085 });
    harness.setPayload(githubRelease('v1.0.17', 10085));
    harness.storeOutcome(ABORTED);
    await expect(harness.store.start()).resolves.toEqual({ updatedTo: null, failures: [] });
    expect(harness.store.getSnapshot().install).toEqual({ kind: 'idle' });
  });

  it('reports a failure to read the outcome at startup as an unavailable outcome channel', async () => {
    const harness = setup({
      consumeInstallOutcome: vi.fn(async () => {
        throw nativeError('updater-module-invalidated', 'The updater was torn down');
      }),
    });
    const report = await harness.store.start();
    expect(report.failures).toEqual([
      { phase: 'install-outcome-unavailable', failure: expect.objectContaining({ code: 'updater-module-invalidated' }) },
    ]);
    expect(harness.store.getSnapshot().startupNotes).toEqual(report.failures);
    expect(harness.fetcher).toHaveBeenCalledOnce();
  });

  it('reports a channel failure during startup instead of pinning it to the release the check offers', async () => {
    const harness = setup();
    vi.mocked(harness.deps.consumeInstallOutcome).mockImplementationOnce(async () => {
      harness.emitInvalidOutcome(
        Object.assign(new Error('Android install outcome is invalid: code 42 is not an updater code'), {
          code: 'updater-install-outcome-invalid',
        }),
      );
      return null;
    });
    const report = await harness.store.start();
    expect(report.failures).toEqual([
      {
        phase: 'install-outcome-unavailable',
        failure: expect.objectContaining({ code: 'updater-install-outcome-invalid' }),
      },
    ]);
    const snapshot = harness.store.getSnapshot();
    expect(availableAndroidUpdate(snapshot)?.versionCode).toBe(10085);
    expect(snapshot.install).toEqual({ kind: 'idle' });
    expect(snapshot.orphanedInstallFailure).toBeNull();
    expect(snapshot.startupNotes).toEqual(report.failures);
  });

  it('reports a startup outcome that names no build without pinning it to the offered release', async () => {
    const harness = setup();
    harness.storeOutcome({ ...ABORTED, versionName: null, versionCode: null });
    const report = await harness.store.start();
    expect(report.failures).toEqual([
      { phase: 'install-outcome', failure: expect.objectContaining({ code: 'updater-install-aborted' }) },
    ]);
    expect(harness.store.getSnapshot().install).toEqual({ kind: 'idle' });
    expect(harness.store.getSnapshot().orphanedInstallFailure).toBeNull();
    expect(harness.store.getSnapshot().startupNotes).toEqual(report.failures);
  });

  it('shows failures that name no build at once while running, chained, and never on a later release', async () => {
    const harness = setup();
    harness.setPayload(githubRelease('v1.0.16', 10079));
    await harness.store.start();
    expect(availableAndroidUpdate(harness.store.getSnapshot())).toBeNull();
    harness.emitInvalidOutcome(
      Object.assign(new Error('Android install outcome is invalid: code 42 is not an updater code'), {
        code: 'updater-install-outcome-invalid',
      }),
    );
    vi.mocked(harness.deps.consumeInstallOutcome).mockRejectedValueOnce(
      nativeError('updater-module-invalidated', 'The updater was torn down'),
    );
    harness.emitAppState('active');
    await flush();
    harness.reportOutcome({ ...ABORTED, versionName: null, versionCode: null });
    await flush();
    expect(harness.store.getSnapshot().orphanedInstallFailure).toEqual({
      phase: 'install-outcome-unavailable',
      failure: {
        code: 'updater-install-outcome-invalid',
        message:
          'Android install outcome is invalid: code 42 is not an updater code' +
          ' (also: updater-module-invalidated: The updater was torn down)' +
          ' (also: updater-install-aborted: Install aborted (status 3))',
        httpStatus: null,
      },
    });

    // A release appears: it is offered as it is, the failures stay apart.
    harness.setPayload(githubRelease());
    harness.advance(FOREGROUND_RECHECK_MS);
    harness.emitAppState('active');
    await flush();
    const offered = harness.store.getSnapshot();
    expect(availableAndroidUpdate(offered)?.versionCode).toBe(10085);
    expect(offered.install).toEqual({ kind: 'idle' });
    expect(offered.orphanedInstallFailure).not.toBeNull();

    // "Check again" is the user's acknowledgement.
    await harness.store.check('manual');
    expect(harness.store.getSnapshot().orphanedInstallFailure).toBeNull();
    expect(harness.store.getSnapshot().install).toEqual({ kind: 'idle' });
  });

  it('chains several outcomes for one build that arrive before any release is known', async () => {
    const harness = setup();
    harness.setPayload(githubRelease('v1.0.16', 10079));
    await harness.store.start();
    harness.reportOutcome(ABORTED);
    await flush();
    harness.reportOutcome({
      ...ABORTED,
      code: 'updater-install-failed',
      message: 'INSTALL_FAILED_INTERNAL_ERROR (status 1)',
    });
    await flush();
    harness.setPayload(githubRelease());
    await harness.store.check('manual');
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      release: { versionCode: 10085 },
      failure: {
        code: 'updater-install-aborted',
        message: 'Install aborted (status 3) (also: updater-install-failed: INSTALL_FAILED_INTERNAL_ERROR (status 1))',
      },
    });
  });

  it('reports an unavailable outcome subscription at startup', async () => {
    const harness = setup({
      subscribeInstallOutcome: vi.fn(() => {
        throw new Error('LoggeRythm updater install outcome events are unavailable');
      }),
    });
    const report = await harness.store.start();
    expect(report.failures).toEqual([
      {
        phase: 'install-outcome-unavailable',
        failure: expect.objectContaining({ message: 'LoggeRythm updater install outcome events are unavailable' }),
      },
    ]);
    expect(harness.store.getSnapshot().startupNotes).toEqual(report.failures);
  });
});

describe('androidUpdateStore final failures across restarts', () => {
  const SIGNATURE = nativeError('updater-signature-mismatch', 'Update APK signing certificate does not match');

  async function failedForGood() {
    const harness = setup();
    await harness.store.start();
    harness.updater.downloadAndInstall.mockRejectedValueOnce(SIGNATURE);
    await harness.store.install();
    return harness;
  }

  it('keeps a final failure with the release identity', async () => {
    const harness = await failedForGood();
    expect(JSON.parse(harness.storage.get(FINAL_FAILURE_STORAGE_KEY) ?? 'null')).toEqual({
      release: { versionCode: 10085, apkDigest: `sha256:${'b'.repeat(64)}`, apkUrl: APK_URL },
      failure: {
        code: 'updater-signature-mismatch',
        message: 'Update APK signing certificate does not match',
        httpStatus: null,
      },
    });
  });

  it('does not keep a retryable failure', async () => {
    const harness = setup();
    await harness.store.start();
    harness.updater.downloadAndInstall.mockRejectedValueOnce(
      nativeError('updater-download-io', 'Update APK download failed'),
    );
    await harness.store.install();
    expect(harness.storage.has(FINAL_FAILURE_STORAGE_KEY)).toBe(false);
  });

  it('shows the failure again after a restart instead of a fresh install button', async () => {
    const harness = await failedForGood();
    const restarted = harness.restart();
    await expect(restarted.start()).resolves.toEqual({ updatedTo: null, failures: [] });
    const snapshot = restarted.getSnapshot();
    expect(snapshot.install).toEqual({
      kind: 'failed',
      release: expect.objectContaining({ versionCode: 10085, apkUrl: APK_URL }),
      failure: {
        code: 'updater-signature-mismatch',
        message: 'Update APK signing certificate does not match',
        httpStatus: null,
      },
    });
    expect(androidUpdateNeedsAttention(snapshot)).toBe(false);
    // A manual re-check of the same release keeps it.
    await restarted.check('manual');
    expect(restarted.getSnapshot().install.kind).toBe('failed');
    expect(harness.storage.has(FINAL_FAILURE_STORAGE_KEY)).toBe(true);
  });

  it('clears it once a check offers a different release', async () => {
    const harness = await failedForGood();
    harness.setPayload(githubRelease('v1.0.18', 10090));
    const restarted = harness.restart();
    await restarted.start();
    expect(restarted.getSnapshot().install).toEqual({ kind: 'idle' });
    expect(availableAndroidUpdate(restarted.getSnapshot())?.versionName).toBe('1.0.18');
    expect(harness.storage.has(FINAL_FAILURE_STORAGE_KEY)).toBe(false);
  });

  it('treats a re-uploaded APK of the same version as a different release', async () => {
    const harness = await failedForGood();
    const reuploaded = githubRelease();
    reuploaded.assets[0].digest = `sha256:${'c'.repeat(64)}`;
    harness.setPayload(reuploaded);
    await harness.store.check('manual');
    expect(harness.store.getSnapshot().install).toEqual({ kind: 'idle' });
    expect(harness.storage.has(FINAL_FAILURE_STORAGE_KEY)).toBe(false);
  });

  it('keeps a final installer outcome from the previous process', async () => {
    const harness = setup();
    harness.storeOutcome({
      ...ABORTED,
      code: 'updater-install-incompatible',
      message: 'INSTALL_FAILED_OLDER_SDK (status 7)',
    });
    const report = await harness.store.start();
    expect(report.failures).toEqual([
      { phase: 'install-outcome', failure: expect.objectContaining({ code: 'updater-install-incompatible' }) },
    ]);
    expect(harness.store.getSnapshot().install).toEqual({
      kind: 'failed',
      release: expect.objectContaining({ versionCode: 10085 }),
      failure: expect.objectContaining({ code: 'updater-install-incompatible' }),
    });
    // Restored from the previous process (and toasted): straight to the bottom.
    expect(androidUpdateNeedsAttention(harness.store.getSnapshot())).toBe(false);
    expect(JSON.parse(harness.storage.get(FINAL_FAILURE_STORAGE_KEY) ?? 'null')).toMatchObject({
      release: { versionCode: 10085 },
      failure: { code: 'updater-install-incompatible', releaseVersion: '1.0.17' },
    });
    const restarted = harness.restart();
    await restarted.start();
    expect(restarted.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-install-incompatible', releaseVersion: '1.0.17' },
    });
  });

  it('keeps a final installer outcome that arrives while the app runs', async () => {
    const harness = setup();
    await harness.store.start();
    await harness.store.install();
    harness.reportOutcome({ ...ABORTED, code: 'updater-install-blocked', message: 'Blocked by policy (status 2)' });
    await flush();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: { code: 'updater-install-blocked' },
    });
    expect(harness.storage.has(FINAL_FAILURE_STORAGE_KEY)).toBe(true);
    // It happened in this process: on top, with the header dot.
    expect(androidUpdateNeedsAttention(harness.store.getSnapshot())).toBe(true);
  });

  it('keeps a restored final failure leading over a retryable outcome of the same release', async () => {
    const harness = await failedForGood();
    // The previous process also stored a retryable outcome for that build.
    harness.storeOutcome(ABORTED);
    const restarted = harness.restart();
    const report = await restarted.start();
    expect(report.failures).toEqual([
      { phase: 'install-outcome', failure: expect.objectContaining({ code: 'updater-install-aborted' }) },
    ]);
    const snapshot = restarted.getSnapshot();
    expect(snapshot.install).toEqual({
      kind: 'failed',
      release: expect.objectContaining({ versionCode: 10085 }),
      failure: {
        code: 'updater-signature-mismatch',
        message: 'Update APK signing certificate does not match (also: updater-install-aborted: Install aborted (status 3))',
        httpStatus: null,
      },
    });
    // Restored at startup: at the bottom, no retry offered.
    expect(androidUpdateNeedsAttention(snapshot)).toBe(false);
    // The kept record is not replaced by the retryable note.
    expect(JSON.parse(harness.storage.get(FINAL_FAILURE_STORAGE_KEY) ?? 'null')).toMatchObject({
      failure: { code: 'updater-signature-mismatch', message: 'Update APK signing certificate does not match' },
    });
  });

  it('shows a failure to keep it next to the failure itself', async () => {
    const harness = setup();
    await harness.store.start();
    vi.mocked(harness.deps.storage.setItem).mockImplementation(async (key: string, value: string) => {
      if (key === FINAL_FAILURE_STORAGE_KEY) throw new Error('disk full');
      harness.storage.set(key, value);
    });
    harness.updater.downloadAndInstall.mockRejectedValueOnce(SIGNATURE);
    await harness.store.install();
    expect(harness.store.getSnapshot().install).toMatchObject({
      kind: 'failed',
      failure: {
        code: 'updater-signature-mismatch',
        message:
          'Update APK signing certificate does not match (also: The final update failure could not be saved for the next start: disk full)',
      },
    });
  });

  it('keeps the unsaved note for this process when the card moved on before the save failed', async () => {
    const harness = setup();
    await harness.store.start();
    const save = deferred<void>();
    vi.mocked(harness.deps.storage.setItem).mockImplementation(async (key: string, value: string) => {
      if (key === FINAL_FAILURE_STORAGE_KEY) return save.promise;
      harness.storage.set(key, value);
    });
    await harness.store.install();
    harness.reportOutcome({ ...ABORTED, code: 'updater-install-blocked', message: 'Blocked by policy (status 2)' });
    await flush();
    // A newer release replaces the offer while the save still runs.
    harness.setPayload(githubRelease('v1.0.18', 10090));
    await harness.store.check('manual');
    expect(harness.store.getSnapshot().install).toEqual({ kind: 'idle' });
    save.reject(new Error('disk full'));
    await flush();
    expect(harness.store.getSnapshot().install).toEqual({ kind: 'idle' });
  });

  it('lets a final installer outcome lead over a retryable failure of the same release', async () => {
    const harness = setup();
    await harness.store.start();
    await harness.store.install();
    const download = deferred<Submitted>();
    harness.updater.downloadAndInstall.mockImplementationOnce(() => download.promise);
    const installing = harness.store.install();
    await flush();
    // The earlier session (101) ends for good while the retry downloads.
    harness.reportOutcome({ ...ABORTED, code: 'updater-install-incompatible', message: 'INSTALL_FAILED_OLDER_SDK (status 7)' });
    await flush();
    download.reject(nativeError('updater-download-io', 'Update APK download failed'));
    await installing;
    const snapshot = harness.store.getSnapshot();
    expect(snapshot.install).toMatchObject({
      kind: 'failed',
      failure: {
        code: 'updater-install-incompatible',
        message: 'INSTALL_FAILED_OLDER_SDK (status 7) (also: updater-download-io: Update APK download failed)',
      },
    });
    // No retry that cannot succeed, the card stays on top until acknowledged,
    // and the restart shows it again.
    expect(androidUpdateNeedsAttention(snapshot)).toBe(true);
    harness.store.acknowledgeFinalFailure();
    expect(androidUpdateNeedsAttention(harness.store.getSnapshot())).toBe(false);
    expect(JSON.parse(harness.storage.get(FINAL_FAILURE_STORAGE_KEY) ?? 'null')).toMatchObject({
      failure: { code: 'updater-install-incompatible' },
    });
  });

  it.each([
    ['not JSON', '{oops'],
    ['no release', JSON.stringify({ failure: { code: 'updater-apk-not-newer', message: 'x', httpStatus: null } })],
    ['a retryable code', JSON.stringify({
      release: { versionCode: 10085, apkDigest: `sha256:${'b'.repeat(64)}`, apkUrl: APK_URL },
      failure: { code: 'updater-download-io', message: 'x', httpStatus: null },
    })],
  ])('reports a corrupt kept failure (%s) once and removes it', async (_name, raw) => {
    const harness = setup();
    harness.storage.set(FINAL_FAILURE_STORAGE_KEY, raw);
    const report = await harness.store.start();
    expect(report.failures).toEqual([
      { phase: 'pending-install', failure: expect.objectContaining({ code: 'update-marker-invalid' }) },
    ]);
    expect(harness.storage.has(FINAL_FAILURE_STORAGE_KEY)).toBe(false);
    expect(harness.store.getSnapshot().install).toEqual({ kind: 'idle' });
  });
});

describe('androidUpdateNeedsAttention', () => {
  const release = { versionName: '1.0.17' } as AndroidUpdateRelease;
  const installed = { versionName: '1.0.16', versionCode: 10079 };
  const available = { kind: 'available' as const, installed, release };
  const upToDate = { kind: 'up-to-date' as const, installed, latestVersion: '1.0.16' };
  const failure = { code: 'network', message: 'offline', httpStatus: null };

  function snapshot(partial: Partial<AndroidUpdateSnapshot>): AndroidUpdateSnapshot {
    return {
      supported: true,
      installed,
      check: { kind: 'idle' },
      install: { kind: 'idle' },
      updatedTo: null,
      orphanedInstallFailure: null,
      startupNotes: [],
      ...partial,
    };
  }

  it.each([
    ['idle', snapshot({}), false],
    ['checking without a previous result', snapshot({ check: { kind: 'checking', previous: null, previousCheckedAt: null } }), false],
    ['checking with a previous available result', snapshot({ check: { kind: 'checking', previous: available, previousCheckedAt: 1 } }), true],
    ['up to date', snapshot({ check: { kind: 'done', result: upToDate, checkedAt: 1 } }), false],
    ['installed newer', snapshot({
      check: {
        kind: 'done',
        result: {
          kind: 'installed-newer',
          reason: 'newer-build',
          installed,
          latestVersion: '1.0.17',
          latestVersionCode: 10070,
          releaseUrl: 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.0.17',
        },
        checkedAt: 1,
      },
    }), false],
    ['available', snapshot({ check: { kind: 'done', result: available, checkedAt: 1 } }), true],
    ['check failed without a previous result', snapshot({ check: { kind: 'failed', failure, checkedAt: 1, previous: null, previousCheckedAt: null } }), false],
    ['check failed with a previous available result', snapshot({ check: { kind: 'failed', failure, checkedAt: 1, previous: available, previousCheckedAt: 1 } }), true],
    ['preparing', snapshot({ install: { kind: 'preparing', release } }), true],
    ['permission', snapshot({ install: { kind: 'permission', release } }), true],
    ['downloading', snapshot({ install: { kind: 'downloading', release, progress: null } }), true],
    ['awaiting confirmation', snapshot({ install: { kind: 'awaiting-confirmation', release } }), true],
    ['install failed', snapshot({ install: { kind: 'failed', release, failure } }), true],
    ['install aborted by the user', snapshot({
      install: { kind: 'failed', release, failure: { code: 'updater-install-aborted', message: 'aborted', httpStatus: null } },
    }), true],
    ['install failed for good', snapshot({
      install: { kind: 'failed', release, failure: { code: 'updater-apk-not-newer', message: 'not newer', httpStatus: null } },
    }), false],
    ['unsupported platform', snapshot({ supported: false, check: { kind: 'done', result: available, checkedAt: 1 } }), false],
  ])('%s → %s', (_name, value, expected) => {
    expect(androidUpdateNeedsAttention(value)).toBe(expected);
  });

  const finalFailure = { code: 'updater-apk-not-newer', message: 'not newer', httpStatus: null };

  it.each([
    ['nothing waits', snapshot({}), 'none'],
    ['an offered update', snapshot({ check: { kind: 'done', result: available, checkedAt: 1 } }), 'update-available'],
    ['a retryable install failure', snapshot({ install: { kind: 'failed', release, failure } }), 'update-available'],
    ['an unacknowledged final failure', snapshot({
      install: { kind: 'failed', release, failure: finalFailure, unacknowledged: true },
    }), 'install-failed'],
    ['an acknowledged or restored final failure', snapshot({
      install: { kind: 'failed', release, failure: finalFailure },
    }), 'none'],
    ['an unacknowledged final failure off Android', snapshot({
      supported: false,
      install: { kind: 'failed', release, failure: finalFailure, unacknowledged: true },
    }), 'none'],
  ])('names what the dot stands for: %s → %s', (_name, value, expected) => {
    expect(androidUpdateAttention(value)).toBe(expected);
    expect(androidUpdateNeedsAttention(value)).toBe(expected !== 'none');
  });
});

describe('androidUpdateStore app language', () => {
  it('hands the active locale to the native receiver first at startup, then every later activation', async () => {
    const harness = setup();
    harness.activateLocale('en');
    expect(harness.deps.setAppLocale).not.toHaveBeenCalled();
    await harness.store.start();
    expect(harness.deps.setAppLocale).toHaveBeenCalledExactlyOnceWith('en');
    // Before anything can reach Android's installer.
    expect(vi.mocked(harness.deps.setAppLocale).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(harness.deps.subscribeInstallOutcome).mock.invocationCallOrder[0]);
    harness.activateLocale('de');
    await flush();
    expect(harness.deps.setAppLocale).toHaveBeenCalledTimes(2);
    expect(harness.deps.setAppLocale).toHaveBeenLastCalledWith('de');
  });

  it('follows the app\'s real locale activation', async () => {
    const harness = setup({ activeLocale: getActiveLocale, subscribeLocale: onLocaleActivated });
    try {
      activateLocale('de');
      await harness.store.start();
      expect(harness.deps.setAppLocale).toHaveBeenCalledExactlyOnceWith('de');
      activateLocale('en');
      expect(harness.deps.setAppLocale).toHaveBeenLastCalledWith('en');
    } finally {
      activateLocale('de');
    }
  });

  it('reports a failed hand-over loudly: in the startup report, later as a card note', async () => {
    const harness = setup();
    vi.mocked(harness.deps.setAppLocale).mockRejectedValueOnce(
      nativeError('updater-locale-unsaved', 'Android could not persist the app language de for update notices'),
    );
    const report = await harness.store.start();
    expect(report.failures).toEqual([
      { phase: 'app-locale', failure: expect.objectContaining({ code: 'updater-locale-unsaved' }) },
    ]);
    expect(harness.store.getSnapshot().startupNotes).toEqual(report.failures);

    vi.mocked(harness.deps.setAppLocale).mockRejectedValueOnce(
      nativeError('updater-locale-unsaved', 'Android could not persist the app language en for update notices'),
    );
    harness.activateLocale('en');
    await flush();
    expect(harness.store.getSnapshot().startupNotes).toEqual([
      ...report.failures,
      {
        phase: 'app-locale',
        failure: expect.objectContaining({
          code: 'updater-locale-unsaved',
          message: 'Android could not persist the app language en for update notices',
        }),
      },
    ]);
  });

  it('never calls the native updater off Android', async () => {
    const harness = setup({ platformOS: 'ios' });
    await harness.store.start();
    harness.activateLocale('en');
    expect(harness.deps.setAppLocale).not.toHaveBeenCalled();
    expect(harness.deps.subscribeLocale).not.toHaveBeenCalled();
  });
});
