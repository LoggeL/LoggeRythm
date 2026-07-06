import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Base URL of the LoggeRythm FastAPI backend.
 *
 * Default targets the Android emulator, where `10.0.2.2` is the host machine's
 * loopback (i.e. the `uvicorn` server running on your PC at :8000). On a real
 * device this must be overridden with the PC's LAN or Tailscale address via the
 * login screen — the value is persisted in AsyncStorage under API_BASE_KEY.
 */
export const DEFAULT_API_BASE = 'http://10.0.2.2:8000';

const API_BASE_KEY = 'lr.apiBase';

let cachedBase: string | null = null;

export async function getApiBase(): Promise<string> {
  if (cachedBase !== null) return cachedBase;
  const stored = await AsyncStorage.getItem(API_BASE_KEY);
  cachedBase = stored ?? DEFAULT_API_BASE;
  return cachedBase;
}

export async function setApiBase(base: string): Promise<void> {
  const trimmed = base.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/.test(trimmed)) {
    throw new Error(`Invalid API base URL: "${base}". Must start with http:// or https://`);
  }
  cachedBase = trimmed;
  await AsyncStorage.setItem(API_BASE_KEY, trimmed);
}
