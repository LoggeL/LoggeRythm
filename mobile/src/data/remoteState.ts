export type RemoteFetchStatus = 'fetching' | 'paused' | 'idle';

export interface RemoteVisualStateInput {
  /** A successful response exists, including a successful empty response. */
  hasData: boolean;
  empty: boolean;
  pending: boolean;
  fetching: boolean;
  stale: boolean;
  fetchStatus: RemoteFetchStatus;
  error: unknown;
}

export type RemoteBody = 'loading' | 'offline' | 'hard-error' | 'empty' | 'content';

export type RemoteNotice =
  | 'cached-offline'
  | 'cached-refresh-error'
  | 'refreshing'
  | 'stale'
  | null;

export interface RemoteVisualState {
  body: RemoteBody;
  notice: RemoteNotice;
}

/** API transport failures are normalized to status zero. */
export function isRemoteOffline(error: unknown, fetchStatus: RemoteFetchStatus): boolean {
  if (fetchStatus === 'paused') return true;
  return (
    typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status?: unknown }).status === 0
  );
}

/**
 * One precedence contract for every remote collection and detail:
 *
 * - never-loaded data has exactly one blocking body;
 * - a successful empty response is distinct from never-loaded;
 * - last-good data always remains visible;
 * - offline/error/refresh/stale notices are mutually exclusive and ordered by
 *   the actionability of the state.
 */
export function resolveRemoteVisualState(input: RemoteVisualStateInput): RemoteVisualState {
  const offline = isRemoteOffline(input.error, input.fetchStatus);

  if (!input.hasData) {
    if (offline) return { body: 'offline', notice: null };
    if (input.error !== null && input.error !== undefined) {
      return { body: 'hard-error', notice: null };
    }
    return { body: 'loading', notice: null };
  }

  const body: RemoteBody = input.empty ? 'empty' : 'content';
  if (offline) return { body, notice: 'cached-offline' };
  if (input.error !== null && input.error !== undefined) {
    return { body, notice: 'cached-refresh-error' };
  }
  if (input.fetching) return { body, notice: 'refreshing' };
  if (input.stale) return { body, notice: 'stale' };
  return { body, notice: null };
}
