"use client";

import Link from "next/link";
import { useDeferredValue, useState, type ReactNode } from "react";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import Cover from "@/components/ui/Cover";
import { HeroEntrance, useMorphSeed } from "@/components/motion/Morph";
import CollectionHero from "./CollectionHero";
import QueryError, { type RetryableQuery } from "@/components/ui/QueryError";
import EmptyState from "@/components/ui/EmptyState";

/**
 * Loading placeholder with the shape of a collection page. Opened from a card,
 * it already shows that card's artwork and title in the real header, so both
 * can travel over from the card and stay in place once the data arrives.
 */
export function CollectionSkeleton({ round = false }: { round?: boolean }) {
  const seed = useMorphSeed();
  return (
    <div>
      {seed ? (
        <div role="status" aria-label="Wird geladen">
          <CollectionHero
            eyebrow={<span className="skeleton inline-block h-3 w-16 rounded" />}
            title={seed.title}
            coverUrl={seed.cover}
            artwork={<Cover src={seed.cover} eager />}
            metadata={seed.subtitle ?? <span className="skeleton inline-block h-4 w-44 max-w-full rounded align-middle" />}
            actions={
              <>
                <div className="skeleton h-14 w-14 rounded-full" />
                <div className="skeleton h-11 w-11 rounded-[var(--radius-control)]" />
                <div className="skeleton h-11 w-11 rounded-[var(--radius-control)]" />
              </>
            }
          />
        </div>
      ) : (
        <DetailHeaderSkeleton round={round} />
      )}
      <RowListSkeleton />
    </div>
  );
}

/**
 * Keeps a loading placeholder up until React can swap it for the loaded
 * content in a transition. Query results arrive as urgent updates, which would
 * replace the placeholder in a single frame; deferred, the swap cross-fades
 * (and waits for a route transition that is still running).
 */
export function useLoadingPlaceholder(loading: boolean): boolean {
  const deferred = useDeferredValue(loading);
  return loading || deferred;
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
  const loading = useLoadingPlaceholder(query.isLoading);
  // A hero that replaces the placeholder's must not rise in a second time.
  const [placeholderShown, setPlaceholderShown] = useState(loading);
  if (loading && !placeholderShown) setPlaceholderShown(true);
  if (loading) return skeleton === undefined ? <CollectionSkeleton round={round} /> : skeleton;
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
    <HeroEntrance value={!placeholderShown}>
      <div>
        <QueryError label={label} query={query} className="mb-4" />
        {children(query.data)}
      </div>
    </HeroEntrance>
  );
}
