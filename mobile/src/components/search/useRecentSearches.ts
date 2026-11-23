import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recentSearchStorageKey } from '../../data/accountStorage';
import {
  isSearchableQuery,
  normalizeSearchInput,
} from '../../screens/searchModel';

export const RECENT_SEARCHES_LIMIT = 8;
export const RECENT_SEARCH_STORAGE_PREFIX = 'lr.recent-searches.v1:';

export interface RecentSearchesStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

export interface RecentSearchesError {
  readonly kind: 'load' | 'save';
  readonly detail: string;
}

const pendingWrites = new Map<string, Promise<void>>();
const clearListeners = new Set<(accountScope: string | null) => void>();

function formatStorageErrorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return String(error);
}

/** Add a searchable query to the front of recent searches, deduplicated case-insensitively. */
export function rememberRecentSearch(
  recent: readonly string[],
  input: string,
): string[] {
  const term = normalizeSearchInput(input);
  if (!isSearchableQuery(term)) return [...recent];
  const lowered = term.toLocaleLowerCase();
  return [
    term,
    ...recent.filter((entry) => normalizeSearchInput(entry).toLocaleLowerCase() !== lowered),
  ].slice(0, RECENT_SEARCHES_LIMIT);
}

/** Remove one query from the recent-search list. */
export function removeRecentSearch(
  recent: readonly string[],
  query: string,
): string[] {
  const lowered = normalizeSearchInput(query).toLocaleLowerCase();
  return recent.filter((entry) => normalizeSearchInput(entry).toLocaleLowerCase() !== lowered);
}

/**
 * Strictly decode persisted recent searches. Corrupt JSON or invalid entries
 * fail loud instead of silently falling back to an empty list.
 */
export function decodeRecentSearches(raw: string | null): string[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error('Saved recent searches are not valid JSON', { cause });
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== 'string' || normalizeSearchInput(entry).length === 0)
  ) {
    throw new Error('Saved recent searches must be a list of non-empty search terms');
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of parsed as string[]) {
    const term = normalizeSearchInput(entry);
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(term);
    if (normalized.length >= RECENT_SEARCHES_LIMIT) break;
  }
  return normalized;
}

function enqueueWrite<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  pendingWrites.set(key, tail);
  void tail.then(() => {
    if (pendingWrites.get(key) === tail) pendingWrites.delete(key);
  });
  return result;
}

/** Let logout / session invalidation drain in-flight writes before deleting keys. */
export async function waitForRecentSearchWrites(
  accountScope: string | null = null,
): Promise<void> {
  if (accountScope === null) {
    await Promise.all([...pendingWrites.values()]);
    return;
  }
  await pendingWrites.get(recentSearchStorageKey(accountScope));
}

export async function readRecentSearches(
  storage: Pick<RecentSearchesStorage, 'getItem'>,
  accountScope: string,
): Promise<string[]> {
  const key = recentSearchStorageKey(accountScope);
  await pendingWrites.get(key);
  const raw = await storage.getItem(key);
  return decodeRecentSearches(raw);
}

export async function persistRecentSearches(
  storage: Pick<RecentSearchesStorage, 'setItem' | 'removeItem'>,
  accountScope: string,
  terms: readonly string[],
): Promise<string[]> {
  const key = recentSearchStorageKey(accountScope);
  const cleaned = terms
    .map((entry) => normalizeSearchInput(entry))
    .filter((entry) => entry.length > 0)
    .slice(0, RECENT_SEARCHES_LIMIT);
  return enqueueWrite(key, async () => {
    if (cleaned.length === 0) {
      await storage.removeItem(key);
    } else {
      await storage.setItem(key, JSON.stringify(cleaned));
    }
    return cleaned;
  });
}

/**
 * Erase recent-search storage for one account scope, or for every account
 * when `accountScope` is `null` (used on authoritative logout / 401 cleanup).
 */
export async function clearAllRecentSearchesStorage(
  storage: Pick<RecentSearchesStorage, 'getAllKeys' | 'removeItem'> = AsyncStorage,
  accountScope: string | null = null,
): Promise<void> {
  await waitForRecentSearchWrites(accountScope);
  const keys =
    accountScope === null
      ? (await storage.getAllKeys()).filter((key) =>
          key.startsWith(RECENT_SEARCH_STORAGE_PREFIX),
        )
      : [recentSearchStorageKey(accountScope)];
  await Promise.all(keys.map((key) => storage.removeItem(key)));
  clearListeners.forEach((listener) => listener(accountScope));
}

export interface RecentSearchesState {
  readonly recent: readonly string[];
  readonly loading: boolean;
  readonly error: RecentSearchesError | null;
  readonly remember: (query: string) => void;
  readonly remove: (query: string) => void;
  readonly clear: () => void;
  readonly retry: () => void;
}

interface ScopedRecentState {
  readonly scope: string;
  readonly items: string[];
  readonly error: RecentSearchesError | null;
}

/**
 * Account-scoped recent searches persisted in AsyncStorage under
 * `recentSearchStorageKey(accountScope)`. Storage failures are reported loudly
 * and never downgraded into an empty history.
 */
export function useRecentSearches(
  accountScope: string,
  storage: RecentSearchesStorage = AsyncStorage,
): RecentSearchesState {
  const [scopedState, setScopedState] = useState<ScopedRecentState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const recentRef = useRef<string[]>([]);
  const activeScopeRef = useRef(accountScope);

  useEffect(() => {
    activeScopeRef.current = accountScope;
    recentRef.current = [];
  }, [accountScope]);

  useEffect(() => {
    const onClear = (clearedScope: string | null) => {
      if (clearedScope === null || clearedScope === accountScope) {
        recentRef.current = [];
        setScopedState({ scope: accountScope, items: [], error: null });
      }
    };
    clearListeners.add(onClear);
    return () => {
      clearListeners.delete(onClear);
    };
  }, [accountScope]);

  useEffect(() => {
    let active = true;
    void readRecentSearches(storage, accountScope)
      .then((terms) => {
        if (!active) return;
        recentRef.current = terms;
        setScopedState({ scope: accountScope, items: terms, error: null });
      })
      .catch((failure: unknown) => {
        if (!active) return;
        console.error('Failed to load recent searches', failure);
        recentRef.current = [];
        setScopedState({
          scope: accountScope,
          items: [],
          error: { kind: 'load', detail: formatStorageErrorDetail(failure) },
        });
      });
    return () => {
      active = false;
    };
  }, [accountScope, reloadToken, storage]);

  const commit = useCallback(
    (next: string[]) => {
      recentRef.current = next;
      setScopedState({ scope: accountScope, items: next, error: null });
      void persistRecentSearches(storage, accountScope, next).catch((failure: unknown) => {
        console.error('Failed to persist recent searches', failure);
        if (activeScopeRef.current !== accountScope) return;
        setScopedState((current) => ({
          scope: accountScope,
          items: current?.scope === accountScope ? current.items : next,
          error: { kind: 'save', detail: formatStorageErrorDetail(failure) },
        }));
      });
    },
    [accountScope, storage],
  );

  const remember = useCallback(
    (query: string) => {
      const term = normalizeSearchInput(query);
      if (!isSearchableQuery(term)) return;
      commit(rememberRecentSearch(recentRef.current, term));
    },
    [commit],
  );

  const remove = useCallback(
    (query: string) => {
      commit(removeRecentSearch(recentRef.current, query));
    },
    [commit],
  );

  const clear = useCallback(() => {
    commit([]);
  }, [commit]);

  const retry = useCallback(() => {
    setScopedState(null);
    setReloadToken((value) => value + 1);
  }, []);

  const currentForScope = scopedState?.scope === accountScope ? scopedState : null;

  return {
    recent: currentForScope?.items ?? [],
    loading: currentForScope === null,
    error: currentForScope?.error ?? null,
    remember,
    remove,
    clear,
    retry,
  };
}
