/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  snapshot: null as unknown,
  getSnapshot: vi.fn(),
  // One mounted profile: useState keeps what its initializer returned until unmount().
  mounted: false,
  state: undefined as unknown,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    default: actual,
    useState: (initial: unknown) => {
      if (!mocks.mounted) {
        mocks.state = typeof initial === 'function' ? (initial as () => unknown)() : initial;
        mocks.mounted = true;
      }
      return [mocks.state, vi.fn()];
    },
  };
});

vi.mock('react-native', () => ({
  AppState: {},
  NativeEventEmitter: class {},
  NativeModules: {},
  PermissionsAndroid: {},
  Platform: { OS: 'android', Version: 34 },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

// The real snapshot helpers decide; only the singleton store is replaced.
vi.mock('../../update/androidUpdateStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../update/androidUpdateStore')>()),
  androidUpdateStore: { getSnapshot: mocks.getSnapshot },
}));

import {
  androidUpdateNeedsAttention,
  type AndroidUpdateSnapshot,
} from '../../update/androidUpdateStore';
import type { AndroidUpdateCheck, AndroidUpdateRelease } from '../../update/githubReleaseUpdater';
import { androidUpdateCardPlacement, useAndroidUpdatePlacement } from './useAndroidUpdatePlacement';

const installed = { versionName: '1.0.15', versionCode: 10090 };

const release: AndroidUpdateRelease = {
  versionName: '1.0.16',
  versionCode: 10100,
  tagName: 'v1.0.16',
  releaseName: 'LoggeRythm 1.0.16',
  releaseUrl: 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.0.16',
  publishedAt: '2026-11-17T23:25:14Z',
  apkName: 'LoggeRythm-v1.0.16.apk',
  apkUrl: 'https://github.com/LoggeL/LoggeRythm/releases/download/v1.0.16/LoggeRythm-v1.0.16.apk',
  apkDigest: `sha256:${'a'.repeat(64)}`,
  apkSize: 27_884_636,
  summary: null,
};

const availableResult: AndroidUpdateCheck = { kind: 'available', installed, release };
const upToDateResult: AndroidUpdateCheck = { kind: 'up-to-date', installed, latestVersion: '1.0.15' };
const finalFailure = { code: 'updater-signature-mismatch', message: 'signer differs', httpStatus: null };
const network = { code: 'network', message: 'Network request failed', httpStatus: null };

function snapshot(overrides: Partial<AndroidUpdateSnapshot> = {}): AndroidUpdateSnapshot {
  return {
    supported: true,
    installed,
    check: { kind: 'idle' },
    install: { kind: 'idle' },
    updatedTo: null,
    orphanedInstallFailure: null,
    startupNotes: [],
    ...overrides,
  };
}

function done(result: AndroidUpdateCheck): Partial<AndroidUpdateSnapshot> {
  return { check: { kind: 'done', result, checkedAt: 1 } };
}

/** The hook as the profile calls it: once per render. */
function ProfileSlot() {
  return useAndroidUpdatePlacement();
}

/** One render of the profile with the store in `state`. */
function render(state: AndroidUpdateSnapshot) {
  mocks.snapshot = state;
  return ProfileSlot();
}

function unmount() {
  mocks.mounted = false;
  mocks.state = undefined;
}

describe('androidUpdateCardPlacement', () => {
  it.each([
    ['an installable update', snapshot(done(availableResult)), 'top'],
    ['a running install', snapshot({ ...done(availableResult), install: { kind: 'downloading', release, progress: null } }), 'top'],
    ['a retryable install failure', snapshot({
      ...done(availableResult),
      install: { kind: 'failed', release, failure: { code: 'updater-install-aborted', message: 'aborted', httpStatus: null } },
    }), 'top'],
    ['a final failure of this process not yet acknowledged', snapshot({
      ...done(availableResult),
      install: { kind: 'failed', release, failure: finalFailure, unacknowledged: true },
    }), 'top'],
    ['an acknowledged or restored final failure', snapshot({
      ...done(availableResult),
      install: { kind: 'failed', release, failure: finalFailure },
    }), 'bottom'],
    ['no check yet', snapshot(), 'bottom'],
    ['a running first check', snapshot({ check: { kind: 'checking', previous: null, previousCheckedAt: null } }), 'bottom'],
    ['up to date', snapshot(done(upToDateResult)), 'bottom'],
    ['a failed check', snapshot({
      check: { kind: 'failed', failure: network, checkedAt: 2, previous: null, previousCheckedAt: null },
    }), 'bottom'],
    ['off Android', snapshot({ supported: false, ...done(availableResult) }), 'bottom'],
  ] as const)('puts %s %s', (_name, state, placement) => {
    expect(androidUpdateCardPlacement(state)).toBe(placement);
  });
});

describe('useAndroidUpdatePlacement', () => {
  beforeEach(() => {
    unmount();
    mocks.getSnapshot.mockReset();
    mocks.getSnapshot.mockImplementation(() => mocks.snapshot);
  });

  it('keeps the top slot for the whole visit, while the header dot follows the live state', () => {
    expect(render(snapshot(done(availableResult)))).toBe('top');

    // "Check again" finds nothing any more: the card stays where the user pressed it.
    const recheckedAway = snapshot(done(upToDateResult));
    expect(render(recheckedAway)).toBe('top');
    expect(androidUpdateNeedsAttention(recheckedAway)).toBe(false);
    expect(mocks.getSnapshot).toHaveBeenCalledOnce();

    // The next visit picks the slot again.
    unmount();
    expect(render(recheckedAway)).toBe('bottom');
  });

  it('keeps the bottom slot for the whole visit when an update turns up meanwhile', () => {
    expect(render(snapshot({ check: { kind: 'checking', previous: upToDateResult, previousCheckedAt: 1 } })))
      .toBe('bottom');

    const offered = snapshot(done(availableResult));
    expect(render(offered)).toBe('bottom');
    expect(androidUpdateNeedsAttention(offered)).toBe(true);
    expect(render(snapshot({ ...offered, install: { kind: 'downloading', release, progress: null } })))
      .toBe('bottom');
    expect(mocks.getSnapshot).toHaveBeenCalledOnce();

    unmount();
    expect(render(offered)).toBe('top');
  });
});
