import type { Track } from './types';

export const GUEST_SEARCH_CACHE_TTL_MS = 60_000;
const MAX_ENTRIES = 50;

interface CacheEntry {
  tracks: Track[];
  expiresAt: number;
}

interface InFlightEntry {
  promise: Promise<Track[]>;
  controller: AbortController;
  waiters: number;
}

export type GuestSearchFetcher = (
  origin: string,
  query: string,
  signal?: AbortSignal,
) => Promise<Track[]>;

function cacheKey(origin: string, query: string): string {
  const normalizedOrigin = origin.trim();
  if (normalizedOrigin.length === 0) {
    throw new Error('Guest search origin must not be empty');
  }
  return `${normalizedOrigin}\0${query.trim()}`;
}

function abortError(origin: string): Error {
  const error = new Error(`Guest search for ${origin} was cancelled`);
  error.name = 'AbortError';
  return error;
}

/**
 * Strictly origin-scoped short-lived cache and in-flight deduplicator for
 * signed-out Guest Jam search. Keeps case & internal whitespace (outer trim only),
 * never caches errors, and never shares state with authenticated QueryClient caches.
 */
export function createGuestSearchCache(ttlMs = GUEST_SEARCH_CACHE_TTL_MS) {
  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, InFlightEntry>();

  const prune = (now: number) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    async search(
      origin: string,
      query: string,
      fetcher: GuestSearchFetcher,
      signal?: AbortSignal,
      now = Date.now(),
    ): Promise<Track[]> {
      if (signal?.aborted) throw abortError(origin);
      const trimmed = query.trim();
      const key = cacheKey(origin, trimmed);
      const cached = entries.get(key);
      if (cached !== undefined && cached.expiresAt > now) {
        return cached.tracks;
      }

      let flight = inFlight.get(key);
      if (flight === undefined) {
        const controller = new AbortController();
        let createdFlight: InFlightEntry | undefined;
        const promise = fetcher(origin, trimmed, controller.signal).then((tracks) => {
          if (
            !controller.signal.aborted
            && createdFlight !== undefined
            && inFlight.get(key) === createdFlight
          ) {
            const settledAt = Date.now();
            prune(settledAt);
            entries.set(key, { tracks, expiresAt: settledAt + ttlMs });
          }
          return tracks;
        });
        createdFlight = { promise, controller, waiters: 0 };
        flight = createdFlight;
        inFlight.set(key, flight);
        void promise.then(
          () => {
            if (inFlight.get(key) === flight) inFlight.delete(key);
          },
          () => {
            if (inFlight.get(key) === flight) inFlight.delete(key);
          },
        );
      }

      const activeFlight = flight;
      activeFlight.waiters += 1;

      if (signal === undefined) {
        try {
          return await activeFlight.promise;
        } finally {
          activeFlight.waiters = Math.max(0, activeFlight.waiters - 1);
        }
      }

      return new Promise<Track[]>((resolve, reject) => {
        let settled = false;
        const releaseWaiter = () => {
          activeFlight.waiters = Math.max(0, activeFlight.waiters - 1);
          if (activeFlight.waiters === 0) {
            activeFlight.controller.abort();
            if (inFlight.get(key) === activeFlight) inFlight.delete(key);
          }
        };
        const onAbort = () => {
          if (settled) return;
          settled = true;
          releaseWaiter();
          reject(abortError(origin));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        activeFlight.promise.then(
          (tracks) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            activeFlight.waiters = Math.max(0, activeFlight.waiters - 1);
            resolve(tracks);
          },
          (error: unknown) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            activeFlight.waiters = Math.max(0, activeFlight.waiters - 1);
            reject(error);
          },
        );
      });
    },

    clear(origin?: string): void {
      if (origin === undefined) {
        for (const flight of inFlight.values()) flight.controller.abort();
        inFlight.clear();
        entries.clear();
        return;
      }
      const prefix = `${origin.trim()}\0`;
      for (const [key, flight] of inFlight) {
        if (key.startsWith(prefix)) {
          flight.controller.abort();
          inFlight.delete(key);
        }
      }
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
  };
}

export const guestSearchCache = createGuestSearchCache();
