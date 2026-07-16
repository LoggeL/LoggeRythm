import { describe, expect, it, vi } from 'vitest';
import {
  clearAccountQueryState,
  clearAccountQueryStateBoundary,
  createMusicQueryClient,
  invalidateListeningStats,
  musicCacheScope,
} from './queryClient';
import { queryKeys } from './queryKeys';

describe('music query client boundaries', () => {
  it('scopes personalized data by canonical origin and account', () => {
    expect(musicCacheScope('https://music.test/', 7)).toBe('https://music.test::user:7');
    expect(musicCacheScope('https://other.test', 7)).not.toBe(
      musicCacheScope('https://music.test', 7),
    );
    expect(musicCacheScope('https://music.test', 8)).not.toBe(
      musicCacheScope('https://music.test', 7),
    );
  });

  it('removes completed account queries and mutations synchronously', async () => {
    const client = createMusicQueryClient();
    const queryKey = ['music', 'home', 'scope', 'account-a'] as const;
    await client.fetchQuery({
      queryKey,
      queryFn: async () => ['secret'],
      retry: false,
    });
    const mutation = client.getMutationCache().build(client, {
      mutationKey: ['music', 'mutation', 'account-a', 'playlist', 'create'],
      mutationFn: async (name: string) => ({ id: 1, name }),
    });
    await mutation.execute('Private playlist');
    expect(client.getQueryData(queryKey)).toEqual(['secret']);
    expect(client.getMutationCache().getAll()).toHaveLength(1);
    expect(mutation.state.status).toBe('success');

    clearAccountQueryState(client);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('waits for late mutation callbacks before the final auth-boundary clear', async () => {
    const client = createMusicQueryClient();
    const privateKey = queryKeys.playlists.owned('departing-account');
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const mutation = client.getMutationCache().build(client, {
      mutationKey: ['music', 'mutation', 'departing-account', 'playlist', 'update'],
      mutationFn: async () => { await mutationGate; },
      onSuccess: () => {
        // This models optimistic/onSettled screen callbacks that could otherwise
        // recreate old-account data after a premature QueryClient.clear().
        client.setQueryData(privateKey, ['late private playlist']);
      },
    });
    const executing = mutation.execute(undefined);
    await vi.waitFor(() => expect(client.isMutating()).toBe(1));

    const cleanup = clearAccountQueryStateBoundary(client, 1_000);
    await Promise.resolve();
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    releaseMutation();
    await Promise.all([executing, cleanup]);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('fails closed without dropping evidence when an active mutation exceeds the boundary', async () => {
    const client = createMusicQueryClient();
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const mutation = client.getMutationCache().build(client, {
      mutationKey: ['music', 'mutation', 'departing-account', 'playlist', 'slow'],
      mutationFn: async () => { await mutationGate; },
    });
    const executing = mutation.execute(undefined);
    await vi.waitFor(() => expect(client.isMutating()).toBe(1));

    await expect(clearAccountQueryStateBoundary(client, 1)).rejects.toThrow(
      'Account query cleanup timed out while mutations were still active',
    );
    expect(client.getMutationCache().getAll()).toContain(mutation);

    releaseMutation();
    await executing;
    client.clear();
  });

  it('retains last-good data and records the error when an explicit refetch fails', async () => {
    const client = createMusicQueryClient();
    const queryKey = queryKeys.library.likes('account-a');
    const failure = new Error('refresh failed');
    let fail = false;
    const queryFn = async () => {
      if (fail) throw failure;
      return [{ id: 'last-good' }];
    };

    await client.fetchQuery({ queryKey, queryFn, retry: false });
    fail = true;
    await expect(client.refetchQueries(
      { queryKey, exact: true },
      { throwOnError: true },
    )).rejects.toBe(failure);

    expect(client.getQueryData(queryKey)).toEqual([{ id: 'last-good' }]);
    expect(client.getQueryState(queryKey)).toMatchObject({
      status: 'error',
      error: failure,
    });
    client.clear();
  });

  it('aborts an in-flight replacement and ignores its late non-cooperative result', async () => {
    const client = createMusicQueryClient();
    const queryKey = queryKeys.search.tracks('replacement');
    client.setQueryData(queryKey, [{ id: 'last-good' }]);

    let resolveLate!: (value: { id: string }[]) => void;
    const observedSignal: { current?: AbortSignal } = {};
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const lateResult = new Promise<{ id: string }[]>((resolve) => {
      resolveLate = resolve;
    });
    const pending = client.fetchQuery({
      queryKey,
      staleTime: 0,
      retry: false,
      queryFn: ({ signal }) => {
        observedSignal.current = signal;
        markStarted();
        // Deliberately ignore the signal to prove QueryClient still rejects the
        // cancelled result instead of replacing the prior cache value.
        return lateResult;
      },
    });
    const settled = pending.catch((error: unknown) => error);

    await started;
    await client.cancelQueries({ queryKey, exact: true });
    expect(observedSignal.current?.aborted).toBe(true);
    resolveLate([{ id: 'too-late' }]);
    await settled;

    expect(client.getQueryData(queryKey)).toEqual([{ id: 'last-good' }]);
    client.clear();
  });

  it('isolates identical private resources by account during invalidation and removal', async () => {
    const client = createMusicQueryClient();
    const accountA = queryKeys.playlists.owned('account-a');
    const accountB = queryKeys.playlists.owned('account-b');

    await Promise.all([
      client.fetchQuery({ queryKey: accountA, queryFn: async () => ['A'], retry: false }),
      client.fetchQuery({ queryKey: accountB, queryFn: async () => ['B'], retry: false }),
    ]);
    await client.invalidateQueries({
      queryKey: queryKeys.playlists.scoped('account-a'),
      exact: false,
      refetchType: 'none',
    });

    expect(client.getQueryState(accountA)?.isInvalidated).toBe(true);
    expect(client.getQueryState(accountB)?.isInvalidated).toBe(false);
    client.removeQueries({ queryKey: queryKeys.playlists.scoped('account-a'), exact: false });
    expect(client.getQueryData(accountA)).toBeUndefined();
    expect(client.getQueryData(accountB)).toEqual(['B']);
    client.clear();
  });

  it('invalidates all private listening stats without staling adjacent settings or public data', async () => {
    const client = createMusicQueryClient();
    const firstStats = queryKeys.profile.stats('account-a');
    const secondStats = queryKeys.profile.stats('account-b');
    const settings = queryKeys.profile.settings('account-a');
    const publicProfile = queryKeys.profile.public(7);
    client.setQueryData(firstStats, { recent: [] });
    client.setQueryData(secondStats, { recent: [] });
    client.setQueryData(settings, { crossfade_enabled: false });
    client.setQueryData(publicProfile, { id: 7 });

    await invalidateListeningStats(client);

    expect(client.getQueryState(firstStats)?.isInvalidated).toBe(true);
    expect(client.getQueryState(secondStats)?.isInvalidated).toBe(true);
    expect(client.getQueryState(settings)?.isInvalidated).toBe(false);
    expect(client.getQueryState(publicProfile)?.isInvalidated).toBe(false);
  });
});
