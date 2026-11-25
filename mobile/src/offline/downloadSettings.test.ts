import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertDownloadNetworkAllowed,
  getWifiOnlyDownloadsSnapshot,
  hydrateWifiOnlyDownloads,
  resetWifiOnlyDownloadsForTests,
  setWifiOnlyDownloads,
  WIFI_ONLY_STORAGE_KEY,
  WifiOnlyDownloadError,
} from './downloadSettings';

const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn<() => Promise<string | null>>(async () => null),
  setItem: vi.fn(async () => undefined),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorageMock,
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: { fetch: vi.fn() },
}));

describe('downloadSettings (Wi-Fi-only preference)', () => {
  beforeEach(() => {
    resetWifiOnlyDownloadsForTests();
    asyncStorageMock.getItem.mockReset();
    asyncStorageMock.getItem.mockResolvedValue(null);
  });

  it('persists and hydrates the Wi-Fi-only setting', async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => { store.set(key, value); },
    };

    expect(getWifiOnlyDownloadsSnapshot()).toBe(false);
    await setWifiOnlyDownloads(true, storage);
    expect(store.get(WIFI_ONLY_STORAGE_KEY)).toBe('true');
    expect(getWifiOnlyDownloadsSnapshot()).toBe(true);

    resetWifiOnlyDownloadsForTests();
    await expect(hydrateWifiOnlyDownloads(storage)).resolves.toBe(true);
    expect(getWifiOnlyDownloadsSnapshot()).toBe(true);
  });

  it('allows cellular downloads when disabled and fails loudly on cellular when enabled', async () => {
    const storage = { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) };
    const fetchCellular = vi.fn(async () => ({ type: 'cellular', isConnected: true }));
    const fetchWifi = vi.fn(async () => ({ type: 'wifi', isConnected: true }));

    await expect(
      assertDownloadNetworkAllowed({ fetchNetState: fetchCellular }),
    ).resolves.toBeUndefined();
    expect(fetchCellular).not.toHaveBeenCalled();

    await setWifiOnlyDownloads(true, storage);
    await expect(
      assertDownloadNetworkAllowed({ fetchNetState: fetchCellular }),
    ).rejects.toBeInstanceOf(WifiOnlyDownloadError);

    await expect(
      assertDownloadNetworkAllowed({ fetchNetState: fetchWifi }),
    ).resolves.toBeUndefined();
  });

  it('hydrates from default storage when called cold before explicit hydration and rejects cellular', async () => {
    asyncStorageMock.getItem.mockResolvedValueOnce('true');
    const fetchCellular = vi.fn(async () => ({ type: 'cellular', isConnected: true }));

    await expect(
      assertDownloadNetworkAllowed({ fetchNetState: fetchCellular }),
    ).rejects.toBeInstanceOf(WifiOnlyDownloadError);
    expect(asyncStorageMock.getItem).toHaveBeenCalledWith(WIFI_ONLY_STORAGE_KEY);
  });
});
