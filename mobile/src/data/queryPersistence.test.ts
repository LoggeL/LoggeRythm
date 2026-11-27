import { describe, expect, it } from 'vitest';
import { createMusicQueryClient } from './queryClient';
import { queryKeys } from './queryKeys';
import {
  hydrateAccountQueryCache,
  isPersistableQueryKey,
  persistAccountQueryCache,
  queryCacheStorageKey,
} from './queryPersistence';

describe('account-scoped query cache persistence', () => {
  const scopeA = 'https://music.example.test::user:7';
  const scopeB = 'https://music.example.test::user:8';

  it('persists and hydrates Library/Home/Profile queries strictly within one account scope', async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => { store.set(key, value); },
      removeItem: async (key: string) => { store.delete(key); },
    };

    const writer = createMusicQueryClient();
    writer.setQueryData(queryKeys.library.likes(scopeA), [{ id: '1', title: 'Track 1' }]);
    writer.setQueryData(queryKeys.playlists.owned(scopeA), [{ id: 10, name: 'Roadtrip' }]);
    writer.setQueryData(queryKeys.playlists.outgoingInvitations(scopeA, 10), [
      { invitee: { id: 9, display_name: 'pending-invitee', avatar_url: null } },
    ]);
    writer.setQueryData(queryKeys.playlists.incomingInvitations(scopeA), [
      { id: 3, playlist: { name: 'incoming-invitation' } },
    ]);
    writer.setQueryData(queryKeys.playlists.inviteCandidates(scopeA, 10, 'Ju'), [
      { user: { id: 9, display_name: 'candidate-search' }, status: 'available' },
    ]);
    writer.setQueryData(queryKeys.library.likes(scopeB), [{ id: '2', title: 'Other Account' }]);

    await persistAccountQueryCache(writer, storage, scopeA);
    expect(store.has(queryCacheStorageKey(scopeA))).toBe(true);
    expect(store.get(queryCacheStorageKey(scopeA))).not.toContain('pending-invitee');
    expect(store.get(queryCacheStorageKey(scopeA))).not.toContain('incoming-invitation');
    expect(store.get(queryCacheStorageKey(scopeA))).not.toContain('candidate-search');
    expect(store.get(queryCacheStorageKey(scopeA))).not.toContain('Other Account');

    const reader = createMusicQueryClient();
    const count = await hydrateAccountQueryCache(reader, storage, scopeA);
    expect(count).toBe(2);
    expect(reader.getQueryData(queryKeys.library.likes(scopeA))).toEqual([
      { id: '1', title: 'Track 1' },
    ]);
    expect(reader.getQueryData(queryKeys.playlists.owned(scopeA))).toEqual([
      { id: 10, name: 'Roadtrip' },
    ]);
    expect(reader.getQueryData(queryKeys.library.likes(scopeB))).toBeUndefined();
  });

  it('rejects non-account or volatile keys from persistence', () => {
    expect(isPersistableQueryKey(queryKeys.library.likes(scopeA), scopeA)).toBe(true);
    expect(isPersistableQueryKey(queryKeys.home.mixes(scopeA), scopeA)).toBe(true);
    expect(isPersistableQueryKey(queryKeys.profile.stats(scopeA), scopeA)).toBe(true);
    expect(isPersistableQueryKey(queryKeys.playlists.detail(scopeA, 42), scopeA)).toBe(true);
    expect(isPersistableQueryKey(queryKeys.playlists.outgoingInvitations(scopeA, 42), scopeA))
      .toBe(false);
    expect(isPersistableQueryKey(queryKeys.playlists.inviteCandidates(scopeA, 42, 'Ju'), scopeA))
      .toBe(false);
    expect(isPersistableQueryKey(queryKeys.playlists.incomingInvitations(scopeA), scopeA))
      .toBe(false);
    expect(isPersistableQueryKey(queryKeys.library.likes(scopeB), scopeA)).toBe(false);
    expect(isPersistableQueryKey(queryKeys.search.tracks(scopeA, 'daft'), scopeA)).toBe(false);
  });
});
