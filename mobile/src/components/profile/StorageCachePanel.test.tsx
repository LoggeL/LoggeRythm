import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { byTestId } from '../../test/render';
import StorageCachePanel, { formatStorageBytes } from './StorageCachePanel';

const mocks = vi.hoisted(() => ({
  wifiOnly: false,
  clearCache: vi.fn(async () => undefined),
  setWifiOnly: vi.fn(async () => undefined),
  hydrateWifiOnly: vi.fn(async () => false),
  announce: vi.fn(),
  stateSetters: [] as ReturnType<typeof vi.fn>[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  let idx = 0;
  return {
    ...actual,
    default: actual,
    useEffect: vi.fn(),
    useState: (initial: unknown) => {
      const setter = vi.fn();
      mocks.stateSetters[idx++] = setter;
      return [initial, setter];
    },
  };
});
vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: mocks.announce },
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../../offline/hooks', () => ({
  useOfflineDownloads: () => ({
    scope: 'https://music.example.test::user:7',
    downloadedTrackIds: new Set(['1', '2', '3']),
    storageBytes: 15_728_640,
    availableDiskBytes: 2_147_483_648,
    progress: null,
  }),
}));
vi.mock('../../offline/native', () => ({
  cancelNativeOfflineDownload: vi.fn(async () => true),
  clearNativeRollingCache: vi.fn(async () => ({ bytesBefore: 0, bytesAfter: 0, resourcesRemoved: 0, verified: true })),
  getNativeOfflineStorageMetrics: vi.fn(async () => null),
  hasNativeOfflineExtension: () => false,
}));
vi.mock('../../offline/downloadSettings', () => ({
  hydrateWifiOnlyDownloads: mocks.hydrateWifiOnly,
  setWifiOnlyDownloads: mocks.setWifiOnly,
  useWifiOnlyDownloads: () => mocks.wifiOnly,
}));
vi.mock('../../player/player', () => ({
  default: { clearCache: mocks.clearCache },
}));

describe('StorageCachePanel', () => {
  beforeEach(() => {
    mocks.wifiOnly = false;
    mocks.stateSetters = [];
    vi.clearAllMocks();
  });

  it('formats byte counts clearly across units', () => {
    expect(formatStorageBytes(0)).toBe('0 B');
    expect(formatStorageBytes(512)).toBe('512 B');
    expect(formatStorageBytes(1024 * 1024 * 15)).toBe('15.0 MB');
    expect(formatStorageBytes(1024 * 1024 * 1024 * 2)).toBe('2.00 GB');
  });

  it('displays downloads footprint, toggles Wi-Fi-only, and clears stream cache', async () => {
    const tree = StorageCachePanel();
    expect(byTestId(tree, 'profile-storage-downloads-summary').props.children).toBe(
      strings.profile.storageDownloadsSummary(3, '15.0 MB'),
    );
    expect(byTestId(tree, 'profile-storage-free-space').props.children).toBe(
      strings.profile.storageFreeSpace('2.00 GB'),
    );

    const wifiSwitch = byTestId(tree, 'profile-storage-wifi-only');
    (wifiSwitch.props.onValueChange as (next: boolean) => void)(true);
    await vi.waitFor(() => expect(mocks.setWifiOnly).toHaveBeenCalledExactlyOnceWith(true));

    const clearBtn = byTestId(tree, 'profile-storage-clear-cache');
    (clearBtn.props.onPress as () => void)();
    await vi.waitFor(() => expect(mocks.clearCache).toHaveBeenCalledOnce());
    expect(mocks.announce).toHaveBeenCalledWith(strings.profile.streamCacheCleared);
  });
});
