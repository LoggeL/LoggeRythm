"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import QueryError, { type RetryableQuery } from "@/components/ui/QueryError";
import EmptyState from "@/components/ui/EmptyState";

/** Loading placeholder with the shape of a collection page. */
export function CollectionSkeleton({ round = false }: { round?: boolean }) {
  return (
    <div>
      <DetailHeaderSkeleton round={round} />
      <RowListSkeleton />
    </div>
  );
}

/** The slice of a TanStack query a detail page needs to pick its state. */
export interface CollectionQuery<T> extends RetryableQuery {
  data: T | undefined;
  isLoading: boolean;
  fetchStatus?: "fetching" | "paused" | "idle";
}

/**
 * Loading / error / missing handling shared by the detail pages. Renders the
 * skeleton while loading (`skeleton` replaces the collection-shaped default
 * on pages with their own header), a retryable error when the first load failed, and
 * otherwise `children(data)` — with the error shown above the last loaded
 * state when only a refresh failed.
 *
 * `label` completes "… konnten nicht geladen werden", so use a plural noun
 * ("Albumdaten"). `missing` is the title for a collection that does not exist.
 */
export default function CollectionPageState<T>({
  query,
  label,
  missing,
  round = false,
  skeleton,
  children,
}: {
  query: CollectionQuery<T>;
  label: string;
  missing: string;
  round?: boolean;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return skeleton === undefined ? <CollectionSkeleton round={round} /> : skeleton;
  if (query.data === undefined) {
    if (query.isError) return <QueryError label={label} query={query} />;
    if (query.fetchStatus === "paused") {
      return (
        <EmptyState
          title="Keine Verbindung"
          action={
            <button type="button" className="action-secondary" onClick={() => void query.refetch()}>
              Erneut versuchen
            </button>
          }
        >
          {label} werden geladen, sobald du wieder online bist.
        </EmptyState>
      );
    }
    return (
      <EmptyState
        title={missing}
        action={
          <Link href="/" className="action-secondary">
            Zur Startseite
          </Link>
        }
      >
        Der Link ist möglicherweise veraltet oder der Inhalt wurde entfernt.
      </EmptyState>
    );
  }
  return (
    <div>
      <QueryError label={label} query={query} className="mb-4" />
      {children(query.data)}
    </div>
  );
}
