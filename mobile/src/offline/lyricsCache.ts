import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeezerId, LyricsResponse } from '../api/types';

export const OFFLINE_LYRICS_PREFIX = 'lr.offline-lyrics.v1:';
const MAX_CACHED_LYRICS_TRACKS = 500;

export interface OfflineLyricsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface StoredLyricsMap {
  version: 1;
  entries: Record<string, { savedAt: number; response: LyricsResponse }>;
}

function normalizedScope(accountScope: string): string {
  const normalized = accountScope.trim();
  if (normalized.length === 0) {
    throw new Error('Offline lyrics storage scope must not be empty');
  }
  return normalized;
}

export function offlineLyricsStorageKey(accountScope: string): string {
  return `${OFFLINE_LYRICS_PREFIX}${encodeURIComponent(normalizedScope(accountScope))}`;
}

async function readStore(
  storage: OfflineLyricsStorage,
  accountScope: string,
): Promise<StoredLyricsMap> {
  const key = offlineLyricsStorageKey(accountScope);
  const raw = await storage.getItem(key);
  if (raw === null || raw.length === 0) {
    return { version: 1, entries: {} };
  }
  let parsed: Partial<StoredLyricsMap>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredLyricsMap>;
  } catch (error) {
    throw new Error(`Offline lyrics store ${key} is not valid JSON: ${(error as Error).message}`);
  }
  if (
    parsed.version !== 1
    || typeof parsed.entries !== 'object'
    || parsed.entries === null
    || Array.isArray(parsed.entries)
  ) {
    throw new Error(`Offline lyrics store ${key} has invalid schema version ${String(parsed.version)}`);
  }
  return { version: 1, entries: parsed.entries };
}

const pendingWrites = new Map<string, Promise<void>>();

async function writeOfflineLyricsEntry(
  scope: string,
  id: string,
  response: LyricsResponse,
  storage: OfflineLyricsStorage,
): Promise<void> {
  const store = await readStore(storage, scope);
  store.entries[id] = {
    savedAt: Date.now(),
    response: { ...response, cached: true },
  };
  const keys = Object.keys(store.entries);
  if (keys.length > MAX_CACHED_LYRICS_TRACKS) {
    const oldest = keys
      .sort((a, b) => (store.entries[a]?.savedAt ?? 0) - (store.entries[b]?.savedAt ?? 0))
      .slice(0, keys.length - MAX_CACHED_LYRICS_TRACKS);
    for (const key of oldest) delete store.entries[key];
  }
  await storage.setItem(offlineLyricsStorageKey(scope), JSON.stringify(store));
}

/** Serialize read-modify-write per account scope so concurrent saves never drop each other or race logout cleanup. */
export function saveOfflineLyrics(
  accountScope: string,
  trackId: DeezerId,
  response: LyricsResponse,
  storage: OfflineLyricsStorage = AsyncStorage,
): Promise<void> {
  const scope = normalizedScope(accountScope);
  const id = String(trackId).trim();
  if (id.length === 0 || response.lines === null) return Promise.resolve();
  const previous = pendingWrites.get(scope) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(() => writeOfflineLyricsEntry(scope, id, response, storage));
  pendingWrites.set(scope, task);
  void task.then(
    () => {
      if (pendingWrites.get(scope) === task) pendingWrites.delete(scope);
    },
    () => {
      if (pendingWrites.get(scope) === task) pendingWrites.delete(scope);
    },
  );
  return task;
}

export async function waitForOfflineLyricsWrites(accountScope: string | null): Promise<void> {
  if (accountScope === null) {
    await Promise.all([...pendingWrites.values()].map((write) => write.catch(() => undefined)));
    return;
  }
  await pendingWrites.get(normalizedScope(accountScope))?.catch(() => undefined);
}

export async function readOfflineLyrics(
  accountScope: string,
  trackId: DeezerId,
  storage: OfflineLyricsStorage = AsyncStorage,
): Promise<LyricsResponse | null> {
  const scope = normalizedScope(accountScope);
  const id = String(trackId).trim();
  if (id.length === 0) return null;
  await waitForOfflineLyricsWrites(scope);
  const store = await readStore(storage, scope);
  const hit = store.entries[id];
  return hit ? { ...hit.response, cached: true } : null;
}
