import { describe, expect, it, vi } from 'vitest';
import {
  accountScopedStorageKeys,
  clearAccountScopedStorage,
  recentSearchStorageKey,
} from './accountStorage';
import { markReleaseRadarTracksSeen, releaseRadarSeenStorageKey } from './releaseRadar';
import { createMusicQueryClient } from './queryClient';
import { queryKeys } from './queryKeys';
import { persistAccountQueryCache, queryCacheStorageKey } from './queryPersistence';
import { navigationStateStorageKey } from '../navigationPersistence';
import { offlineLyricsStorageKey, saveOfflineLyrics } from '../offline/lyricsCache';

describe('account-scoped persisted storage', () => {
  it('uses an origin-and-user-safe recent-search key', () => {
    const key = recentSearchStorageKey('https://music.test::user:7');
    expect(key).toBe(
      'lr.recent-searches.v1:https%3A%2F%2Fmusic.test%3A%3Auser%3A7',
    );
    expect(accountScopedStorageKeys('https://music.test::user:7')).toEqual([
      key,
      releaseRadarSeenStorageKey('https://music.test::user:7'),
      navigationStateStorageKey('https://music.test::user:7'),
      queryCacheStorageKey('https://music.test::user:7'),
      offlineLyricsStorageKey('https://music.test::user:7'),
    ]);
    expect(recentSearchStorageKey('https://other.test::user:7')).not.toBe(key);
    expect(recentSearchStorageKey('https://music.test::user:8')).not.toBe(key);
  });

  it('rejects an unscoped key instead of creating shared persisted state', () => {
    expect(() => recentSearchStorageKey('   ')).toThrow(
      'Account storage scope must not be empty',
    );
  });

  it('clears every registered key and safely no-ops before a scope exists', async () => {
    const removeItem = vi.fn(async () => undefined);
    const getAllKeys = vi.fn(async () => [
      recentSearchStorageKey('origin::user:1'),
      'unrelated-setting',
      recentSearchStorageKey('origin::user:2'),
      releaseRadarSeenStorageKey('origin::user:1'),
      releaseRadarSeenStorageKey('origin::user:2'),
      navigationStateStorageKey('origin::user:1'),
      navigationStateStorageKey('origin::user:2'),
      queryCacheStorageKey('origin::user:1'),
      offlineLyricsStorageKey('origin::user:1'),
    ]);
    await clearAccountScopedStorage({ getAllKeys, removeItem }, null);
    expect(getAllKeys).toHaveBeenCalledOnce();
    expect(removeItem).toHaveBeenCalledTimes(8);
    expect(removeItem).not.toHaveBeenCalledWith('unrelated-setting');

    removeItem.mockClear();
    await clearAccountScopedStorage({ getAllKeys, removeItem }, 'origin::user:1');
    expect(getAllKeys).toHaveBeenCalledOnce();
    expect(removeItem).toHaveBeenCalledTimes(5);
    expect(removeItem).toHaveBeenCalledWith(recentSearchStorageKey('origin::user:1'));
    expect(removeItem).toHaveBeenCalledWith(releaseRadarSeenStorageKey('origin::user:1'));
    expect(removeItem).toHaveBeenCalledWith(navigationStateStorageKey('origin::user:1'));
    expect(removeItem).toHaveBeenCalledWith(queryCacheStorageKey('origin::user:1'));
    expect(removeItem).toHaveBeenCalledWith(offlineLyricsStorageKey('origin::user:1'));
  });

  it('waits for an in-flight radar acknowledgement before logout removes its key', async () => {
    const scope = 'origin::user:1';
    const order: string[] = [];
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const storage = {
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {
        order.push('write-start');
        await writeGate;
        order.push('write-end');
      }),
      getAllKeys: vi.fn(async () => []),
      removeItem: vi.fn(async () => { order.push('remove'); }),
    };

    const acknowledgement = markReleaseRadarTracksSeen(storage, scope, ['7']);
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledOnce());
    const cleanup = clearAccountScopedStorage(storage, scope);
    await Promise.resolve();
    expect(storage.removeItem).not.toHaveBeenCalled();

    releaseWrite?.();
    await acknowledgement;
    await cleanup;
    expect(order).toEqual([
      'write-start',
      'write-end',
      'remove',
      'remove',
      'remove',
      'remove',
      'remove',
    ]);
  });

  it('waits for in-flight query cache and offline lyrics writes before logout removes keys', async () => {
    const scope = 'origin::user:9';
    const order: string[] = [];
    let releaseQueryWrite: (() => void) | undefined;
    let releaseLyricsWrite: (() => void) | undefined;
    const queryGate = new Promise<void>((resolve) => { releaseQueryWrite = resolve; });
    const lyricsGate = new Promise<void>((resolve) => { releaseLyricsWrite = resolve; });
    const storage = {
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async (key: string) => {
        if (key === queryCacheStorageKey(scope)) {
          order.push('query-write-start');
          await queryGate;
          order.push('query-write-end');
        } else if (key === offlineLyricsStorageKey(scope)) {
          order.push('lyrics-write-start');
          await lyricsGate;
          order.push('lyrics-write-end');
        }
      }),
      getAllKeys: vi.fn(async () => []),
      removeItem: vi.fn(async () => { order.push('remove'); }),
    };

    const client = createMusicQueryClient();
    client.setQueryData(queryKeys.library.likes(scope), [{ id: '1', title: 'Track' }]);
    const queryWrite = persistAccountQueryCache(client, storage, scope);
    const lyricsWrite = saveOfflineLyrics(
      scope,
      '1',
      { lines: [{ t: 1, text: 'Hello' }], synced: true, source: 'lrclib', ai_generated: false },
      storage,
    );
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(2));

    const cleanup = clearAccountScopedStorage(storage, scope);
    await Promise.resolve();
    expect(storage.removeItem).not.toHaveBeenCalled();

    releaseQueryWrite?.();
    releaseLyricsWrite?.();
    await Promise.all([queryWrite, lyricsWrite, cleanup]);
    expect(order.indexOf('query-write-end')).toBeLessThan(order.indexOf('remove'));
    expect(order.indexOf('lyrics-write-end')).toBeLessThan(order.indexOf('remove'));
  });

});
