import type { QueryClient } from '@tanstack/react-query';

export const QUERY_CACHE_VERSION = 1 as const;
export const QUERY_CACHE_PREFIX = `lr.query-cache.v${QUERY_CACHE_VERSION}:`;
export const MAX_PERSISTED_QUERY_CACHE_CHARS = 512_000;
const PERSIST_DEBOUNCE_MS = 1_200;

export interface QueryCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PersistedQueryEntry {
  queryKey: readonly unknown[];
  data: unknown;
  dataUpdatedAt: number;
}

export interface PersistedQuerySnapshot {
  version: typeof QUERY_CACHE_VERSION;
  scope: string;
  entries: PersistedQueryEntry[];
}

const pendingWrites = new Map<string, Promise<void>>();
const pendingTimers = new Map<string, Set<() => void>>();

function registerPendingTimer(scope: string, cancel: () => void): () => void {
  let set = pendingTimers.get(scope);
  if (set === undefined) {
    set = new Set();
    pendingTimers.set(scope, set);
  }
  set.add(cancel);
  return () => {
    set.delete(cancel);
    if (set.size === 0) pendingTimers.delete(scope);
  };
}

function cancelPendingTimers(accountScope: string | null): void {
  if (accountScope === null) {
    for (const set of [...pendingTimers.values()]) {
      for (const cancel of [...set]) cancel();
    }
    pendingTimers.clear();
    return;
  }
  const scope = normalizedScope(accountScope);
  const set = pendingTimers.get(scope);
  if (set === undefined) return;
  for (const cancel of [...set]) cancel();
  pendingTimers.delete(scope);
}

function normalizedScope(accountScope: string): string {
  const normalized = accountScope.trim();
  if (normalized.length === 0) {
    throw new Error('Query cache storage scope must not be empty');
  }
  return normalized;
}

export function queryCacheStorageKey(accountScope: string): string {
  return `${QUERY_CACHE_PREFIX}${encodeURIComponent(normalizedScope(accountScope))}`;
}

/**
 * Only persist account-scoped Library/Home/Profile/Playlist read queries that
 * make cold offline startup instant without leaking another account's data.
 */
export function isPersistableQueryKey(
  queryKey: readonly unknown[],
  accountScope: string,
): boolean {
  if (queryKey[0] !== 'music') return false;
  const domain = queryKey[1];
  if (domain === 'library' && queryKey[2] === accountScope) return true;
  if (domain === 'follows' && queryKey[2] === accountScope) return true;
  if (domain === 'playlists' && queryKey[2] === 'scope' && queryKey[3] === accountScope) {
    // Exclude volatile invitation lists and invite-candidate searches.
    const sub = queryKey[4];
    return sub === 'owned' || sub === 'public' || (sub === 'detail' && queryKey.length === 6);
  }
  if (domain === 'home' && queryKey[2] === 'scope' && queryKey[3] === accountScope) return true;
  if (domain === 'profile' && queryKey[2] === 'private' && queryKey[3] === accountScope) return true;
  return false;
}

async function writeAccountQueryCache(
  client: QueryClient,
  storage: QueryCacheStorage,
  scope: string,
): Promise<void> {
  const queries = client.getQueryCache().getAll();
  const entries: PersistedQueryEntry[] = [];
  for (const query of queries) {
    if (query.state.status !== 'success' || query.state.data === undefined) continue;
    if (!isPersistableQueryKey(query.queryKey, scope)) continue;
    entries.push({
      queryKey: query.queryKey,
      data: query.state.data,
      dataUpdatedAt: query.state.dataUpdatedAt,
    });
  }
  entries.sort((a, b) => b.dataUpdatedAt - a.dataUpdatedAt);
  const key = queryCacheStorageKey(scope);
  if (entries.length === 0) {
    await storage.removeItem(key);
    return;
  }
  let payload: PersistedQuerySnapshot = {
    version: QUERY_CACHE_VERSION,
    scope,
    entries,
  };
  let serialized = JSON.stringify(payload);
  while (serialized.length > MAX_PERSISTED_QUERY_CACHE_CHARS && payload.entries.length > 1) {
    payload = { ...payload, entries: payload.entries.slice(0, payload.entries.length - 1) };
    serialized = JSON.stringify(payload);
  }
  if (serialized.length > MAX_PERSISTED_QUERY_CACHE_CHARS) return;
  await storage.setItem(key, serialized);
}

/** Serialize per-scope writes so an older slow snapshot cannot overwrite a newer one or survive logout cleanup. */
export function persistAccountQueryCache(
  client: QueryClient,
  storage: QueryCacheStorage,
  accountScope: string,
): Promise<void> {
  const scope = normalizedScope(accountScope);
  const previous = pendingWrites.get(scope) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => writeAccountQueryCache(client, storage, scope));
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

/** Cancel queued debounced writes and wait for all in-flight query cache writes to settle. */
export async function waitForQueryCacheWrites(accountScope: string | null): Promise<void> {
  cancelPendingTimers(accountScope);
  if (accountScope === null) {
    await Promise.all([...pendingWrites.values()].map((write) => write.catch(() => undefined)));
    return;
  }
  await pendingWrites.get(normalizedScope(accountScope))?.catch(() => undefined);
}

export async function readAccountQueryCacheSnapshot(
  storage: QueryCacheStorage,
  accountScope: string,
): Promise<PersistedQuerySnapshot | null> {
  const scope = normalizedScope(accountScope);
  await waitForQueryCacheWrites(scope);
  const key = queryCacheStorageKey(scope);
  const raw = await storage.getItem(key);
  if (raw === null || raw.length === 0 || raw.length > MAX_PERSISTED_QUERY_CACHE_CHARS) {
    return null;
  }
  let parsed: Partial<PersistedQuerySnapshot>;
  try {
    parsed = JSON.parse(raw) as Partial<PersistedQuerySnapshot>;
  } catch (error) {
    await storage.removeItem(key);
    throw new Error(`Persisted query cache ${key} is not valid JSON: ${(error as Error).message}`);
  }
  if (
    parsed.version !== QUERY_CACHE_VERSION
    || parsed.scope !== scope
    || !Array.isArray(parsed.entries)
  ) {
    await storage.removeItem(key);
    throw new Error(
      `Persisted query cache ${key} has incompatible schema (version=${String(parsed.version)}, scope=${String(parsed.scope)})`,
    );
  }
  return {
    version: QUERY_CACHE_VERSION,
    scope,
    entries: parsed.entries,
  };
}

export function applyAccountQueryCacheSnapshot(
  client: QueryClient,
  accountScope: string,
  snapshot: PersistedQuerySnapshot | null,
): number {
  if (snapshot === null) return 0;
  const scope = normalizedScope(accountScope);
  if (snapshot.scope !== scope) return 0;
  let hydratedCount = 0;
  for (const entry of snapshot.entries) {
    if (
      entry === null
      || typeof entry !== 'object'
      || !Array.isArray(entry.queryKey)
      || !isPersistableQueryKey(entry.queryKey, scope)
      || entry.data === undefined
    ) {
      continue;
    }
    if (client.getQueryData(entry.queryKey) !== undefined) continue;
    client.setQueryData(entry.queryKey, entry.data, {
      updatedAt:
        typeof entry.dataUpdatedAt === 'number' && Number.isFinite(entry.dataUpdatedAt)
          ? entry.dataUpdatedAt
          : Date.now(),
    });
    hydratedCount += 1;
  }
  return hydratedCount;
}

export async function hydrateAccountQueryCache(
  client: QueryClient,
  storage: QueryCacheStorage,
  accountScope: string,
): Promise<number> {
  const snapshot = await readAccountQueryCacheSnapshot(storage, accountScope);
  return applyAccountQueryCacheSnapshot(client, accountScope, snapshot);
}

/**
 * Subscribe to query cache updates for one authenticated account scope and
 * write debounced snapshots to AsyncStorage. Unsubscribing cancels pending timers.
 */
export function attachAccountQueryPersistence(
  client: QueryClient,
  storage: QueryCacheStorage,
  accountScope: string,
): () => void {
  const scope = normalizedScope(accountScope);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = true;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const unregisterTimer = registerPendingTimer(scope, cancelTimer);

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (!active) return;
    if (event.type !== 'updated' || event.query.state.status !== 'success') return;
    if (!isPersistableQueryKey(event.query.queryKey, scope)) return;
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!active) return;
      void persistAccountQueryCache(client, storage, scope).catch((error: unknown) => {
        console.error('[LoggeRythm] Failed to persist query cache:', error);
      });
    }, PERSIST_DEBOUNCE_MS);
  });

  return () => {
    active = false;
    cancelTimer();
    unregisterTimer();
    unsubscribe();
  };
}
