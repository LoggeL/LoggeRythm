import { describe, expect, it, vi } from 'vitest';
import { recentSearchStorageKey } from '../../data/accountStorage';
import { musicCacheScope } from '../../data/queryClient';
import {
  clearAllRecentSearchesStorage,
  decodeRecentSearches,
  persistRecentSearches,
  readRecentSearches,
  RECENT_SEARCHES_LIMIT,
  rememberRecentSearch,
  removeRecentSearch,
  type RecentSearchesStorage,
} from './useRecentSearches';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    getAllKeys: vi.fn(async () => []),
  },
}));

function memoryStorage(initial: Record<string, string> = {}): RecentSearchesStorage & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  };
}

describe('recent searches model & strict storage', () => {
  it('remembers normalized searchable queries, deduplicates case-insensitively, and caps at 8', () => {
    let items: string[] = [];
    items = rememberRecentSearch(items, ' a ');
    expect(items).toEqual([]);

    items = rememberRecentSearch(items, '  Daft   Punk ');
    items = rememberRecentSearch(items, 'Kraftwerk');
    items = rememberRecentSearch(items, 'daft punk');
    expect(items).toEqual(['daft punk', 'Kraftwerk']);

    for (let index = 0; index < 12; index += 1) {
      items = rememberRecentSearch(items, `Query ${index}`);
    }
    expect(items).toHaveLength(RECENT_SEARCHES_LIMIT);
    expect(items[0]).toBe('Query 11');

    expect(removeRecentSearch(items, 'query 11')).not.toContain('Query 11');
  });

  it('fails loud on corrupt JSON or invalid persisted entries instead of silently returning empty', () => {
    expect(decodeRecentSearches(null)).toEqual([]);
    expect(decodeRecentSearches(JSON.stringify(['Daft Punk', 'daft punk', 'Air']))).toEqual([
      'Daft Punk',
      'Air',
    ]);
    expect(() => decodeRecentSearches('{not-json')).toThrow('not valid JSON');
    expect(() => decodeRecentSearches(JSON.stringify({ q: 'bad' }))).toThrow(
      'list of non-empty search terms',
    );
    expect(() => decodeRecentSearches(JSON.stringify(['ok', '   ']))).toThrow(
      'list of non-empty search terms',
    );
    expect(() => decodeRecentSearches(JSON.stringify([123]))).toThrow(
      'list of non-empty search terms',
    );
  });

  it('isolates recent searches per musicCacheScope(origin, user.id) and wipes cleanly on cleanup', async () => {
    const scopeA = musicCacheScope('https://music.example', 1);
    const scopeB = musicCacheScope('https://music.example', 2);
    const scopeOtherOrigin = musicCacheScope('https://other.example', 1);
    const storage = memoryStorage({ 'unrelated-pref': 'keep' });

    await persistRecentSearches(storage, scopeA, ['Daft Punk', 'Justice']);
    await persistRecentSearches(storage, scopeB, ['Miles Davis']);
    await persistRecentSearches(storage, scopeOtherOrigin, ['Radiohead']);

    expect(await readRecentSearches(storage, scopeA)).toEqual(['Daft Punk', 'Justice']);
    expect(await readRecentSearches(storage, scopeB)).toEqual(['Miles Davis']);
    expect(await readRecentSearches(storage, scopeOtherOrigin)).toEqual(['Radiohead']);

    // Clearing a single scope leaves other scopes untouched.
    await clearAllRecentSearchesStorage(storage, scopeA);
    expect(await readRecentSearches(storage, scopeA)).toEqual([]);
    expect(await readRecentSearches(storage, scopeB)).toEqual(['Miles Davis']);

    // Authoritative null-scope cleanup wipes all recent-search keys across accounts without touching unrelated prefs.
    await clearAllRecentSearchesStorage(storage, null);
    expect(await readRecentSearches(storage, scopeB)).toEqual([]);
    expect(await readRecentSearches(storage, scopeOtherOrigin)).toEqual([]);
    expect(storage.store.get('unrelated-pref')).toBe('keep');
  });

  it('waits for an in-flight write before cleanup removes the key', async () => {
    const scope = musicCacheScope('https://music.example', 7);
    const key = recentSearchStorageKey(scope);
    const order: string[] = [];
    let releaseWrite!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const storage: RecentSearchesStorage = {
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {
        order.push('write-start');
        await gate;
        order.push('write-end');
      }),
      removeItem: vi.fn(async () => {
        order.push('remove');
      }),
      getAllKeys: vi.fn(async () => [key]),
    };

    const write = persistRecentSearches(storage, scope, ['Kraftwerk']);
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledOnce());
    const cleanup = clearAllRecentSearchesStorage(storage, null);
    await Promise.resolve();
    expect(storage.removeItem).not.toHaveBeenCalled();

    releaseWrite();
    await write;
    await cleanup;
    expect(order).toEqual(['write-start', 'write-end', 'remove']);
  });

  it('propagates storage read/write failures loudly', async () => {
    const scope = musicCacheScope('https://music.example', 9);
    const broken: RecentSearchesStorage = {
      getItem: vi.fn(async () => {
        throw new Error('disk I/O failed');
      }),
      setItem: vi.fn(async () => {
        throw new Error('quota exceeded');
      }),
      removeItem: vi.fn(async () => undefined),
      getAllKeys: vi.fn(async () => []),
    };

    await expect(readRecentSearches(broken, scope)).rejects.toThrow('disk I/O failed');
    await expect(persistRecentSearches(broken, scope, ['Daft'])).rejects.toThrow('quota exceeded');
  });
});
