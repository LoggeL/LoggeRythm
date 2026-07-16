import { describe, expect, it, vi } from 'vitest';
import {
  MAX_NAVIGATION_STATE_CHARS,
  NAVIGATION_STATE_PREFIX,
  NAVIGATION_STATE_VERSION,
  navigationStateStorageKey,
  persistNavigationState,
  readNavigationState,
  readNavigationStateUnlessLinked,
  sanitizeNavigationState,
} from './navigationPersistence';

function durableState(extraRootRoutes: readonly unknown[] = []) {
  return {
    key: 'root-secret-key',
    index: 2,
    routes: [
      {
        key: 'tabs-secret-key',
        name: 'Tabs',
        state: {
          index: 1,
          history: [{ type: 'route', key: 'secret-history' }],
          routes: [
            {
              name: 'HomeTab',
              state: {
                index: 1,
                routes: [
                  { name: 'Home' },
                  {
                    name: 'Album',
                    params: {
                      albumId: ' 42 ',
                      title: '  Album title  ',
                      token: 'must-not-persist',
                    },
                  },
                ],
              },
            },
            { name: 'SearchTab', state: { index: 0, routes: [{ name: 'Search' }] } },
          ],
        },
      },
      ...extraRootRoutes,
    ],
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
  };
}

describe('account-scoped navigation persistence', () => {
  it('uses a versioned origin-and-account key and rejects an empty scope', () => {
    const key = navigationStateStorageKey('https://music.test::user:7');
    expect(key).toBe(
      `${NAVIGATION_STATE_PREFIX}https%3A%2F%2Fmusic.test%3A%3Auser%3A7`,
    );
    expect(navigationStateStorageKey('https://other.test::user:7')).not.toBe(key);
    expect(navigationStateStorageKey('https://music.test::user:8')).not.toBe(key);
    expect(() => navigationStateStorageKey('   ')).toThrow(
      'Navigation storage scope must not be empty',
    );
  });

  it('keeps only Tabs and sanitized nested stacks, never transient roots or unknown params', () => {
    const state = sanitizeNavigationState(durableState([
      { name: 'Profile', params: { email: 'private@example.test' } },
      { name: 'NowPlaying', params: { stream: 'https://secret.test' } },
      { name: 'Queue' },
    ]));

    expect(state).toEqual({
      index: 0,
      routes: [{
        name: 'Tabs',
        state: {
          index: 1,
          routes: [
            {
              name: 'HomeTab',
              state: {
                index: 1,
                routes: [
                  { name: 'Home' },
                  { name: 'Album', params: { albumId: '42', title: 'Album title' } },
                ],
              },
            },
            { name: 'SearchTab', state: { index: 0, routes: [{ name: 'Search' }] } },
          ],
        },
      }],
    });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('Profile');
    expect(serialized).not.toContain('NowPlaying');
    expect(serialized).not.toContain('Queue');
    expect(serialized).not.toContain('must-not-persist');
    expect(serialized).not.toContain('secret-key');
  });

  it('round-trips the canonical versioned envelope and serializes writes', async () => {
    const storage = memoryStorage();
    const scope = 'https://music.test::user:7';
    await persistNavigationState(storage, scope, durableState());
    const serialized = storage.values.get(navigationStateStorageKey(scope));

    expect(serialized).toBeDefined();
    expect(JSON.parse(serialized!)).toMatchObject({ version: NAVIGATION_STATE_VERSION });
    await expect(readNavigationState(storage, scope)).resolves.toEqual(
      sanitizeNavigationState(durableState()),
    );
  });

  it('deletes malformed, wrong-version, oversized, and invalid-route snapshots', async () => {
    const scope = 'scope';
    const key = navigationStateStorageKey(scope);
    for (const serialized of [
      '{',
      JSON.stringify({ version: NAVIGATION_STATE_VERSION + 1, state: durableState() }),
      'x'.repeat(MAX_NAVIGATION_STATE_CHARS + 1),
      JSON.stringify({
        version: NAVIGATION_STATE_VERSION,
        state: {
          routes: [{
            name: 'Tabs',
            state: {
              routes: [{
                name: 'HomeTab',
                state: { routes: [{ name: 'Home' }, { name: 'Album', params: { albumId: '../' } }] },
              }],
            },
          }],
        },
      }),
    ]) {
      const storage = memoryStorage({ [key]: serialized });
      await expect(readNavigationState(storage, scope)).resolves.toBeNull();
      expect(storage.removeItem).toHaveBeenCalledWith(key);
    }
  });

  it('never reads persisted state when a cold initial URL exists or cannot be checked', async () => {
    const storage = memoryStorage();
    await expect(
      readNavigationStateUnlessLinked(
        storage,
        'scope',
        async () => 'https://loggerythm.logge.top/album/42',
      ),
    ).resolves.toBeNull();
    await expect(
      readNavigationStateUnlessLinked(storage, 'scope', async () => { throw new Error('native'); }),
    ).resolves.toBeNull();
    expect(storage.getItem).not.toHaveBeenCalled();
  });
});
