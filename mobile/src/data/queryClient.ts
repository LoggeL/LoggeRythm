import { QueryClient } from '@tanstack/react-query';
import { queryKeys, type QueryScope } from './queryKeys';

/**
 * Never auto-retry client/rate-limit rejections (4xx, including HTTP 429) or
 * aborted/cancelled fetches; allow one retry only for transient transport/5xx errors.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof Error && error.name === 'AbortError') return false;
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      if (status >= 400 && status < 500) return false;
      if (
        status === 0
        && error instanceof Error
        && error.message.endsWith('was cancelled')
      ) {
        return false;
      }
    }
  }
  return true;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Stale-time policy aligned with `web/src/app/providers.tsx` so catalog,
 * library, and detail views do not refetch-flicker every 30s while mutations
 * continue to invalidate/update affected caches immediately.
 */
export const QUERY_STALE_TIMES = {
  default: 2 * MINUTE,
  home: 15 * MINUTE,
  homePersonalized: HOUR,
  homeMood: 30 * MINUTE,
  charts: 15 * MINUTE,
  newReleases: HOUR,
  genres: 24 * HOUR,
  genreDetail: HOUR,
  album: HOUR,
  artist: HOUR,
  artistAbout: 24 * HOUR,
  track: HOUR,
  search: 5 * MINUTE,
  playlists: 5 * MINUTE,
  library: 5 * MINUTE,
  follows: 5 * MINUTE,
  cachedTrackIds: 5 * MINUTE,
  playCounts: 10 * MINUTE,
  party: 30_000,
} as const;

export function createMusicQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIMES.default,
        gcTime: 30 * MINUTE,
        retry: shouldRetryQuery,
        refetchOnMount: true,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  });

  client.setQueryDefaults(queryKeys.home.root(), { staleTime: QUERY_STALE_TIMES.home });
  client.setQueryDefaults([...queryKeys.home.root(), 'scope'], {
    staleTime: QUERY_STALE_TIMES.homePersonalized,
  });
  client.setQueryDefaults([...queryKeys.home.root(), 'mood'], {
    staleTime: QUERY_STALE_TIMES.homeMood,
  });
  client.setQueryDefaults(queryKeys.catalog.newReleases(), {
    staleTime: QUERY_STALE_TIMES.newReleases,
  });
  client.setQueryDefaults(queryKeys.catalog.genres(), {
    staleTime: QUERY_STALE_TIMES.genres,
  });
  client.setQueryDefaults(queryKeys.catalog.charts(), {
    staleTime: QUERY_STALE_TIMES.charts,
  });
  client.setQueryDefaults([...queryKeys.catalog.root(), 'album'], {
    staleTime: QUERY_STALE_TIMES.album,
  });
  client.setQueryDefaults([...queryKeys.catalog.root(), 'artist'], {
    staleTime: QUERY_STALE_TIMES.artist,
  });
  client.setQueryDefaults([...queryKeys.catalog.root(), 'artist-about'], {
    staleTime: QUERY_STALE_TIMES.artistAbout,
  });
  client.setQueryDefaults([...queryKeys.catalog.root(), 'track'], {
    staleTime: QUERY_STALE_TIMES.track,
  });
  client.setQueryDefaults(queryKeys.search.root(), {
    staleTime: QUERY_STALE_TIMES.search,
  });
  client.setQueryDefaults(queryKeys.playlists.root(), {
    staleTime: QUERY_STALE_TIMES.playlists,
  });
  client.setQueryDefaults([...queryKeys.root, 'library'], {
    staleTime: QUERY_STALE_TIMES.library,
  });
  client.setQueryDefaults([...queryKeys.root, 'follows'], {
    staleTime: QUERY_STALE_TIMES.follows,
  });
  client.setQueryDefaults(queryKeys.storage.cachedTrackIds(), {
    staleTime: QUERY_STALE_TIMES.cachedTrackIds,
  });
  client.setQueryDefaults(queryKeys.plays.root(), {
    staleTime: QUERY_STALE_TIMES.playCounts,
  });
  client.setQueryDefaults(queryKeys.party.root(), {
    staleTime: QUERY_STALE_TIMES.party,
  });
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
