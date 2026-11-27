import { useEffect, useRef, useState } from 'react';
import { QueryObserver, useQueryClient } from '@tanstack/react-query';
import type { Track } from '../api/types';
import { musicQueries } from '../data';
import { partyErrorDetail } from './partyErrors';

export const PARTY_SEARCH_DEBOUNCE_MS = 300;
export const PARTY_SEARCH_MIN_CHARS = 2;

export interface PartySearchState {
  query: string;
  results: Track[];
  loading: boolean;
  error: string | null;
}

interface ScopedPartySearchState extends PartySearchState {
  scope?: string;
}

export function isPartySearchableQuery(query: string): boolean {
  return Array.from(query.trim()).length >= PARTY_SEARCH_MIN_CHARS;
}

/**
 * Debounced party track search backed by a per-hook TanStack QueryObserver:
 * - enforces the 2-character minimum;
 * - preserves case & internal whitespace (outer trim only) and avoids refiring
 *   when only leading/trailing whitespace changes;
 * - detaches its own observer on supersede/clear/scope-change/unmount so
 *   TanStack Query aborts an in-flight request only when no other screen observes that key;
 * - resets prior-scope results/state cleanly when `scope` changes;
 * - guards against out-of-order commits and supports immediate retry.
 */
export function usePartySearch(
  scope: string,
): [PartySearchState, (query: string) => void, () => void] {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ScopedPartySearchState>({
    scope,
    query: '',
    results: [],
    loading: false,
    error: null,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const requestId = useRef(0);
  const activeTrimmed = useRef('');
  const activeScope = useRef(scope);
  const latestQuery = useRef('');

  const scopeChanged = state.scope !== undefined && state.scope !== scope;
  if (scopeChanged) {
    setState({ scope, query: '', results: [], loading: false, error: null });
  }

  const detachActiveSearch = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (unsubscribeRef.current !== null) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  };

  useEffect(() => {
    activeScope.current = scope;
    return () => {
      requestId.current += 1;
      activeTrimmed.current = '';
      latestQuery.current = '';
      detachActiveSearch();
    };
  }, [queryClient, scope]);

  const syncScopeIfNeeded = () => {
    if (activeScope.current !== scope) {
      activeScope.current = scope;
      activeTrimmed.current = '';
      latestQuery.current = '';
      detachActiveSearch();
    }
  };

  const executeFetch = (trimmed: string, rawQuery: string, forceRefresh: boolean) => {
    const id = ++requestId.current;
    activeTrimmed.current = trimmed;
    const baseOptions = musicQueries.searchTracks(scope, trimmed);
    const options = forceRefresh ? { ...baseOptions, staleTime: 0 } : baseOptions;
    const observer = new QueryObserver(queryClient, options);

    const handleResult = (result: ReturnType<typeof observer.getCurrentResult>) => {
      if (requestId.current !== id) return;
      if (result.fetchStatus === 'fetching') return;
      if (result.status === 'success') {
        setState({
          scope,
          query: latestQuery.current || rawQuery,
          results: result.data,
          loading: false,
          error: null,
        });
      } else if (result.status === 'error') {
        setState({
          scope,
          query: latestQuery.current || rawQuery,
          results: [],
          loading: false,
          error: partyErrorDetail(result.error),
        });
      }
    };

    unsubscribeRef.current = observer.subscribe(handleResult);
    if (forceRefresh) {
      void observer.refetch({ cancelRefetch: false }).catch(() => undefined);
    } else {
      handleResult(observer.getCurrentResult());
    }
  };

  const search = (query: string) => {
    syncScopeIfNeeded();
    latestQuery.current = query;
    const trimmed = query.trim();
    if (!isPartySearchableQuery(query)) {
      requestId.current += 1;
      detachActiveSearch();
      activeTrimmed.current = '';
      setState({ scope, query, results: [], loading: false, error: null });
      return;
    }
    if (trimmed === activeTrimmed.current) {
      setState((previous) =>
        previous.query === query && previous.scope === scope
          ? previous
          : { ...previous, scope, query },
      );
      return;
    }
    requestId.current += 1;
    detachActiveSearch();
    activeTrimmed.current = trimmed;
    setState((previous) => ({ ...previous, scope, query, loading: true, error: null }));
    const scheduledId = requestId.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (requestId.current !== scheduledId) return;
      executeFetch(trimmed, query, false);
    }, PARTY_SEARCH_DEBOUNCE_MS);
  };

  const retry = () => {
    syncScopeIfNeeded();
    const query = latestQuery.current || (scopeChanged ? '' : state.query);
    const trimmed = query.trim();
    if (!isPartySearchableQuery(query)) return;
    requestId.current += 1;
    detachActiveSearch();
    setState((previous) => ({ ...previous, scope, query, loading: true, error: null }));
    executeFetch(trimmed, query, true);
  };

  const publicState: PartySearchState = scopeChanged
    ? { query: '', results: [], loading: false, error: null }
    : {
        query: state.query,
        results: state.results,
        loading: state.loading,
        error: state.error,
      };

  return [publicState, search, retry];
}
