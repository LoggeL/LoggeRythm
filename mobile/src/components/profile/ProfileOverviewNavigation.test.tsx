import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateLocale } from '../../localization';
import { accountStrings } from '../../screens/accountStrings';
import { byTestId, elements, queryByTestId, textContent } from '../../test/render';
import type { AndroidUpdateSnapshot } from '../../update/androidUpdateStore';
import {
  profileAccountAppAttention,
  ProfileQuickActions,
  ProfileSettingsMenuView,
} from './ProfileOverviewNavigation';

const mocks = vi.hoisted(() => ({
  tvEnv: {
    isTv: false,
    minFocusTargetHeight: 48,
  },
  triggerHaptic: vi.fn(),
}));

vi.mock('react-native', () => ({
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

vi.mock('../../hooks/useHaptics', () => ({
  triggerHaptic: mocks.triggerHaptic,
}));

vi.mock('../../tv', () => ({
  TvFocusable: 'TvFocusable',
  useTvEnvironment: () => mocks.tvEnv,
}));

vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

const installed = { versionName: '1.0.32', versionCode: 10032 };
const release = {
  versionName: '1.0.33',
  versionCode: 10033,
  tagName: 'v1.0.33',
  releaseName: 'LoggeRythm 1.0.33',
  releaseUrl: 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.0.33',
  publishedAt: '2026-11-26T12:00:00Z',
  apkName: 'LoggeRythm-v1.0.33.apk',
  apkUrl: 'https://github.com/LoggeL/LoggeRythm/releases/download/v1.0.33/LoggeRythm-v1.0.33.apk',
  apkDigest: `sha256:${'a'.repeat(64)}`,
  apkSize: 28_000_000,
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

describe('ProfileOverviewNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activateLocale('de');
    mocks.tvEnv = { isTv: false, minFocusTargetHeight: 48 };
  });

  afterEach(() => {
    activateLocale('de');
  });

  it('wires all four quick actions with TV focus keys and localized DE/EN labels', () => {
    const callbacks = {
      onOpenInsights: vi.fn(),
      onOpenSleepTimer: vi.fn(),
      onOpenAudioEffects: vi.fn(),
      onOpenDevices: vi.fn(),
    };

    const deTree = ProfileQuickActions(callbacks);
    expect(textContent(deTree)).toEqual([
      'Schnellzugriff',
      'Hör-Insights',
      'Sleep-Timer',
      'Klang & Effekte',
      'Geräte',
    ]);

    (byTestId(deTree, 'profile-open-insights').props.onPress as () => void)();
    (byTestId(deTree, 'profile-quick-sleep-timer').props.onPress as () => void)();
    (byTestId(deTree, 'profile-quick-audio-effects').props.onPress as () => void)();
    (byTestId(deTree, 'profile-quick-devices').props.onPress as () => void)();

    expect(callbacks.onOpenInsights).toHaveBeenCalledOnce();
    expect(callbacks.onOpenSleepTimer).toHaveBeenCalledOnce();
    expect(callbacks.onOpenAudioEffects).toHaveBeenCalledOnce();
    expect(callbacks.onOpenDevices).toHaveBeenCalledOnce();
    expect(mocks.triggerHaptic).toHaveBeenCalledTimes(4);

    expect(byTestId(deTree, 'profile-open-insights').props.focusKey).toBe('profile-open-insights');
    expect(byTestId(deTree, 'profile-quick-sleep-timer').props.focusKey).toBe('profile-quick-sleep-timer');
    expect(byTestId(deTree, 'profile-quick-audio-effects').props.focusKey).toBe('profile-quick-audio-effects');
    expect(byTestId(deTree, 'profile-quick-devices').props.focusKey).toBe('profile-quick-devices');

    activateLocale('en');
    const enTree = ProfileQuickActions(callbacks);
    expect(textContent(enTree)).toEqual([
      'Quick access',
      'Insights',
      'Sleep timer',
      'Audio & effects',
      'Devices',
    ]);
  });

  it('renders the three thematic settings rows with unique summaries and localized DE/EN copy', () => {
    const callbacks = {
      onOpenPlaybackSettings: vi.fn(),
      onOpenDevicesStorageSettings: vi.fn(),
      onOpenAccountAppSettings: vi.fn(),
    };

    for (const locale of ['de', 'en'] as const) {
      activateLocale(locale);
      const tree = ProfileSettingsMenuView({ ...callbacks, accountAppAttention: 'none' });
      const copy = accountStrings.profile;

      expect(textContent(tree)).toEqual([
        copy.settingsSectionTitle,
        copy.settingsPlaybackTitle,
        copy.settingsPlaybackSummary,
        copy.settingsDevicesStorageTitle,
        copy.settingsDevicesStorageSummary,
        copy.settingsAccountAppTitle,
        copy.settingsAccountAppSummary,
      ]);
      expect(queryByTestId(tree, 'profile-account-app-update-dot')).toBeNull();
    }

    activateLocale('de');
    mocks.tvEnv = { isTv: true, minFocusTargetHeight: 54 };
    const tvTree = ProfileSettingsMenuView({ ...callbacks, accountAppAttention: 'update-available' });
    expect(byTestId(tvTree, 'profile-account-app-update-dot')).toBeDefined();
    expect(byTestId(tvTree, 'profile-nav-account-app').props.accessibilityLabel).toContain(
      accountStrings.profile.settingsAccountAppUpdateAvailable,
    );
    expect(byTestId(tvTree, 'profile-nav-playback').props.style).toEqual([
      expect.any(Object),
      { minHeight: 54 },
    ]);

    const focusKeys = elements(tvTree)
      .filter((el) => el.type === 'TvFocusable')
      .map((el) => el.props.focusKey);
    expect(focusKeys).toEqual([
      'profile-nav-playback',
      'profile-nav-devices-storage',
      'profile-nav-account-app',
    ]);

    (byTestId(tvTree, 'profile-nav-playback').props.onPress as () => void)();
    (byTestId(tvTree, 'profile-nav-devices-storage').props.onPress as () => void)();
    (byTestId(tvTree, 'profile-nav-account-app').props.onPress as () => void)();
    expect(callbacks.onOpenPlaybackSettings).toHaveBeenCalledOnce();
    expect(callbacks.onOpenDevicesStorageSettings).toHaveBeenCalledOnce();
    expect(callbacks.onOpenAccountAppSettings).toHaveBeenCalledOnce();
  });

  it('derives Account & App attention for updates, check errors, and startup notes', () => {
    const failure = { code: 'network', message: 'offline', httpStatus: null };
    expect(profileAccountAppAttention(snapshot({ supported: false }))).toBe('none');
    expect(profileAccountAppAttention(snapshot())).toBe('none');
    expect(profileAccountAppAttention(snapshot({
      check: { kind: 'done', result: { kind: 'available', installed, release }, checkedAt: 1 },
    }))).toBe('update-available');
    expect(profileAccountAppAttention(snapshot({
      check: { kind: 'failed', failure, checkedAt: 1, previous: null, previousCheckedAt: null },
    }))).toBe('notice');
    expect(profileAccountAppAttention(snapshot({
      startupNotes: [{ phase: 'pending-install', failure }],
    }))).toBe('notice');
    expect(profileAccountAppAttention(snapshot({
      orphanedInstallFailure: { phase: 'install-outcome', failure },
    }))).toBe('notice');
  });
});
