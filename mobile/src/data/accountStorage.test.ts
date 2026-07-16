import { describe, expect, it, vi } from 'vitest';
import {
  accountScopedStorageKeys,
  clearAccountScopedStorage,
  persistRecentSearches,
  recentSearchStorageKey,
} from './accountStorage';
import { markReleaseRadarTracksSeen, releaseRadarSeenStorageKey } from './releaseRadar';
import { navigationStateStorageKey } from '../navigationPersistence';

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
    ]);
    expect(recentSearchStorageKey('https://other.test::user:7')).not.toBe(key);
    expect(recentSearchStorageKey('https://music.test::user:8')).not.toBe(key);
  });

  it('rejects an unscoped key instead of creating shared persisted state', () => {
    expect(() => recentSearchStorageKey('   ')).toThrow(
      'Account storage scope must not be empty',
    );
  });

  it('persists removals only in the selected origin-and-account scope', async () => {
    const setItem = vi.fn(async () => undefined);
    const removeItem = vi.fn(async () => undefined);
    const storage = { setItem, removeItem };

    await persistRecentSearches(storage, 'https://music.test::user:7', [
      'Bowie',
      'Kraftwerk',
    ]);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(
      recentSearchStorageKey('https://music.test::user:7'),
      '["Bowie","Kraftwerk"]',
    );
    expect(removeItem).not.toHaveBeenCalled();

    await persistRecentSearches(storage, 'https://other.test::user:7', []);
    expect(removeItem).toHaveBeenCalledExactlyOnceWith(
      recentSearchStorageKey('https://other.test::user:7'),
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
    ]);
    await clearAccountScopedStorage({ getAllKeys, removeItem }, null);
    expect(getAllKeys).toHaveBeenCalledOnce();
    expect(removeItem).toHaveBeenCalledTimes(6);
    expect(removeItem).not.toHaveBeenCalledWith('unrelated-setting');

    removeItem.mockClear();
    await clearAccountScopedStorage({ getAllKeys, removeItem }, 'origin::user:1');
    expect(getAllKeys).toHaveBeenCalledOnce();
    expect(removeItem).toHaveBeenCalledTimes(3);
    expect(removeItem).toHaveBeenCalledWith(recentSearchStorageKey('origin::user:1'));
    expect(removeItem).toHaveBeenCalledWith(releaseRadarSeenStorageKey('origin::user:1'));
    expect(removeItem).toHaveBeenCalledWith(navigationStateStorageKey('origin::user:1'));
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
    expect(order).toEqual(['write-start', 'write-end', 'remove', 'remove', 'remove']);
  });

  it('serializes recent-search updates and drains the newest write before logout removal', async () => {
    const scope = 'origin::user:recent-race';
    const key = recentSearchStorageKey(scope);
    const values = new Map<string, string>();
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const order: string[] = [];
    const storage = {
      getAllKeys: vi.fn(async () => [...values.keys()]),
      setItem: vi.fn(async (storageKey: string, value: string) => {
        order.push(`write:${value}:start`);
        if (value === '["older"]') await firstWriteGate;
        values.set(storageKey, value);
        order.push(`write:${value}:end`);
      }),
      removeItem: vi.fn(async (storageKey: string) => {
        order.push(`remove:${storageKey}`);
        values.delete(storageKey);
      }),
    };

    const older = persistRecentSearches(storage, scope, ['older']);
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledOnce());
    const newer = persistRecentSearches(storage, scope, ['newer']);
    const cleanup = clearAccountScopedStorage(storage, scope);
    await Promise.resolve();
    expect(storage.removeItem).not.toHaveBeenCalled();

    releaseFirstWrite();
    await Promise.all([older, newer, cleanup]);
    expect(values.has(key)).toBe(false);
    expect(order).toEqual([
      'write:["older"]:start',
      'write:["older"]:end',
      'write:["newer"]:start',
      'write:["newer"]:end',
      `remove:${key}`,
      `remove:${releaseRadarSeenStorageKey(scope)}`,
      `remove:${navigationStateStorageKey(scope)}`,
    ]);
  });
});
