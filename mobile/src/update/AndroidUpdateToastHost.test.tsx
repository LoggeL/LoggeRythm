/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  checkForAndroidUpdate: vi.fn(),
  show: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    default: actual,
    useEffect: (effect: () => void | (() => void)) => {
      mocks.effects.push(effect);
    },
  };
});

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  ToastAndroid: { LONG: 1, show: mocks.show },
}));

vi.mock('../localization', () => ({
  strings: {
    profile: {
      update: {
        toastAvailable: (version: string) => `Version ${version} is ready`,
        startupCheckFailed: 'Launch update check failed',
      },
    },
  },
}));

vi.mock('./githubReleaseUpdater', () => ({
  checkForAndroidUpdate: mocks.checkForAndroidUpdate,
}));

import AndroidUpdateToastHost from './AndroidUpdateToastHost';

const available = {
  kind: 'available' as const,
  installedVersion: '1.0.10',
  release: {
    versionName: '1.0.11',
  },
};

describe('Android update toast at app launch', () => {
  beforeEach(() => {
    mocks.effects = [];
    mocks.checkForAndroidUpdate.mockReset();
    mocks.show.mockReset();
  });

  it('toasts exactly once when the launch check finds a newer version', async () => {
    mocks.checkForAndroidUpdate.mockResolvedValue(available);

    AndroidUpdateToastHost();
    const cleanup = mocks.effects[0]();
    await Promise.resolve();

    expect(mocks.checkForAndroidUpdate).toHaveBeenCalledOnce();
    expect(mocks.show).toHaveBeenCalledOnce();
    expect(mocks.show).toHaveBeenCalledWith('Version 1.0.11 is ready', 1);
    if (typeof cleanup === 'function') cleanup();
  });

  it('does not toast when the installed version is current', async () => {
    mocks.checkForAndroidUpdate.mockResolvedValue({
      kind: 'up-to-date',
      installedVersion: '1.0.11',
      latestVersion: '1.0.11',
    });

    AndroidUpdateToastHost();
    mocks.effects[0]();
    await Promise.resolve();

    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('reports a failed launch check visibly instead of swallowing it', async () => {
    mocks.checkForAndroidUpdate.mockRejectedValue(new Error('GitHub HTTP 503'));

    AndroidUpdateToastHost();
    mocks.effects[0]();
    await Promise.resolve();

    expect(mocks.show).toHaveBeenCalledWith(
      'Launch update check failed: GitHub HTTP 503',
      1,
    );
  });

  it('does not toast after the app host unmounts', async () => {
    let resolveCheck!: (value: typeof available) => void;
    mocks.checkForAndroidUpdate.mockReturnValue(new Promise((resolve) => {
      resolveCheck = resolve;
    }));

    AndroidUpdateToastHost();
    const cleanup = mocks.effects[0]();
    if (typeof cleanup === 'function') cleanup();
    resolveCheck(available);
    await Promise.resolve();

    expect(mocks.show).not.toHaveBeenCalled();
  });
});
