import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";

export const QUERY_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const QUERY_CACHE_BUSTER = "loggerhythm-ui-v1";

const QUERY_CACHE_STORAGE_KEY = "loggerhythm:query-cache";
const PERSIST_THROTTLE_MS = 1_000;

export const PERSISTED_QUERY_ROOTS = [
  "home-mixes",
  "because-you-listened",
  "home-collections",
  "release-radar",
  "new-releases",
  "genres",
  "public-playlists",
  "home-mood",
  "genre",
  "album",
  "artist",
  "artist-about",
] as const;

const PERSISTED_QUERY_ROOT_SET = new Set<string>(PERSISTED_QUERY_ROOTS);
const USER_SCOPED_QUERY_ROOTS = new Set<string>([
  "home-mixes",
  "because-you-listened",
  "release-radar",
]);
const PRIVATE_QUERY_ROOTS = new Set<string>([
  "likes",
  "playlists",
  "playlist",
  "following",
  "playback-settings",
  "stats",
  "party",
  "admin-users",
  "admin-storage",
  "admin-invites",
  "admin-status",
  "status-auth",
]);

export function isPersistedQueryKey(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  if (typeof root !== "string" || !PERSISTED_QUERY_ROOT_SET.has(root)) {
    return false;
  }
  if (!USER_SCOPED_QUERY_ROOTS.has(root)) return true;
  return typeof queryKey[1] === "string" && queryKey[1].length > 0;
}

export function shouldRemoveQueryForUserChange(
  queryKey: readonly unknown[],
  nextUserId?: string,
): boolean {
  const root = queryKey[0];
  if (typeof root !== "string") return false;
  if (PRIVATE_QUERY_ROOTS.has(root)) return true;
  if (!USER_SCOPED_QUERY_ROOTS.has(root)) return false;
  return nextUserId === undefined || queryKey[1] !== nextUserId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertPersistedClient(value: unknown): asserts value is PersistedClient {
  if (
    !isRecord(value) ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp) ||
    typeof value.buster !== "string" ||
    !isRecord(value.clientState) ||
    !Array.isArray(value.clientState.queries) ||
    !Array.isArray(value.clientState.mutations)
  ) {
    throw new Error(
      `Ungültiges Format in localStorage["${QUERY_CACHE_STORAGE_KEY}"].`,
    );
  }
}

function failure(action: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(`UI-Cache konnte nicht ${action} werden: ${detail}`, {
    cause,
  });
}

function browserStorage(): Storage {
  if (typeof window === "undefined") {
    throw new Error("UI-Cache wurde außerhalb des Browsers aufgerufen.");
  }
  return window.localStorage;
}

export function keepLastGoodQueryData(
  client: PersistedClient,
): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) => {
        if (query.state.data === undefined || query.state.status !== "error") {
          return query;
        }
        return {
          ...query,
          state: {
            ...query.state,
            status: "success" as const,
            error: null,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
          },
        };
      }),
    },
  };
}

/**
 * A strict localStorage persister. Cache corruption and storage/quota errors
 * are reported to React and then crash through the nearest error boundary.
 */
export function createBrowserQueryPersister(
  reportError: (error: Error) => void,
): Persister {
  let pendingClient: PersistedClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function fail(action: string, cause: unknown): never {
    const error = failure(action, cause);
    reportError(error);
    throw error;
  }

  function writePendingClient() {
    timer = undefined;
    const client = pendingClient;
    pendingClient = undefined;
    if (!client) {
      fail(
        "gespeichert",
        new Error("Es war kein ausstehender Cache-Snapshot vorhanden."),
      );
    }
    try {
      browserStorage().setItem(
        QUERY_CACHE_STORAGE_KEY,
        JSON.stringify(client),
      );
    } catch (cause) {
      fail("gespeichert", cause);
    }
  }

  return {
    persistClient(client) {
      pendingClient = keepLastGoodQueryData(client);
      if (timer !== undefined) return;
      timer = setTimeout(writePendingClient, PERSIST_THROTTLE_MS);
    },
    restoreClient() {
      try {
        const raw = browserStorage().getItem(QUERY_CACHE_STORAGE_KEY);
        if (raw === null) return undefined;
        const parsed: unknown = JSON.parse(raw);
        assertPersistedClient(parsed);
        return parsed;
      } catch (cause) {
        fail("wiederhergestellt", cause);
      }
    },
    removeClient() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        pendingClient = undefined;
      }
      try {
        browserStorage().removeItem(QUERY_CACHE_STORAGE_KEY);
      } catch (cause) {
        fail("entfernt", cause);
      }
    },
  };
}
