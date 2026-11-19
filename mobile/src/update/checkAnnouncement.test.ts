/* eslint-disable import/first */
import { afterEach, describe, expect, it, vi } from 'vitest';

// The store module builds its singleton from React Native at import time.
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  NativeEventEmitter: class {},
  NativeModules: {},
  PermissionsAndroid: { request: vi.fn(), PERMISSIONS: { POST_NOTIFICATIONS: 'post' } },
  Platform: { OS: 'android', Version: 35 },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

import { activateLocale, catalogs } from '../localization';
import type { AndroidUpdateSnapshot } from './androidUpdateStore';
import {
  androidUpdateCheckAnnouncement,
  announceAndroidUpdateCheckOutcomes,
} from './checkAnnouncement';
import type { AndroidUpdateCheck, AndroidUpdateRelease } from './githubReleaseUpdater';
import { androidInstalledNewerCase } from './updatePresentation';

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

const checking = snapshot({ check: { kind: 'checking', previous: null, previousCheckedAt: null } });

function fakeStore(initial: AndroidUpdateSnapshot) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next: AndroidUpdateSnapshot) {
      current = next;
      listeners.forEach((listener) => listener());
    },
    listeners,
  };
}

afterEach(() => {
  activateLocale('de');
});

describe('androidUpdateCheckAnnouncement', () => {
  it('says what the card shows after a finished check, in the active language', () => {
    activateLocale('de');
    const de = catalogs.de.profile.update.checkAnnouncement;
    expect(androidUpdateCheckAnnouncement(snapshot(done({ kind: 'up-to-date', installed, latestVersion: '1.0.15' }))))
      .toBe('Keine neue Version.');
    expect(androidUpdateCheckAnnouncement(snapshot(done({ kind: 'available', installed, release }))))
      .toBe('Update 1.0.16 verfügbar.');
    expect(androidUpdateCheckAnnouncement(snapshot(done({
      kind: 'installed-newer',
      reason: 'newer-name',
      installed,
      latestVersion: '1.0.14',
      latestVersionCode: null,
      releaseUrl: release.releaseUrl,
    })))).toBe(de.installedNewer);

    activateLocale('en');
    expect(androidUpdateCheckAnnouncement(snapshot(done({ kind: 'up-to-date', installed, latestVersion: '1.0.15' }))))
      .toBe('No new version.');
  });

  it('calls a release whose install failed for good not installable, and a retryable failure available', () => {
    activateLocale('en');
    const result = done({ kind: 'available', installed, release });
    expect(androidUpdateCheckAnnouncement(snapshot({
      ...result,
      install: {
        kind: 'failed',
        release,
        failure: { code: 'updater-signature-mismatch', message: 'signer differs', httpStatus: null },
      },
    }))).toBe('Update 1.0.16 can’t be installed.');
    expect(androidUpdateCheckAnnouncement(snapshot({
      ...result,
      install: { kind: 'failed', release, failure: { code: 'network', message: 'offline', httpStatus: null } },
    }))).toBe('Update 1.0.16 available.');
  });

  it('announces a release with the installed build number as not installable, as the card shows it', () => {
    const sameBuild = {
      kind: 'installed-newer' as const,
      reason: 'newer-build' as const,
      installed,
      latestVersion: '1.0.16',
      latestVersionCode: installed.versionCode,
      releaseUrl: release.releaseUrl,
    };
    activateLocale('de');
    expect(androidUpdateCheckAnnouncement(snapshot(done(sameBuild))))
      .toBe('Release 1.0.16 hat dieselbe Build-Nummer und kann nicht installiert werden.');
    activateLocale('en');
    expect(androidUpdateCheckAnnouncement(snapshot(done(sameBuild))))
      .toBe('Release 1.0.16 has the same build number and can’t be installed.');
    // A lower release build is still "newer installed".
    expect(androidUpdateCheckAnnouncement(snapshot(done({ ...sameBuild, latestVersionCode: installed.versionCode - 1 }))))
      .toBe(catalogs.en.profile.update.checkAnnouncement.installedNewer);
    // The same decision the card reads, so the two cannot drift apart.
    expect(androidInstalledNewerCase(sameBuild)).toEqual({ kind: 'same-build', latestVersionCode: installed.versionCode });
    expect(() => androidUpdateCheckAnnouncement(snapshot(done({ ...sameBuild, latestVersionCode: null }))))
      .toThrow('Installed-newer result for release 1.0.16 has no release versionCode');
  });

  it('fails loudly for a check that has not finished', () => {
    expect(() => androidUpdateCheckAnnouncement(checking))
      .toThrow('Only a finished Android update check is announced, not one in state checking');
  });
});

describe('announceAndroidUpdateCheckOutcomes', () => {
  it('announces each check that goes from checking to done, once, until unsubscribed', () => {
    activateLocale('en');
    const upToDate = snapshot(done({ kind: 'up-to-date', installed, latestVersion: '1.0.15' }));
    const store = fakeStore(upToDate);
    const announce = vi.fn();
    const stop = announceAndroidUpdateCheckOutcomes(store, announce);

    // The finished result at subscription time is only the baseline.
    store.publish(upToDate);
    expect(announce).not.toHaveBeenCalled();

    store.publish(checking);
    store.publish(upToDate);
    store.publish({ ...upToDate, updatedTo: '1.0.15' });
    expect(announce).toHaveBeenCalledExactlyOnceWith('No new version.');

    // A failed check is left to its ErrorState.
    store.publish(checking);
    store.publish(snapshot({
      check: {
        kind: 'failed',
        failure: { code: 'network', message: 'offline', httpStatus: null },
        checkedAt: 2,
        previous: null,
        previousCheckedAt: null,
      },
    }));
    expect(announce).toHaveBeenCalledOnce();

    stop();
    expect(store.listeners.size).toBe(0);
  });

  it('announces a check that was already running when it subscribed', () => {
    activateLocale('en');
    const store = fakeStore(checking);
    const announce = vi.fn();
    announceAndroidUpdateCheckOutcomes(store, announce);
    store.publish(snapshot(done({ kind: 'available', installed, release })));
    expect(announce).toHaveBeenCalledExactlyOnceWith('Update 1.0.16 available.');
  });
});
