import {
  resolveRemoteVisualState,
  type RemoteFetchStatus,
  type RemoteVisualState,
} from '../data/remoteState';

export interface SearchRemoteQueryLike {
  data: unknown;
  error: unknown;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: RemoteFetchStatus;
}

export interface SearchRemoteEntry {
  key: string;
  hasData: boolean;
  itemCount: number;
  error: unknown;
  visual: RemoteVisualState;
}

export type SearchRemoteIssueKind =
  | 'offline'
  | 'hard-error'
  | 'cached-offline'
  | 'cached-refresh-error';

export interface SearchRemoteIssue {
  key: string;
  kind: SearchRemoteIssueKind;
  error: unknown;
}

export type SearchAggregateBody = 'loading' | 'blocked' | 'partial' | 'empty' | 'content';

export interface SearchAggregateRemoteState {
  body: SearchAggregateBody;
  resultCount: number;
  loadingKeys: string[];
  refreshingKeys: string[];
  staleKeys: string[];
  issues: SearchRemoteIssue[];
}

/** Resolve one entity query without conflating never-loaded and successful empty data. */
export function searchRemoteEntry(
  key: string,
  query: SearchRemoteQueryLike,
  itemCount: number,
): SearchRemoteEntry {
  if (!Number.isInteger(itemCount) || itemCount < 0) {
    throw new Error(`Search result count for ${key} must be a non-negative integer`);
  }
  const hasData = query.data !== undefined;
  return {
    key,
    hasData,
    itemCount,
    error: query.error,
    visual: resolveRemoteVisualState({
      hasData,
      empty: hasData && itemCount === 0,
      pending: query.isPending,
      fetching: query.isFetching,
      stale: query.isStale,
      fetchStatus: query.fetchStatus,
      error: query.error,
    }),
  };
}

/**
 * Compose heterogeneous entity queries while preserving every last-good response.
 * `empty` is only safe when every active entity has returned successfully at least once.
 */
export function resolveSearchAggregateRemoteState(
  entries: readonly SearchRemoteEntry[],
): SearchAggregateRemoteState {
  if (entries.length === 0) {
    throw new Error('Search aggregate state requires at least one active query');
  }

  const loadingKeys: string[] = [];
  const refreshingKeys: string[] = [];
  const staleKeys: string[] = [];
  const issues: SearchRemoteIssue[] = [];

  for (const entry of entries) {
    if (entry.visual.body === 'loading') loadingKeys.push(entry.key);
    if (entry.visual.notice === 'refreshing') refreshingKeys.push(entry.key);
    if (entry.visual.notice === 'stale') staleKeys.push(entry.key);

    if (entry.visual.body === 'offline' || entry.visual.body === 'hard-error') {
      issues.push({ key: entry.key, kind: entry.visual.body, error: entry.error });
    } else if (
      entry.visual.notice === 'cached-offline'
      || entry.visual.notice === 'cached-refresh-error'
    ) {
      issues.push({ key: entry.key, kind: entry.visual.notice, error: entry.error });
    }
  }

  const resultCount = entries.reduce((sum, entry) => sum + entry.itemCount, 0);
  const allHaveData = entries.every((entry) => entry.hasData);
  const someHaveData = entries.some((entry) => entry.hasData);
  let body: SearchAggregateBody;
  if (resultCount > 0) body = 'content';
  else if (allHaveData) body = 'empty';
  else if (someHaveData) body = 'partial';
  else if (loadingKeys.length > 0) body = 'loading';
  else body = 'blocked';

  return {
    body,
    resultCount,
    loadingKeys,
    refreshingKeys,
    staleKeys,
    issues,
  };
}
