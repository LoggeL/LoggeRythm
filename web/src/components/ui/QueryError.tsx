"use client";

/** The slice of a TanStack query needed to report a failure and retry it. */
export interface RetryableQuery {
  error: Error | null;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

type RateLimitErrorShape = Error & {
  status?: unknown;
  retryAfterSec?: unknown;
  retryAfterAt?: unknown;
};

function rateLimitMessage(label: string, error: Error | null): string | null {
  const err = error as RateLimitErrorShape | null;
  if (!err || err.status !== 429) return null;
  let waitSec: number | null = null;
  if (typeof err.retryAfterAt === "number" && Number.isFinite(err.retryAfterAt)) {
    waitSec = Math.max(0, Math.ceil((err.retryAfterAt - Date.now()) / 1000));
  } else if (typeof err.retryAfterSec === "number" && Number.isFinite(err.retryAfterSec) && err.retryAfterSec >= 0) {
    waitSec = Math.ceil(err.retryAfterSec);
  }
  if (waitSec !== null && waitSec > 0) {
    const unit = waitSec === 1 ? "Sekunde" : "Sekunden";
    return `${label}: Anfragelimit erreicht – bitte in ${waitSec} ${unit} erneut versuchen.`;
  }
  return `${label}: Anfragelimit erreicht – bitte kurz warten und erneut versuchen.`;
}

/**
 * Inline failure notice with a retry action. Renders nothing while the query
 * is healthy, so it can sit unconditionally above the content it belongs to.
 * `label` names what failed, e.g. "Deine Mixe" → "Deine Mixe konnten nicht
 * geladen werden: …". Surfaces HTTP 429 rate limits with `Retry-After` guidance.
 */
export default function QueryError({ label, query, className = "" }: { label: string; query: RetryableQuery; className?: string }) {
  if (!query.isError) return null;
  const rateLimited = rateLimitMessage(label, query.error);
  return (
    <div role="alert" className={`error-panel flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <p className="min-w-0">
        {rateLimited ?? `${label} konnten nicht geladen werden: ${query.error?.message}`}
      </p>
      <button type="button" className="action-secondary min-h-9 px-4 text-xs" onClick={() => void query.refetch()} disabled={query.isFetching}>
        {query.isFetching ? "Wird geladen…" : "Erneut versuchen"}
      </button>
    </div>
  );
}
