import { useSyncExternalStore } from 'react';
import { strings } from '../localization';

export const WIFI_ONLY_STORAGE_KEY = 'lr.offline-wifi-only.v1';

export class WifiOnlyDownloadError extends Error {
  readonly code = 'wifi-required';

  constructor(message = strings.profile.wifiRequiredError) {
    super(message);
    this.name = 'WifiOnlyDownloadError';
  }
}

export interface WifiOnlyStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

async function defaultStorage(): Promise<WifiOnlyStorage> {
  const mod = await import('@react-native-async-storage/async-storage');
  return mod.default;
}

async function defaultFetchNetState(): Promise<{ type: string; isConnected?: boolean | null }> {
  const mod = await import('@react-native-community/netinfo');
  return mod.default.fetch();
}

let wifiOnlyEnabled = false;
let hydrated = false;
const listeners = new Set<() => void>();

function publish(): void {
  listeners.forEach((listener) => listener());
}

export function getWifiOnlyDownloadsSnapshot(): boolean {
  return wifiOnlyEnabled;
}

export function subscribeWifiOnlyDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWifiOnlyDownloads(): boolean {
  return useSyncExternalStore(
    subscribeWifiOnlyDownloads,
    getWifiOnlyDownloadsSnapshot,
    getWifiOnlyDownloadsSnapshot,
  );
}

async function syncNativeWifiOnly(enabled: boolean): Promise<void> {
  let rnModule: typeof import('react-native') | null = null;
  try {
    rnModule = await import('react-native');
  } catch (error) {
    if (process.env.VITEST === 'true') return;
    throw new Error(
      `Failed to load react-native for Wi-Fi-only native sync: ${(error as Error).message}`,
    );
  }
  const nativeMod = (
    rnModule.NativeModules as {
      OfflineDownloads?: { setWifiOnly?: (flag: boolean) => Promise<unknown> };
    } | undefined
  )?.OfflineDownloads;
  if (typeof nativeMod?.setWifiOnly === 'function') {
    await nativeMod.setWifiOnly(enabled);
  }
}

export async function hydrateWifiOnlyDownloads(
  storage?: WifiOnlyStorage,
): Promise<boolean> {
  const resolved = storage ?? await defaultStorage();
  const raw = await resolved.getItem(WIFI_ONLY_STORAGE_KEY);
  if (raw !== null && raw !== 'true' && raw !== 'false') {
    throw new Error(`Invalid persisted Wi-Fi-only setting in ${WIFI_ONLY_STORAGE_KEY}: ${raw}`);
  }
  wifiOnlyEnabled = raw === 'true';
  hydrated = true;
  await syncNativeWifiOnly(wifiOnlyEnabled);
  publish();
  return wifiOnlyEnabled;
}

export async function setWifiOnlyDownloads(
  enabled: boolean,
  storage?: WifiOnlyStorage,
): Promise<void> {
  const resolved = storage ?? await defaultStorage();
  await resolved.setItem(WIFI_ONLY_STORAGE_KEY, enabled ? 'true' : 'false');
  await syncNativeWifiOnly(enabled);
  wifiOnlyEnabled = enabled;
  hydrated = true;
  publish();
}

/**
 * Enforce Wi-Fi-only download preference before initiating audio downloads.
 * Fails loudly when the user enabled Wi-Fi-only and is not on Wi-Fi or Ethernet.
 */
export async function assertDownloadNetworkAllowed(
  options: {
    storage?: WifiOnlyStorage;
    fetchNetState?: () => Promise<{ type: string; isConnected?: boolean | null }>;
  } = {},
): Promise<void> {
  if (!hydrated) {
    await hydrateWifiOnlyDownloads(options.storage);
  }
  if (!wifiOnlyEnabled) return;
  const fetchState = options.fetchNetState ?? defaultFetchNetState;
  const state = await fetchState();
  if (state.type !== 'wifi' && state.type !== 'ethernet') {
    throw new WifiOnlyDownloadError(strings.profile.wifiRequiredError);
  }
}

/** Test-only reset for isolated unit tests. */
export function resetWifiOnlyDownloadsForTests(): void {
  wifiOnlyEnabled = false;
  hydrated = false;
  publish();
}
