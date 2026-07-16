import {
  isRemoteOffline,
  resolveRemoteVisualState,
  type RemoteBody,
  type RemoteNotice,
} from '../../data/remoteState';

export interface LibraryQueryResultLike {
  data: unknown;
  error: unknown;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
}

export interface LibraryQuerySectionState {
  kind: 'query';
  /** A successful response exists, including a successful empty response. */
  hasData: boolean;
  empty: boolean;
  pending: boolean;
  fetching: boolean;
  paused: boolean;
  stale: boolean;
  error: unknown;
}

export interface LibraryPolicySectionState {
  kind: 'policy';
}

export type LibrarySectionState = LibraryQuerySectionState | LibraryPolicySectionState;

export type LibrarySectionBody = RemoteBody;

export type LibrarySectionNotice = RemoteNotice;

export interface LibrarySectionVisualState {
  body: LibrarySectionBody;
  notice: LibrarySectionNotice;
}

export const LIBRARY_POLICY_SECTION_STATE: LibraryPolicySectionState = Object.freeze({
  kind: 'policy',
});

/**
 * Copy only query metadata into the view model. The response itself remains in
 * React Query's account-and-origin-scoped in-memory cache.
 */
export function libraryQuerySectionState(
  query: LibraryQueryResultLike,
  empty: boolean,
): LibraryQuerySectionState {
  return {
    kind: 'query',
    hasData: query.data !== undefined,
    empty,
    pending: query.isPending,
    fetching: query.isFetching,
    paused: query.fetchStatus === 'paused',
    stale: query.isStale,
    error: query.error,
  };
}

/** API transport failures are normalized to status zero. */
export function isLibraryOfflineState(error: unknown, paused: boolean): boolean {
  return isRemoteOffline(error, paused ? 'paused' : 'idle');
}

/**
 * Resolve a mutually exclusive body and notice. `hasData` is deliberately
 * separate from `empty`, so a last-good empty response survives refresh errors.
 */
export function resolveLibrarySectionVisualState(
  state: LibraryQuerySectionState,
): LibrarySectionVisualState {
  return resolveRemoteVisualState({
    hasData: state.hasData,
    empty: state.empty,
    pending: state.pending,
    fetching: state.fetching,
    stale: state.stale,
    fetchStatus: state.paused ? 'paused' : state.fetching ? 'fetching' : 'idle',
    error: state.error,
  });
}

export interface LibraryRefetchable {
  refetch: () => Promise<unknown>;
}

/** Pull-to-refresh always attempts every remote Library section independently. */
export async function refreshLibraryQueries(
  queries: readonly LibraryRefetchable[],
): Promise<void> {
  await Promise.allSettled(queries.map((query) => query.refetch()));
}
