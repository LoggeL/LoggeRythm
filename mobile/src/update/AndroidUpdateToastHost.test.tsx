/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  start: vi.fn(),
  getSnapshot: vi.fn(),
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
        startupPhase: {
          check: 'Update check failed',
          pendingInstall: 'Outcome of the last update unclear',
          installOutcome: 'Last update not installed',
          installOutcomeUnavailable: 'Status of the last update unreadable',
          appLocale: 'Language of update notices not set',
        },
        updatedToast: (version: string) => `Updated to ${version}.`,
        startupFailureToast: (phase: string) => `${phase} – details in your profile`,
      },
    },
  },
}));

vi.mock('./androidUpdateStore', () => ({
  androidUpdateStore: { start: mocks.start, getSnapshot: mocks.getSnapshot },
}));

import AndroidUpdateToastHost from './AndroidUpdateToastHost';
import { AndroidUpdateError } from './updateErrors';

const networkFailure = { code: 'network', message: 'Network request failed', httpStatus: null };
const markerFailure = {
  code: 'update-marker-invalid',
  message: 'Pending update marker is not JSON',
  httpStatus: null,
};
const abortedFailure = {
  code: 'updater-install-aborted',
  message: 'Install aborted by user (status 3)',
  httpStatus: null,
  releaseVersion: '1.0.17',
};
const networkStartup = { phase: 'check', failure: networkFailure };
const markerStartup = { phase: 'pending-install', failure: markerFailure };
const abortedStartup = { phase: 'install-outcome', failure: abortedFailure };
const unreadableFailure = {
  code: 'updater-install-outcome-invalid',
  message: 'Stored update outcome is corrupt',
  httpStatus: null,
};
const unreadableStartup = { phase: 'install-outcome-unavailable', failure: unreadableFailure };

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function mountHost(): () => void {
  expect(AndroidUpdateToastHost()).toBeNull();
  expect(mocks.effects).toHaveLength(1);
  const cleanup = mocks.effects[0]();
  if (typeof cleanup !== 'function') throw new Error('Toast host effect returned no cleanup');
  return cleanup;
}

describe('Android update toast host at app launch', () => {
  beforeEach(() => {
    mocks.effects = [];
    mocks.start.mockReset();
    mocks.getSnapshot.mockReset();
    mocks.show.mockReset();
    mocks.getSnapshot.mockReturnValue({ installed: { versionName: '1.0.15', versionCode: 10071 } });
  });

  it('starts the shared store exactly once per mount and stays silent when all is well', async () => {
    mocks.start.mockResolvedValue({ updatedTo: null, failures: [] });

    mountHost();
    await settle();

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('confirms a completed self-update', async () => {
    mocks.start.mockResolvedValue({ updatedTo: '1.0.16', failures: [] });

    mountHost();
    await settle();

    expect(mocks.show).toHaveBeenCalledOnce();
    expect(mocks.show).toHaveBeenCalledWith('Updated to 1.0.16.', 1);
  });

  it('toasts every startup failure with its phase and a pointer to the profile, never the cause or raw detail', async () => {
    const localeStartup = {
      phase: 'app-locale',
      failure: { code: 'updater-locale-unsaved', message: 'prefs refused', httpStatus: null },
    };
    mocks.start.mockResolvedValue({
      updatedTo: null,
      failures: [markerStartup, abortedStartup, networkStartup, unreadableStartup, localeStartup],
    });

    mountHost();
    await settle();

    // Android 12+ shows two lines of a text toast; cause and detail live on the profile card.
    expect(mocks.show.mock.calls).toEqual([
      ['Outcome of the last update unclear – details in your profile', 1],
      ['Last update not installed – details in your profile', 1],
      ['Update check failed – details in your profile', 1],
      ['Status of the last update unreadable – details in your profile', 1],
      ['Language of update notices not set – details in your profile', 1],
    ]);
    for (const [toast] of mocks.show.mock.calls as [string, number][]) {
      expect(toast).not.toContain('\n');
      expect(toast).not.toContain('Details:');
      for (const { failure } of [markerStartup, abortedStartup, networkStartup, unreadableStartup, localeStartup]) {
        expect(toast).not.toContain(failure.message);
      }
    }
  });

  it('shows the update confirmation and the failures of the same start', async () => {
    mocks.start.mockResolvedValue({ updatedTo: '1.0.16', failures: [networkStartup] });

    mountHost();
    await settle();

    expect(mocks.show.mock.calls).toEqual([
      ['Updated to 1.0.16.', 1],
      ['Update check failed – details in your profile', 1],
    ]);
  });

  it('does not offer an available update by toast any more', async () => {
    mocks.start.mockResolvedValue({ updatedTo: null, failures: [] });
    mocks.getSnapshot.mockReturnValue({
      installed: { versionName: '1.0.15', versionCode: 10071 },
      check: { kind: 'done', result: { kind: 'available' }, checkedAt: 1 },
    });

    mountHost();
    await settle();

    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('reports a rejected start loudly instead of swallowing it', async () => {
    mocks.start.mockRejectedValue(new AndroidUpdateError('network', 'GitHub unreachable'));

    mountHost();
    await settle();

    // The store keeps it as a startup note, so the profile card shows its cause.
    expect(mocks.show).toHaveBeenCalledExactlyOnceWith('Update check failed – details in your profile', 1);
  });

  it('does not toast after the app host unmounts', async () => {
    let resolveStart!: (value: unknown) => void;
    mocks.start.mockReturnValue(new Promise((resolve) => {
      resolveStart = resolve;
    }));

    const cleanup = mountHost();
    cleanup();
    resolveStart({ updatedTo: '1.0.16', failures: [networkStartup] });
    await settle();

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('does not toast a rejected start after the app host unmounts', async () => {
    let rejectStart!: (error: unknown) => void;
    mocks.start.mockReturnValue(new Promise((_resolve, reject) => {
      rejectStart = reject;
    }));

    const cleanup = mountHost();
    cleanup();
    rejectStart(new Error('late failure'));
    await settle();

    expect(mocks.show).not.toHaveBeenCalled();
  });
});
