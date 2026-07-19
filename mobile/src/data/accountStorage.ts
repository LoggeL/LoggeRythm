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

const RECENT_SEARCH_PREFIX = 'lr.recent-searches.v1:';

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
