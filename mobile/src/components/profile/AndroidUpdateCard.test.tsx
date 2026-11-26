/* eslint-disable import/first */
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  snapshot: null as unknown,
  effects: [] as (() => void | (() => void))[],
  check: vi.fn(() => Promise.resolve()),
  install: vi.fn(() => Promise.resolve()),
  acknowledge: vi.fn(),
  setState: vi.fn(),
  announce: vi.fn(),
  listeners: new Set<() => void>(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    default: actual,
    useEffect: (effect: () => void | (() => void)) => {
      mocks.effects.push(effect);
    },
    // Only LastChecked holds state: the clock, read per mount and refreshed by its effect.
    useState: (initial: unknown) => [
      typeof initial === 'function' ? (initial as () => unknown)() : initial,
      mocks.setState,
    ],
  };
});

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: mocks.announce },
  ActivityIndicator: 'ActivityIndicator',
  AppState: {},
  NativeEventEmitter: class {},
  NativeModules: {},
  PermissionsAndroid: {},
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

// Owns its own useState; covered by AndroidReleaseLink.test.tsx.
vi.mock('./AndroidReleaseLink', () => ({ AndroidReleaseLink: 'AndroidReleaseLink' }));

// The real snapshot helpers decide offers and results; only the singleton
// store and its hook are replaced.
vi.mock('../../update/androidUpdateStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../update/androidUpdateStore')>()),
  androidUpdateStore: {
    check: mocks.check,
    install: mocks.install,
    acknowledgeFinalFailure: mocks.acknowledge,
    getSnapshot: () => mocks.snapshot,
    subscribe: (listener: () => void) => {
      mocks.listeners.add(listener);
      return () => {
        mocks.listeners.delete(listener);
      };
    },
  },
  useAndroidUpdateSnapshot: () => mocks.snapshot,
}));

import glyphMap from '@react-native-vector-icons/material-design-icons/glyphmaps/MaterialDesignIcons.json';
import AndroidUpdateCard from './AndroidUpdateCard';
import { ActionButton } from '../ui';
import { getActiveLocale, strings } from '../../localization';
import { colors } from '../../theme';
import {
  createAndroidUpdateStore,
  type AndroidUpdateSnapshot,
} from '../../update/androidUpdateStore';
import { formatAndroidUpdateBytes } from '../../update/downloadProgress';
import type { AndroidUpdateCheck, AndroidUpdateRelease, FetchLike } from '../../update/githubReleaseUpdater';
import {
  describeAndroidUpdateFailure,
  formatAndroidReleaseDate,
  formatAndroidUpdateCheckedAt,
} from '../../update/updatePresentation';
import {
  byTestId,
  elements,
  flatStyle,
  queryByTestId,
  textContent,
  type TestElement,
} from '../../test/render';

const update = strings.profile.update;
const NOW = Date.parse('2026-11-19T12:00:00Z');
const CHECKED_AT = NOW - 5 * 60 * 1000;

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
  summary: 'Suche kennt jetzt die eigene Bibliothek.',
};

const availableResult: AndroidUpdateCheck = { kind: 'available', installed, release };
const upToDateResult: AndroidUpdateCheck = {
  kind: 'up-to-date',
  installed,
  latestVersion: '1.0.15',
};
const newerBuildResult: AndroidUpdateCheck = {
  kind: 'installed-newer',
  reason: 'newer-build',
  installed,
  latestVersion: '1.0.16',
  latestVersionCode: 10079,
  releaseUrl: release.releaseUrl,
};
const newerNameResult: AndroidUpdateCheck = {
  kind: 'installed-newer',
  reason: 'newer-name',
  installed: { versionName: '1.0.17', versionCode: 10090 },
  latestVersion: '1.0.16',
  latestVersionCode: null,
  releaseUrl: release.releaseUrl,
};

/** GitHub's latest release, the installed 1.0.15 itself. */
const githubRelease = {
  draft: false,
  prerelease: false,
  tag_name: 'v1.0.15',
  name: 'LoggeRythm v1.0.15',
  html_url: 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.0.15',
  published_at: '2026-11-17T23:25:14Z',
  body: 'Neue Funktionen.\n\nAndroid-Versioncode: 10090\n',
  assets: [{
    name: 'LoggeRythm-v1.0.15.apk',
    state: 'uploaded',
    size: 27_884_636,
    content_type: 'application/vnd.android.package-archive',
    digest: `sha256:${'a'.repeat(64)}`,
    browser_download_url: 'https://github.com/LoggeL/LoggeRythm/releases/download/v1.0.15/LoggeRythm-v1.0.15.apk',
  }],
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
  return { check: { kind: 'done', result, checkedAt: CHECKED_AT } };
}

function render(state: AndroidUpdateSnapshot) {
  mocks.snapshot = state;
  return AndroidUpdateCard();
}

function text(node: TestElement): string {
  return textContent(node).join('');
}

function actionButton(tree: React.ReactNode, testID: string): TestElement {
  const found = elements(tree).find(
    (element) => element.type === ActionButton && element.props.testID === testID,
  );
  if (found === undefined) throw new Error(`No ActionButton has testID ${testID}`);
  return found;
}

function press(tree: React.ReactNode, testID: string) {
  (byTestId(tree, testID).props.onPress as () => void)();
}

function errorStates(tree: React.ReactNode): TestElement[] {
  return elements(tree).filter(
    (element) => element.props.testID === 'android-update-error' && typeof element.type !== 'function',
  );
}

function card(tree: React.ReactNode): TestElement {
  const found = elements(tree).find((element) => element.props.testID === 'android-update-card');
  if (found === undefined) throw new Error('The update card did not render');
  return found;
}

describe('AndroidUpdateCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mocks.snapshot = null;
    mocks.effects = [];
    mocks.check.mockClear();
    mocks.install.mockClear();
    mocks.acknowledge.mockClear();
    mocks.setState.mockClear();
    mocks.announce.mockClear();
    mocks.listeners.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('slot', () => {
    // The profile latches one slot per visit (useAndroidUpdatePlacement) and
    // mounts the card once; the card itself renders in every state there.
    it('renders nothing off Android', () => {
      expect(render(snapshot({ supported: false, ...done(availableResult) }))).toBeNull();
    });

    it('renders exactly one card in every state, whatever slot it was latched to', () => {
      const failure = { code: 'network', message: 'Network request failed', httpStatus: null };
      const final = { code: 'updater-signature-mismatch', message: 'signer differs', httpStatus: null };
      for (const state of [
        snapshot(),
        snapshot({ check: { kind: 'checking', previous: null, previousCheckedAt: null } }),
        snapshot({ check: { kind: 'checking', previous: availableResult, previousCheckedAt: CHECKED_AT } }),
        snapshot(done(upToDateResult)),
        snapshot(done(newerBuildResult)),
        snapshot(done(availableResult)),
        snapshot({ ...done(availableResult), install: { kind: 'downloading', release, progress: null } }),
        snapshot({ ...done(availableResult), install: { kind: 'awaiting-confirmation', release } }),
        snapshot({ ...done(availableResult), install: { kind: 'failed', release, failure } }),
        snapshot({ ...done(availableResult), install: { kind: 'failed', release, failure: final } }),
        snapshot({
          ...done(availableResult),
          install: { kind: 'failed', release, failure: final, unacknowledged: true },
        }),
        snapshot({
          check: { kind: 'failed', failure, checkedAt: CHECKED_AT, previous: null, previousCheckedAt: null },
        }),
      ]) {
        // Host elements only: ProfileGroup and Surface pass the testID down.
        const cards = elements(render(state)).filter(
          (element) => element.props.testID === 'android-update-card' && typeof element.type === 'string',
        );
        expect(cards).toHaveLength(1);
      }
    });

    it('keeps the card the user watches when the download ends in a final failure', () => {
      // The same process failed for good: not restored, not acknowledged yet.
      const top = render(snapshot({
        ...done(availableResult),
        install: {
          kind: 'failed',
          release,
          failure: { code: 'updater-signature-mismatch', message: 'signer differs', httpStatus: null },
          unacknowledged: true,
        },
      }));
      expect(card(top).props.title).toBe(update.titleUninstallable);
      expect(errorStates(top)).toHaveLength(1);
      expect(textContent(byTestId(top, 'android-update-error'))).toContain(update.errors.signatureMismatch);
      expect(queryByTestId(top, 'android-update-retry')).toBeNull();
      expect(queryByTestId(top, 'android-update-install')).toBeNull();
    });
  });

  it('asks the shared store for a profile check on mount', () => {
    render(snapshot(done(upToDateResult)));
    expect(mocks.effects).toHaveLength(1);
    mocks.effects[0]();
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('profile');
  });

  it('acknowledges a final failure of this session once the profile unmounts', () => {
    render(snapshot(done(availableResult)));
    const cleanup = mocks.effects[0]();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
    if (typeof cleanup !== 'function') throw new Error('The mount effect returned no cleanup');
    cleanup();
    expect(mocks.acknowledge).toHaveBeenCalledOnce();
  });

  describe('check outcome announcement', () => {
    function publish(state: AndroidUpdateSnapshot) {
      mocks.snapshot = state;
      mocks.listeners.forEach((listener) => listener());
    }

    const checking = snapshot({ check: { kind: 'checking', previous: null, previousCheckedAt: null } });

    it('announces how the check the profile watched ended, once', () => {
      render(snapshot(done(upToDateResult)));
      const cleanup = mocks.effects[0]();
      // Subscribed before the profile check starts, so that check is heard too.
      expect(mocks.listeners.size).toBe(1);
      publish(checking);
      expect(mocks.announce).not.toHaveBeenCalled();
      publish(snapshot(done(upToDateResult)));
      expect(mocks.announce).toHaveBeenCalledExactlyOnceWith(update.checkAnnouncement.upToDate);
      // Later updates of the same finished check stay quiet.
      publish(snapshot({ ...done(upToDateResult), updatedTo: '1.0.15' }));
      expect(mocks.announce).toHaveBeenCalledOnce();
      if (typeof cleanup !== 'function') throw new Error('The mount effect returned no cleanup');
      cleanup();
      expect(mocks.listeners.size).toBe(0);
    });

    it('never announces the result that was already there when the profile opened', () => {
      render(snapshot(done(availableResult)));
      mocks.effects[0]();
      publish(snapshot({ ...done(availableResult), updatedTo: null }));
      expect(mocks.announce).not.toHaveBeenCalled();
    });

    it.each([
      ['an available update', done(availableResult), () => update.checkAnnouncement.available('1.0.16')],
      ['a newer installation', done(newerBuildResult), () => update.checkAnnouncement.installedNewer],
      [
        'a release with the installed build number as not installable, like the card',
        done({ ...newerBuildResult, latestVersion: '1.0.18', latestVersionCode: installed.versionCode }),
        () => update.checkAnnouncement.installedSameBuild('1.0.18'),
      ],
      [
        'a release that failed for good',
        {
          ...done(availableResult),
          install: {
            kind: 'failed' as const,
            release,
            failure: { code: 'updater-signature-mismatch', message: 'signer differs', httpStatus: null },
          },
        },
        () => update.checkAnnouncement.uninstallable('1.0.16'),
      ],
    ])('announces %s', (_name, finished, expected) => {
      render(checking);
      mocks.effects[0]();
      publish(snapshot(finished));
      expect(mocks.announce).toHaveBeenCalledExactlyOnceWith(expected());
    });

    it('leaves a failed check to its ErrorState, or to its live line when folded', () => {
      render(checking);
      mocks.effects[0]();
      publish(snapshot({
        check: {
          kind: 'failed',
          failure: { code: 'network', message: 'offline', httpStatus: null },
          checkedAt: CHECKED_AT,
          previous: null,
          previousCheckedAt: null,
        },
      }));
      expect(mocks.announce).not.toHaveBeenCalled();

      // Folded next to a failed install, no ErrorState of its own: its muted
      // line is the live region that announces it, not the announcer.
      const folded = snapshot({
        check: {
          kind: 'failed',
          failure: { code: 'network', message: 'offline', httpStatus: null },
          checkedAt: CHECKED_AT,
          previous: availableResult,
          previousCheckedAt: CHECKED_AT,
        },
        install: { kind: 'failed', release, failure: { code: 'updater-download-io', message: 'reset', httpStatus: null } },
      });
      publish(checking);
      publish(folded);
      expect(mocks.announce).not.toHaveBeenCalled();
      expect(byTestId(render(folded), 'android-update-check-failure').props.accessibilityLiveRegion).toBe('polite');
    });
  });

  it('shows an installer failure that belongs to no build as a muted line with its raw detail', () => {
    const failure = {
      code: 'updater-install-outcome-invalid',
      message: 'Stored update outcome is corrupt',
      httpStatus: null,
    };
    const tree = render(snapshot({
      ...done(upToDateResult),
      orphanedInstallFailure: { phase: 'install-outcome-unavailable', failure },
    }));
    const presentation = describeAndroidUpdateFailure(failure, {
      phase: 'install',
      releaseVersion: null,
      installedBuild: installed.versionCode,
      installedVersion: installed.versionName,
      detailBelow: false,
    });
    expect(text(byTestId(tree, 'android-update-orphaned-failure'))).toBe(
      `${update.startupPhase.installOutcomeUnavailable}: ${presentation.message} ${update.detail(failure.code, failure.message)}`,
    );
    // Not an install failure of the offered state: no ErrorState, no retry.
    expect(errorStates(tree)).toHaveLength(0);
    expect(byTestId(tree, 'android-update-current')).toBeDefined();

    const outcome = render(snapshot({
      ...done(availableResult),
      orphanedInstallFailure: {
        phase: 'install-outcome',
        failure: { code: 'updater-install-aborted', message: 'aborted (status 3)', httpStatus: null },
      },
    }));
    expect(text(byTestId(outcome, 'android-update-orphaned-failure')))
      .toContain(`${update.startupPhase.installOutcome}: ${update.errors.installAborted}`);
  });

  it('says a short "unknown error" in a note, where the detail follows on the same line', () => {
    const unmapped = { code: null, message: 'boom', httpStatus: null };
    const tree = render(snapshot({
      ...done(upToDateResult),
      startupNotes: [{ phase: 'pending-install', failure: unmapped }],
      orphanedInstallFailure: { phase: 'install-outcome-unavailable', failure: unmapped },
    }));
    expect(text(byTestId(tree, 'android-update-startup-note')))
      .toBe(`${update.startupPhase.pendingInstall}: ${update.errors.unknownShort} ${update.detail('error', 'boom')}`);
    expect(text(byTestId(tree, 'android-update-orphaned-failure')))
      .toBe(`${update.startupPhase.installOutcomeUnavailable}: ${update.errors.unknownShort} ${update.detail('error', 'boom')}`);
    expect(textContent(tree)).not.toContain(update.errors.unknown);
  });

  it('shows every startup note with its phase, cause and raw detail, once each', () => {
    const marker = { code: 'update-marker-invalid', message: 'Pending update marker is not JSON', httpStatus: null };
    const aborted = {
      code: 'updater-install-aborted',
      message: 'Install aborted (status 3)',
      httpStatus: null,
      releaseVersion: '1.0.15',
    };
    const network = { code: 'network', message: 'GitHub could not be reached: offline', httpStatus: null };
    const tree = render(snapshot({
      ...done(upToDateResult),
      startupNotes: [
        { phase: 'pending-install', failure: marker },
        { phase: 'install-outcome', failure: aborted },
      ],
    }));
    const context = {
      releaseVersion: null,
      installedBuild: installed.versionCode,
      installedVersion: installed.versionName,
      detailBelow: false,
    };
    const notes = elements(tree).filter(
      (element) => element.props.testID === 'android-update-startup-note' && typeof element.type !== 'function',
    );
    expect(notes.map(text)).toEqual([
      `${update.startupPhase.pendingInstall}: ${describeAndroidUpdateFailure(marker, { phase: 'check', ...context }).message} ${update.detail(marker.code, marker.message)}`,
      `${update.startupPhase.installOutcome}: ${update.errors.installAborted} ${update.detail(aborted.code, aborted.message)}`,
    ]);
    expect(notes.every((note) => note.props.selectable === true)).toBe(true);
    // Notes are no failures of the current state: no ErrorState, no retry.
    expect(errorStates(tree)).toHaveLength(0);
    expect(byTestId(tree, 'android-update-current')).toBeDefined();

    // A start that failed in its own setup, next to a failed check: both, each once.
    const failedCheck = render(snapshot({
      check: { kind: 'failed', failure: network, checkedAt: CHECKED_AT, previous: null, previousCheckedAt: null },
      startupNotes: [{ phase: 'check', failure: { code: null, message: 'AppState is unavailable', httpStatus: null } }],
    }));
    expect(errorStates(failedCheck)).toHaveLength(1);
    const lines = textContent(failedCheck).join('\n');
    expect(lines.split(update.detail('network', network.message)).length - 1).toBe(1);
    expect(lines.split(update.detail('error', 'AppState is unavailable')).length - 1).toBe(1);
  });

  it('shows a failed startup check the toast pointed to, also while a later check runs', () => {
    const network = { code: 'network', message: 'GitHub could not be reached: offline', httpStatus: null };
    const startupNotes = [{ phase: 'check' as const, failure: network }];
    const failedCheck = { kind: 'failed' as const, failure: network, checkedAt: CHECKED_AT, previous: null, previousCheckedAt: null };
    const detail = update.detail('network', network.message);
    const count = (tree: React.ReactNode) => textContent(tree).join('\n').split(detail).length - 1;

    // Still the check state: shown once, by the check's ErrorState.
    const stillFailed = render(snapshot({ check: failedCheck, startupNotes }));
    expect(errorStates(stillFailed)).toHaveLength(1);
    expect(queryByTestId(stillFailed, 'android-update-startup-note')).toBeNull();
    expect(count(stillFailed)).toBe(1);

    // Folded next to an install failure: still once.
    const folded = render(snapshot({
      ...done(availableResult),
      check: failedCheck,
      install: { kind: 'failed', release, failure: { code: 'updater-install-busy', message: 'busy', httpStatus: null } },
      startupNotes,
    }));
    expect(queryByTestId(folded, 'android-update-startup-note')).toBeNull();
    expect(count(folded)).toBe(1);

    // Opening the profile re-checks: while it runs, the note keeps the cause.
    // (Once that check finishes, the store drops the note.)
    const later = render(snapshot({ check: { kind: 'checking', previous: null, previousCheckedAt: null }, startupNotes }));
    expect(text(byTestId(later, 'android-update-startup-note')))
      .toBe(`${update.startupPhase.check}: ${update.errors.network} ${detail}`);
    expect(count(later)).toBe(1);
  });

  it('always shows the installed version and build when they are known', () => {
    const failure = { code: 'network', message: 'Network request failed', httpStatus: null };
    const states = [
      snapshot(),
      snapshot({ check: { kind: 'checking', previous: null, previousCheckedAt: null } }),
      snapshot(done(upToDateResult)),
      snapshot(done(newerBuildResult)),
      snapshot(done(availableResult)),
      snapshot({ ...done(availableResult), install: { kind: 'preparing', release } }),
      snapshot({ ...done(availableResult), install: { kind: 'permission', release } }),
      snapshot({
        ...done(availableResult),
        install: { kind: 'downloading', release, progress: null },
      }),
      snapshot({ ...done(availableResult), install: { kind: 'awaiting-confirmation', release } }),
      snapshot({ ...done(availableResult), install: { kind: 'failed', release, failure } }),
      snapshot({ check: { kind: 'failed', failure, checkedAt: CHECKED_AT, previous: null, previousCheckedAt: null } }),
    ];
    for (const state of states) {
      const tree = render(state);
      expect(text(byTestId(tree, 'android-update-installed-version')))
        .toBe(update.installedVersion('1.0.15'));
      expect(text(byTestId(tree, 'android-update-installed-build')))
        .toBe(update.installedBuild(10090));
    }
  });

  it('omits the version line only while the installed build is still unknown', () => {
    const tree = render(snapshot({
      installed: null,
      check: { kind: 'checking', previous: null, previousCheckedAt: null },
    }));
    expect(queryByTestId(tree, 'android-update-installed-version')).toBeNull();
    expect(text(byTestId(tree, 'android-update-checking'))).toBe(update.checking);
  });

  it('confirms a completed self-update', () => {
    const tree = render(snapshot({ ...done(upToDateResult), updatedTo: '1.0.15' }));
    expect(text(byTestId(tree, 'android-update-updated-to'))).toBe(update.updatedTo('1.0.15'));
    expect(queryByTestId(render(snapshot(done(upToDateResult))), 'android-update-updated-to'))
      .toBeNull();
  });

  it('shows up to date with the last check time and a manual re-check', () => {
    const tree = render(snapshot(done(upToDateResult)));
    const group = card(tree);
    expect(group.props.title).toBe(update.titleVersion);
    expect(group.props.icon).toBe('cellphone-check');
    expect(text(byTestId(tree, 'android-update-current'))).toBe(update.upToDate);
    expect(text(byTestId(tree, 'android-update-last-checked'))).toBe(
      update.lastChecked(formatAndroidUpdateCheckedAt(CHECKED_AT, NOW, getActiveLocale())),
    );
    expect(queryByTestId(tree, 'android-update-install')).toBeNull();
    expect(queryByTestId(tree, 'android-update-checking')).toBeNull();

    const recheck = actionButton(tree, 'android-update-recheck');
    expect(recheck.props.variant).toBe('ghost');
    expect(recheck.props.busy).toBe(false);
    expect(recheck.props.label).toBe(update.recheck);
    press(tree, 'android-update-recheck');
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('manual');
  });

  it('keeps the previous result visible while a re-check runs', () => {
    const tree = render(snapshot({
      check: { kind: 'checking', previous: upToDateResult, previousCheckedAt: CHECKED_AT },
    }));
    expect(text(byTestId(tree, 'android-update-checking'))).toBe(update.checking);
    expect(byTestId(tree, 'android-update-checking').props.accessibilityLiveRegion).toBe('polite');
    expect(text(byTestId(tree, 'android-update-current'))).toBe(update.upToDate);
    expect(queryByTestId(tree, 'android-update-last-checked')).not.toBeNull();
    expect(actionButton(tree, 'android-update-recheck').props.busy).toBe(true);
  });

  it('dates the kept result by its own check when a re-check follows a failed one', async () => {
    // The real store, driven through done → failed → checking.
    let clock = NOW - 10 * 60 * 1000;
    const doneAt = clock;
    const storage = new Map<string, string>();
    const gate: { resolve?: (response: Awaited<ReturnType<FetchLike>>) => void } = {};
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => githubRelease })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => null })
      .mockImplementationOnce(() => new Promise((resolve) => { gate.resolve = resolve; }));
    const store = createAndroidUpdateStore({
      platformOS: 'android',
      platformVersion: 35,
      updater: {
        getInstallationInfo: async () => ({ ...installed, canRequestPackageInstalls: true }),
        openInstallPermissionSettings: async () => undefined,
        downloadAndInstall: async () => { throw new Error('No install in this test'); },
      },
      fetcher,
      now: () => clock,
      storage: {
        getItem: async (key) => storage.get(key) ?? null,
        setItem: async (key, value) => { storage.set(key, value); },
        removeItem: async (key) => { storage.delete(key); },
      },
      appState: { addEventListener: () => ({ remove: () => undefined }) },
      requestNotificationPermission: async () => 'granted',
      subscribeProgress: () => () => undefined,
      consumeInstallOutcome: async () => null,
      subscribeInstallOutcome: () => () => undefined,
      setAppLocale: async () => undefined,
      activeLocale: getActiveLocale,
      subscribeLocale: () => () => undefined,
    });

    await store.check('manual');
    expect(store.getSnapshot().check.kind).toBe('done');
    clock = NOW - 5 * 60 * 1000;
    await store.check('manual');
    expect(store.getSnapshot().check.kind).toBe('failed');
    clock = NOW;
    const running = store.check('manual');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));

    const tree = render(store.getSnapshot());
    expect(text(byTestId(tree, 'android-update-checking'))).toBe(update.checking);
    expect(text(byTestId(tree, 'android-update-current'))).toBe(update.upToDate);
    // The up-to-date result is ten minutes old; the failed check five minutes ago produced none.
    expect(text(byTestId(tree, 'android-update-last-checked'))).toBe(
      update.lastChecked(formatAndroidUpdateCheckedAt(doneAt, NOW, getActiveLocale())),
    );

    gate.resolve?.({ ok: true, status: 200, json: async () => githubRelease });
    await running;
  });

  it('refreshes the last-checked time every minute until unmounted', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    const tree = render(snapshot(done(upToDateResult)));
    expect(text(byTestId(tree, 'android-update-last-checked'))).toBe(
      update.lastChecked(formatAndroidUpdateCheckedAt(CHECKED_AT, NOW, getActiveLocale())),
    );
    // The card's mount check, then LastChecked's clock.
    expect(mocks.effects).toHaveLength(2);
    const cleanup = mocks.effects[1]();
    expect(cleanup).toBeTypeOf('function');

    vi.advanceTimersByTime(59_999);
    expect(mocks.setState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mocks.setState).toHaveBeenCalledExactlyOnceWith(NOW + 60_000);
    vi.advanceTimersByTime(60_000);
    expect(mocks.setState).toHaveBeenLastCalledWith(NOW + 120_000);

    (cleanup as () => void)();
    vi.advanceTimersByTime(10 * 60_000);
    expect(mocks.setState).toHaveBeenCalledTimes(2);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('explains a newer build and never offers its install', () => {
    const tree = render(snapshot(done(newerBuildResult)));
    const group = card(tree);
    expect(group.props.title).toBe(update.titleVersion);
    expect(group.props.icon).toBe('flask-outline');
    expect(text(byTestId(tree, 'android-update-installed-newer')))
      .toBe(update.installedNewerBuild(10090, '1.0.16', 10079));
    expect(text(byTestId(tree, 'android-update-installed-newer-hint'))).toBe(update.installedNewerHint);
    expect(queryByTestId(tree, 'android-update-install')).toBeNull();
    expect(queryByTestId(tree, 'android-update-available')).toBeNull();

    const link = byTestId(tree, 'android-update-release-link');
    expect(link.type).toBe('AndroidReleaseLink');
    expect(link.props.url).toBe(release.releaseUrl);
    expect(link.props.label).toBe(update.viewRelease);

    press(tree, 'android-update-recheck');
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('manual');
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it('calls an equal build number the same build and points to the release line, not to a dev build', () => {
    const tree = render(snapshot(done({
      ...newerBuildResult,
      latestVersion: '1.0.18',
      latestVersionCode: installed.versionCode,
    })));
    expect(text(byTestId(tree, 'android-update-installed-newer')))
      .toBe(update.installedSameBuild('1.0.18', installed.versionCode));
    expect(text(byTestId(tree, 'android-update-installed-newer-hint'))).toBe(update.installedSameBuildHint);
    expect(textContent(tree)).not.toContain(update.installedNewerHint);
    expect(queryByTestId(tree, 'android-update-install')).toBeNull();
    expect(byTestId(tree, 'android-update-release-link').props.url).toBe(release.releaseUrl);
  });

  it('explains a newer version name and never offers its install', () => {
    const tree = render(snapshot(done(newerNameResult)));
    expect(text(byTestId(tree, 'android-update-installed-newer')))
      .toBe(update.installedNewerName('1.0.16'));
    expect(queryByTestId(tree, 'android-update-install')).toBeNull();
  });

  it('fails loudly on a newer-build result without the release build', () => {
    expect(() => elements(render(snapshot(done({ ...newerBuildResult, latestVersionCode: null })))))
      .toThrow('has no release versionCode');
  });

  it('offers an available update with transition, meta, notes, link and install', () => {
    const tree = render(snapshot(done(availableResult)));
    const locale = getActiveLocale();
    const size = formatAndroidUpdateBytes(release.apkSize, locale);
    const group = card(tree);
    expect(group.props.title).toBe(update.titleAvailable);
    expect(group.props.icon).toBe('cellphone-arrow-down');

    expect(text(byTestId(tree, 'android-update-available')))
      .toBe(update.transition('1.0.15', '1.0.16'));
    expect(text(byTestId(tree, 'android-update-available-meta')))
      .toBe(update.availableMeta(size, formatAndroidReleaseDate(release.publishedAt, locale)));
    expect(textContent(tree)).toContain(update.notesLabel);
    const notes = byTestId(tree, 'android-update-release-notes');
    expect(text(notes)).toBe(release.summary);
    expect(notes.props.numberOfLines).toBe(3);

    const link = byTestId(tree, 'android-update-release-link');
    expect(link.props.url).toBe(release.releaseUrl);
    expect(link.props.label).toBe(update.releaseLink);

    const install = actionButton(tree, 'android-update-install');
    expect(install.props.variant).toBe('accent');
    expect(install.props.label).toBe(update.install(size));
    expect(install.props.busy).toBe(false);
    expect(flatStyle(byTestId(tree, 'android-update-install').props.style).backgroundColor)
      .toBe(colors.accent);
    expect(textContent(tree)).toContain(update.safety);

    press(tree, 'android-update-install');
    expect(mocks.install).toHaveBeenCalledOnce();
    press(tree, 'android-update-recheck');
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('manual');
  });

  it('hides the notes when the release has no summary', () => {
    const tree = render(snapshot(done({
      kind: 'available',
      installed,
      release: { ...release, summary: null },
    })));
    expect(queryByTestId(tree, 'android-update-release-notes')).toBeNull();
    expect(textContent(tree)).not.toContain(update.notesLabel);
  });

  it('fails loudly when an update is offered without a known installed build', () => {
    expect(() => elements(render(snapshot({ installed: null, ...done(availableResult) }))))
      .toThrow('installed build was never read');
  });

  it('shows the preparing step with a busy install button', () => {
    const tree = render(snapshot({ ...done(availableResult), install: { kind: 'preparing', release } }));
    expect(text(byTestId(tree, 'android-update-preparing'))).toBe(update.preparing);
    expect(actionButton(tree, 'android-update-install').props.busy).toBe(true);
    expect(byTestId(tree, 'android-update-install').props.disabled).toBe(true);
    expect(actionButton(tree, 'android-update-recheck').props.disabled).toBe(true);
  });

  it('shows download progress with the bar, the status and the hint', () => {
    const tree = render(snapshot({
      ...done(availableResult),
      install: {
        kind: 'downloading',
        release,
        progress: { downloadedBytes: 13_942_318, totalBytes: 27_884_636 },
      },
    }));
    expect(text(byTestId(tree, 'android-update-downloading')))
      .toBe(update.downloading('1.0.16'));
    const bar = byTestId(tree, 'android-update-progress');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessible).toBe(true);
    // A static label; the progress is read once, as the value.
    expect(bar.props.accessibilityLabel).toBe(update.progressLabel);
    const value = bar.props.accessibilityValue as { text: string };
    expect(value).toMatchObject({ min: 0, max: 100, now: 50 });
    expect(value.text).toMatch(/50/);
    expect(value.text).not.toContain(update.progressLabel);
    // The visible text is not a second focus stop reading the same progress.
    const visible = byTestId(tree, 'android-update-progress-text');
    expect(visible.props.accessible).toBe(false);
    expect(visible.props.importantForAccessibility).toBe('no');
    // Progress events arrive many times a second: nothing in the bar is a live region,
    // or TalkBack would queue an announcement for each of them.
    expect(bar.props.accessibilityLiveRegion).toBeUndefined();
    expect(elements(bar).filter((element) => element.props.accessibilityLiveRegion !== undefined)).toEqual([]);
    expect(flatStyle(byTestId(tree, 'android-update-progress-fill').props.style).width)
      .toBe('50%');
    expect(text(byTestId(tree, 'android-update-progress-text'))).not.toBe('');
    expect(actionButton(tree, 'android-update-install').props.busy).toBe(true);
    expect(actionButton(tree, 'android-update-recheck').props.disabled).toBe(true);
  });

  it('shows an indeterminate download before the first progress event', () => {
    const tree = render(snapshot({
      ...done(availableResult),
      install: { kind: 'downloading', release, progress: null },
    }));
    const bar = byTestId(tree, 'android-update-progress');
    expect(queryByTestId(tree, 'android-update-progress-fill')).toBeNull();
    expect(bar.props.accessibilityLabel).toBe(update.progressLabel);
    const value = bar.props.accessibilityValue as Record<string, unknown>;
    expect(value).not.toHaveProperty('now');
    expect(value.text).not.toContain(update.progressLabel);
    const visible = byTestId(tree, 'android-update-progress-text');
    expect(text(visible)).not.toBe('');
    expect(visible.props.accessible).toBe(false);
    expect(visible.props.importantForAccessibility).toBe('no');
  });

  it('asks for the Android confirmation and can start the installer again', () => {
    const tree = render(snapshot({
      ...done(availableResult),
      install: { kind: 'awaiting-confirmation', release },
    }));
    const submitted = byTestId(tree, 'android-update-submitted');
    expect(text(submitted)).toBe(update.confirm('1.0.16'));
    expect(submitted.props.accessibilityLiveRegion).toBe('assertive');
    expect(textContent(tree)).toContain(update.confirmHint);
    expect(queryByTestId(tree, 'android-update-progress-warning')).toBeNull();
    expect(queryByTestId(tree, 'android-update-install')).toBeNull();

    const restart = actionButton(tree, 'android-update-restart');
    expect(restart.props.label).toBe(update.restartInstall);
    expect(restart.props.variant).toBe('ghost');
    press(tree, 'android-update-restart');
    expect(mocks.install).toHaveBeenCalledOnce();

    // A dismissed dialog must not block a re-check.
    expect(actionButton(tree, 'android-update-recheck').props.disabled).toBe(false);
    expect(byTestId(tree, 'android-update-recheck').props.disabled).toBe(false);
    press(tree, 'android-update-recheck');
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('manual');
  });

  it('shows a broken progress report as a muted note while Android asks for confirmation', () => {
    const warning = {
      code: 'updater-progress-invalid',
      message: 'progress event downloadedBytes -1 is not a byte count',
      httpStatus: null,
    };
    const tree = render(snapshot({
      ...done(availableResult),
      install: { kind: 'awaiting-confirmation', release, warning },
    }));
    // The verified APK reached the installer: still a success, not a failure.
    expect(text(byTestId(tree, 'android-update-submitted'))).toBe(update.confirm('1.0.16'));
    expect(errorStates(tree)).toHaveLength(0);
    expect(queryByTestId(tree, 'android-update-error')).toBeNull();
    expect(queryByTestId(tree, 'android-update-retry')).toBeNull();

    const note = byTestId(tree, 'android-update-progress-warning');
    expect(flatStyle(note.props.style).color).toBe(colors.textMuted);
    expect(note.props.selectable).toBe(true);
    expect(text(note)).toBe(
      `${update.progressWarning} ${update.detail(warning.code, warning.message)}`,
    );
    // The dialog can still be raised again.
    expect(actionButton(tree, 'android-update-restart').props.label).toBe(update.restartInstall);
  });

  it('asks for the install permission and continues through the store', () => {
    const tree = render(snapshot({ ...done(availableResult), install: { kind: 'permission', release } }));
    const permission = byTestId(tree, 'android-update-permission');
    expect(text(permission)).toBe(update.permission);
    expect(permission.props.accessibilityRole).toBe('alert');
    const button = actionButton(tree, 'android-update-install');
    expect(button.props.label).toBe(update.permissionContinue);
    expect(button.props.variant).toBe('accent');
    press(tree, 'android-update-install');
    expect(mocks.install).toHaveBeenCalledOnce();
  });

  it('shows a failed check with its cause, detail and a re-check retry', () => {
    const tree = render(snapshot({
      check: {
        kind: 'failed',
        failure: { code: 'network', message: 'Network request failed', httpStatus: null },
        checkedAt: CHECKED_AT,
        previous: upToDateResult,
        previousCheckedAt: CHECKED_AT - 60_000,
      },
    }));
    const error = byTestId(tree, 'android-update-error');
    expect(error.props.accessibilityRole).toBe('alert');
    expect(textContent(error)).toContain(update.checkFailedTitle);
    expect(textContent(error)).toContain(update.errors.network);
    expect(text(byTestId(tree, 'android-update-error-detail')))
      .toBe(update.detail('network', 'Network request failed'));
    // The failure replaces the older result instead of contradicting it.
    expect(queryByTestId(tree, 'android-update-current')).toBeNull();
    expect(queryByTestId(tree, 'android-update-recheck')).toBeNull();

    const retry = byTestId(tree, 'android-update-retry');
    expect(textContent(retry)).toContain(update.recheck);
    press(tree, 'android-update-retry');
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('manual');
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it('says "unknown" for a failure without a localized cause and keeps the raw detail', () => {
    const tree = render(snapshot({
      check: {
        kind: 'failed',
        failure: { code: null, message: 'Unexpected token < in JSON', httpStatus: null },
        checkedAt: CHECKED_AT,
        previous: null,
        previousCheckedAt: null,
      },
    }));
    const error = byTestId(tree, 'android-update-error');
    expect(textContent(error)).toContain(update.errors.unknown);
    expect(textContent(error)).not.toContain('Unexpected token < in JSON');
    // The ErrorState's detail is below it, so its "unknown" may point there.
    expect(textContent(error)).not.toContain(update.errors.unknownShort);
    expect(text(byTestId(tree, 'android-update-error-detail')))
      .toBe(update.detail('error', 'Unexpected token < in JSON'));
  });

  it.each(['preparing', 'downloading'] as const)(
    'offers no check retry while the install is %s',
    (kind) => {
      const failure = { code: 'network', message: 'Network request failed', httpStatus: null };
      const tree = render(snapshot({
        check: { kind: 'failed', failure, checkedAt: CHECKED_AT, previous: availableResult, previousCheckedAt: CHECKED_AT },
        install: kind === 'preparing'
          ? { kind, release }
          : { kind, release, progress: null },
      }));
      expect(textContent(byTestId(tree, 'android-update-error'))).toContain(update.errors.network);
      expect(queryByTestId(tree, 'android-update-retry')).toBeNull();
      expect(queryByTestId(tree, 'android-update-recheck')).toBeNull();
      expect(actionButton(tree, 'android-update-install').props.busy).toBe(true);
    },
  );

  it('keeps the check retry while the Android dialog waits', () => {
    const failure = { code: 'network', message: 'Network request failed', httpStatus: null };
    const tree = render(snapshot({
      check: { kind: 'failed', failure, checkedAt: CHECKED_AT, previous: availableResult, previousCheckedAt: CHECKED_AT },
      install: { kind: 'awaiting-confirmation', release },
    }));
    press(tree, 'android-update-retry');
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('manual');
  });

  it('shows one ErrorState for a failed install and folds a failed check into a muted line', () => {
    const checkFailure = { code: 'network', message: 'Network request failed', httpStatus: null };
    const installFailure = {
      code: 'updater-download-io',
      message: 'Connection reset',
      httpStatus: null,
    };
    const tree = render(snapshot({
      check: { kind: 'failed', failure: checkFailure, checkedAt: CHECKED_AT, previous: availableResult, previousCheckedAt: CHECKED_AT },
      install: { kind: 'failed', release, failure: installFailure },
    }));
    const errors = errorStates(tree);
    expect(errors).toHaveLength(1);
    expect(textContent(errors[0])).toContain(update.installFailedTitle);
    expect(textContent(errors[0])).toContain(update.errors.download);
    expect(textContent(errors[0])).not.toContain(update.checkFailedTitle);

    const note = byTestId(tree, 'android-update-check-failure');
    expect(flatStyle(note.props.style).color).toBe(colors.textMuted);
    expect(text(note)).toBe(
      `${update.checkFailedTitle}: ${update.errors.network} ${update.detail('network', 'Network request failed')}`,
    );
    // No ErrorState announces the folded check failure, so its line does
    // (politely: the install ErrorState is the assertive one).
    expect(note.props.accessibilityLiveRegion).toBe('polite');

    // The install retry and a manual re-check are both still there.
    press(tree, 'android-update-retry');
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(actionButton(tree, 'android-update-recheck').props.disabled).toBe(false);
    press(tree, 'android-update-recheck');
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('manual');
  });

  it.each([
    ['updater-install-aborted', 'PackageInstaller aborted (status 3)', () => update.errors.installAborted],
    ['updater-install-failed', 'INSTALL_FAILED_INSUFFICIENT_STORAGE (status 6)', () => update.errors.installRejected],
    ['updater-install-confirmation-blocked', 'notification blocked', () => update.errors.confirmationBlocked],
    ['updater-install-outcome-unsaved', 'Android could not clear the stored update outcome', () => update.errors.outcomeUnsaved],
  ])('shows the retryable installer outcome %s with its cause and retries the install', (code, message, cause) => {
    const failure = { code, message, httpStatus: null };
    const tree = render(snapshot({
      ...done(availableResult),
      install: { kind: 'failed', release, failure },
    }));
    const error = byTestId(tree, 'android-update-error');
    expect(textContent(error)).toContain(update.installFailedTitle);
    expect(textContent(error)).toContain(cause());
    expect(text(byTestId(tree, 'android-update-error-detail')))
      .toBe(update.detail(failure.code, failure.message));
    expect(queryByTestId(tree, 'android-update-install')).toBeNull();
    expect(queryByTestId(tree, 'android-update-final-hint')).toBeNull();
    // Still an offer: the install framing and the safety caption stay.
    expect(card(tree).props.title).toBe(update.titleAvailable);
    expect(card(tree).props.icon).toBe('cellphone-arrow-down');
    expect(text(byTestId(tree, 'android-update-available')))
      .toBe(update.transition('1.0.15', '1.0.16'));
    expect(textContent(tree)).toContain(update.safety);

    const retry = byTestId(tree, 'android-update-retry');
    expect(textContent(retry)).toContain(update.retryInstall);
    press(tree, 'android-update-retry');
    expect(mocks.install).toHaveBeenCalledOnce();
  });

  it.each([
    ['updater-apk-not-newer', 'device'],
    ['updater-signature-mismatch', 'release'],
    ['updater-signature-missing', 'release'],
    ['updater-digest-mismatch', 'release'],
    ['updater-apk-version-mismatch', 'release'],
    ['updater-apk-version-code-mismatch', 'release'],
    ['updater-package-mismatch', 'release'],
    ['updater-apk-invalid', 'release'],
    ['updater-version-code-invalid', 'release'],
    ['updater-install-incompatible', 'device'],
    ['updater-install-blocked', 'device'],
    ['updater-install-conflict', 'device'],
  ] as const)('offers no retry for the final install failure %s, only the %s hint and the release link', (code, cause) => {
    const failure = { code, message: `raw ${code}`, httpStatus: null };
    const tree = render(snapshot({
      ...done(availableResult),
      install: { kind: 'failed', release, failure },
    }));
    expect(textContent(byTestId(tree, 'android-update-error'))).toContain(update.installFailedTitle);
    expect(textContent(byTestId(tree, 'android-update-error'))).not.toContain(update.errors.unknown);
    expect(text(byTestId(tree, 'android-update-error-detail'))).toBe(update.detail(code, `raw ${code}`));
    expect(queryByTestId(tree, 'android-update-retry')).toBeNull();
    expect(queryByTestId(tree, 'android-update-install')).toBeNull();
    // Release data and APK problems are explained on the release page; a
    // device-side refusal only in the details on the card.
    expect(text(byTestId(tree, 'android-update-final-hint'))).toBe(update.finalFailureHint[cause]);

    // Nothing to install: the link leads to the release page, not to a changelog.
    const link = byTestId(tree, 'android-update-release-link');
    expect(link.props.url).toBe(release.releaseUrl);
    expect(link.props.label).toBe(update.viewRelease);

    // A newer release may still come: the re-check stays available.
    press(tree, 'android-update-recheck');
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith('manual');
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it('frames a final install failure as not installable, keeping the release facts', () => {
    const failure = { code: 'updater-install-incompatible', message: 'INSTALL_FAILED_OLDER_SDK (status 7)', httpStatus: null };
    const tree = render(snapshot({
      ...done(availableResult),
      install: { kind: 'failed', release, failure },
    }));
    const locale = getActiveLocale();
    const group = card(tree);
    expect(group.props.title).toBe(update.titleUninstallable);
    expect(group.props.icon).toBe('alert-octagon-outline');
    expect(glyphMap).toHaveProperty('alert-octagon-outline');

    // The release stays identified, without the accent "from → to" offer.
    expect(queryByTestId(tree, 'android-update-available')).toBeNull();
    const version = byTestId(tree, 'android-update-release-version');
    expect(text(version)).toBe(update.releaseVersion('1.0.16'));
    expect(flatStyle(version.props.style).color).toBe(colors.textPrimary);
    expect(text(byTestId(tree, 'android-update-available-meta'))).toBe(update.availableMeta(
      formatAndroidUpdateBytes(release.apkSize, locale),
      formatAndroidReleaseDate(release.publishedAt, locale),
    ));
    // Nothing will be installed, so the pre-install safety caption goes.
    expect(textContent(tree)).not.toContain(update.safety);
    expect(textContent(byTestId(tree, 'android-update-error'))).toContain(update.errors.installIncompatible);
    expect(text(byTestId(tree, 'android-update-final-hint'))).toBe(update.finalFailureHint.device);
    expect(byTestId(tree, 'android-update-release-link').props.url).toBe(release.releaseUrl);
    expect(byTestId(tree, 'android-update-release-link').props.label).toBe(update.viewRelease);
    expect(queryByTestId(tree, 'android-update-retry')).toBeNull();
    expect(queryByTestId(tree, 'android-update-install')).toBeNull();
  });

  it('keeps the changelog link for a retryable install failure', () => {
    const tree = render(snapshot({
      ...done(availableResult),
      install: { kind: 'failed', release, failure: { code: 'network', message: 'offline', httpStatus: null } },
    }));
    expect(byTestId(tree, 'android-update-release-link').props.label).toBe(update.releaseLink);
  });

  it('localizes a final failure that names the installed build', () => {
    const failure = {
      code: 'updater-apk-not-newer',
      message: 'APK versionCode 10079 is not newer than 10090',
      httpStatus: null,
    };
    const tree = render(snapshot({
      ...done(availableResult),
      install: { kind: 'failed', release, failure },
    }));
    expect(textContent(byTestId(tree, 'android-update-error')))
      .toContain(update.errors.apkNotNewer('1.0.16', 10090));
  });
});
