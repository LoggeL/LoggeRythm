import type { RemoteFetchStatus } from '../../data/remoteState';

export interface CatalogQueryVisualState {
  /** A successful response exists, including a successful empty response. */
  hasData: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: RemoteFetchStatus;
  error: unknown;
}

/** The slice of a react-query result every catalog state component reads. */
export type CatalogQueryFlags = Omit<CatalogQueryVisualState, 'hasData'>;

/**
 * Picks the remote-state flags of a query so a screen spreads them once
 * instead of repeating five props per gate, section and notice:
 *
 *   <CatalogPageGate id="album" hasData={false} {...catalogQueryFlags(album)} ... />
 */
export function catalogQueryFlags(query: CatalogQueryFlags): CatalogQueryFlags {
  return {
    isPending: query.isPending,
    isFetching: query.isFetching,
    isStale: query.isStale,
    fetchStatus: query.fetchStatus,
    error: query.error,
  };
}

/** Flags of content that is part of an already loaded payload and cannot refetch on its own. */
export const settledCatalogQueryFlags: CatalogQueryFlags = {
  isPending: false,
  isFetching: false,
  isStale: false,
  fetchStatus: 'idle',
  error: null,
};
