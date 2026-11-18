"use client";

import { useDeferredValue, type ReactNode } from "react";
import QueryError, { type RetryableQuery } from "@/components/ui/QueryError";

export interface StatefulQuery<T> extends RetryableQuery {
  data: T | undefined;
  isLoading: boolean;
}

function isEmptyList(data: unknown): boolean {
  return Array.isArray(data) && data.length === 0;
}

/**
 * The four states every data view shares: a skeleton while the first load is
 * pending, an error with retry (cached content stays visible below it), an
 * empty state once the request succeeded without results, and the content.
 * `label` names the data, e.g. "Deine Playlists".
 *
 * The skeleton stays up until React can swap it for the loaded content in a
 * transition (a query result itself arrives as an urgent update), so the swap
 * cross-fades instead of replacing the placeholder in a single frame.
 */
export default function QueryState<T>({
  query,
  label,
  skeleton,
  empty,
  isEmpty = isEmptyList,
  children,
}: {
  query: StatefulQuery<T>;
  label: string;
  skeleton: ReactNode;
  empty: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  const deferredLoading = useDeferredValue(query.isLoading);
  const loading = query.isLoading || deferredLoading;
  return (
    <>
      <QueryError label={label} query={query} className="mb-4" />
      {query.isError && query.data !== undefined && <p className="mb-4 text-xs text-subtle">Der zuletzt geladene Stand bleibt sichtbar.</p>}
      {loading ? (
        <div role="status" aria-label={`${label} werden geladen`}>
          {skeleton}
        </div>
      ) : query.data === undefined ? null : isEmpty(query.data) ? (
        empty
      ) : (
        children(query.data)
      )}
    </>
  );
}
