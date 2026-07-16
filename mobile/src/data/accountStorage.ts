import {
  RELEASE_RADAR_SEEN_PREFIX,
  releaseRadarSeenStorageKey,
  waitForReleaseRadarSeenWrites,
} from './releaseRadar';
import {
  NAVIGATION_STATE_PREFIX,
  navigationStateStorageKey,
  waitForNavigationStateWrites,
} from '../navigationPersistence';

export interface AccountScopedStorage {
  getAllKeys(): Promise<readonly string[]>;
  removeItem(key: string): Promise<void>;
}

export interface RecentSearchStorage {
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const RECENT_SEARCH_PREFIX = 'lr.recent-searches.v1:';
const pendingRecentSearchWrites = new Map<string, Promise<void>>();

function normalizedAccountScope(accountScope: string): string {
  const normalized = accountScope.trim();
  if (normalized.length === 0) {
    throw new Error('Account storage scope must not be empty');
  }
  return normalized;
}

export function recentSearchStorageKey(accountScope: string): string {
  return `${RECENT_SEARCH_PREFIX}${encodeURIComponent(normalizedAccountScope(accountScope))}`;
}

export function accountScopedStorageKeys(accountScope: string): readonly string[] {
  return [
    recentSearchStorageKey(accountScope),
    releaseRadarSeenStorageKey(accountScope),
    navigationStateStorageKey(accountScope),
  ];
}

export async function persistRecentSearches(
  storage: RecentSearchStorage,
  accountScope: string,
  recent: readonly string[],
): Promise<void> {
  const key = recentSearchStorageKey(accountScope);
  const previous = pendingRecentSearchWrites.get(key) ?? Promise.resolve();
  const write = previous.then(async () => {
    if (recent.length === 0) {
      await storage.removeItem(key);
      return;
    }
    await storage.setItem(key, JSON.stringify(recent));
  });
  const tail = write.then(
    () => undefined,
    () => undefined,
  );
  pendingRecentSearchWrites.set(key, tail);
  void tail.then(() => {
    if (pendingRecentSearchWrites.get(key) === tail) pendingRecentSearchWrites.delete(key);
  });
  return write;
}

/** Let logout/account deletion drain all writes before deleting their key. */
export async function waitForRecentSearchWrites(accountScope: string | null): Promise<void> {
  if (accountScope === null) {
    await Promise.all([...pendingRecentSearchWrites.values()]);
    return;
  }
  await pendingRecentSearchWrites.get(recentSearchStorageKey(accountScope));
}

/**
 * Remove every non-query account-scoped value before another account can use
 * the process. Keep this registry explicit so new persisted feature state has
 * one auditable logout/deletion boundary.
 */
export async function clearAccountScopedStorage(
  storage: AccountScopedStorage,
  accountScope: string | null,
): Promise<void> {
  await Promise.all([
    waitForRecentSearchWrites(accountScope),
    waitForReleaseRadarSeenWrites(accountScope),
    waitForNavigationStateWrites(accountScope),
  ]);
  const keys = accountScope === null
    ? (await storage.getAllKeys()).filter(
        (key) =>
          key.startsWith(RECENT_SEARCH_PREFIX) ||
          key.startsWith(RELEASE_RADAR_SEEN_PREFIX) ||
          key.startsWith(NAVIGATION_STATE_PREFIX),
      )
    : accountScopedStorageKeys(accountScope);
  await Promise.all(keys.map((key) => storage.removeItem(key)));
}
