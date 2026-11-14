"use client";

/** The slice of a TanStack query needed to report a failure and retry it. */
export interface RetryableQuery {
  error: Error | null;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * Inline failure notice with a retry action. Renders nothing while the query
 * is healthy, so it can sit unconditionally above the content it belongs to.
 * `label` names what failed, e.g. "Deine Mixe" → "Deine Mixe konnten nicht
 * geladen werden: …".
 */
export default function QueryError({ label, query, className = "" }: { label: string; query: RetryableQuery; className?: string }) {
  if (!query.isError) return null;
  return (
    <div role="alert" className={`error-panel flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <p className="min-w-0">
        {label} konnten nicht geladen werden: {query.error?.message}
      </p>
      <button type="button" className="action-secondary min-h-9 px-4 text-xs" onClick={() => void query.refetch()} disabled={query.isFetching}>
        {query.isFetching ? "Wird geladen…" : "Erneut versuchen"}
      </button>
    </div>
  );
}
