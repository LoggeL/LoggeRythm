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
let baseLoad: Promise<string> | null = null;

export function normalizeApiBase(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new Error(`Invalid API base URL "${base}": ${(error as Error).message}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid API base URL "${base}": protocol must be http:// or https://`);
  }
  if (!parsed.hostname) {
    throw new Error(`Invalid API base URL "${base}": hostname is missing`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Invalid API base URL "${base}": embedded credentials are not allowed`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`Invalid API base URL "${base}": query strings and fragments are not allowed`);
  }
  return trimmed;
}

export async function getApiBase(): Promise<string> {
  if (cachedBase !== null) return cachedBase;
  if (baseLoad === null) {
    baseLoad = (async () => {
      const stored = await AsyncStorage.getItem(API_BASE_KEY);
      const resolved = normalizeApiBase(stored ?? DEFAULT_API_BASE);
      cachedBase = resolved;
      return resolved;
    })();
  }
  try {
    return await baseLoad;
  } finally {
    baseLoad = null;
  }
}

export async function setApiBase(base: string): Promise<void> {
  const normalized = normalizeApiBase(base);
  await AsyncStorage.setItem(API_BASE_KEY, normalized);
  cachedBase = normalized;
}
