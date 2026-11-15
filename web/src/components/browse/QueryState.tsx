"use client";

import type { ReactNode } from "react";
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
  return (
    <>
      <QueryError label={label} query={query} className="mb-4" />
      {query.isError && query.data !== undefined && <p className="mb-4 text-xs text-subtle">Der zuletzt geladene Stand bleibt sichtbar.</p>}
      {query.isLoading ? (
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
