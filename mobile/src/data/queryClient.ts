import { QueryClient } from '@tanstack/react-query';
import { queryKeys, type QueryScope } from './queryKeys';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function createMusicQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 30 * MINUTE,
        retry: 1,
        refetchOnMount: true,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  });

  client.setQueryDefaults(queryKeys.home.root(), { staleTime: 15 * MINUTE });
  client.setQueryDefaults([...queryKeys.home.root(), 'scope'], { staleTime: HOUR });
  client.setQueryDefaults([...queryKeys.home.root(), 'mood'], { staleTime: 30 * MINUTE });
  client.setQueryDefaults(queryKeys.catalog.newReleases(), { staleTime: HOUR });
  client.setQueryDefaults(queryKeys.catalog.genres(), { staleTime: 24 * HOUR });
  client.setQueryDefaults(queryKeys.catalog.charts(), { staleTime: 15 * MINUTE });
  return client;
}

/** Cache scopes include both server origin and account to prevent cross-account reuse. */
export function musicCacheScope(origin: string, userId: QueryScope): string {
  const normalizedOrigin = new URL(origin).origin;
  const normalizedUserId = String(userId).trim();
  if (normalizedUserId.length === 0) throw new Error('cache user id must not be empty');
  return `${normalizedOrigin}::user:${normalizedUserId}`;
}

export function clearAccountQueryState(client: QueryClient): void {
  client.clear();
}

const ACCOUNT_QUERY_CLEANUP_TIMEOUT_MS = 25_000;

async function waitForMutationCacheIdle(
  client: QueryClient,
  timeoutMs: number,
): Promise<void> {
  if (client.isMutating() === 0) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = (): void => undefined;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      if (error === undefined) resolve();
      else reject(error);
    };
    const timeout = setTimeout(() => {
      finish(new Error('Account query cleanup timed out while mutations were still active'));
    }, timeoutMs);
    unsubscribe = client.getMutationCache().subscribe(() => {
      if (client.isMutating() === 0) finish();
    });
    // Close the check/subscribe race if the final mutation settled between the
    // caller's first check and listener installation.
    if (client.isMutating() === 0) finish();
  });
}

/**
 * Auth-boundary cleanup waits for already-started mutation callbacks before
 * the final clear. Account screens are unmounted before this begins, so no new
 * user action can enter the cache; the timeout fails closed and keeps the auth
 * cleanup barrier required instead of allowing another account to sign in.
 */
export async function clearAccountQueryStateBoundary(
  client: QueryClient,
  timeoutMs = ACCOUNT_QUERY_CLEANUP_TIMEOUT_MS,
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Account query cleanup timeout must be a positive integer');
  }
  await client.cancelQueries();
  while (client.isMutating() > 0) {
    await waitForMutationCacheIdle(client, timeoutMs);
  }
  // Mutation callbacks can invalidate/refetch. Cancel those final reads and
  // remove both caches only after every callback has reached a terminal state.
  await client.cancelQueries();
  client.clear();
}

export const musicQueryClient = createMusicQueryClient();

/** Mark every account-scoped stats view stale after a persisted play event. */
export function invalidateListeningStats(
  client: QueryClient = musicQueryClient,
): Promise<void> {
  return client.invalidateQueries({
    queryKey: queryKeys.profile.privateRoot(),
    predicate: (query) => query.queryKey[query.queryKey.length - 1] === 'stats',
    refetchType: 'active',
  });
}
