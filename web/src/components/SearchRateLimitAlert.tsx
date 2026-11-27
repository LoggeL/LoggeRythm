"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  formatRateLimitNotice,
  retryAfterSeconds,
  subscribeCountdown,
  type RateLimitErrorLike,
} from "@/lib/rateLimit";

/**
 * Visible HTTP 429 rate-limit notice with a live `Retry-After` countdown.
 * Uses `useSyncExternalStore` (zero `useState`) so SSR stays deterministic and
 * the interval runs only while a server-requested cooldown is active.
 */
export default function SearchRateLimitAlert({
  labels,
  error,
  retryAfterSec,
  retryAfterAt,
  isFetching,
  onRetry,
  className = "",
}: {
  labels: readonly string[];
  error?: Error | null;
  retryAfterSec?: number | null;
  retryAfterAt?: number | null;
  isFetching: boolean;
  onRetry: () => Promise<unknown> | void;
  className?: string;
}) {
  const meta = error as RateLimitErrorLike | null | undefined;
  const effectiveSec =
    retryAfterSec !== undefined
      ? retryAfterSec
      : typeof meta?.retryAfterSec === "number" && Number.isFinite(meta.retryAfterSec)
        ? meta.retryAfterSec
        : null;
  const effectiveAt =
    retryAfterAt !== undefined
      ? retryAfterAt
      : typeof meta?.retryAfterAt === "number" && Number.isFinite(meta.retryAfterAt)
        ? meta.retryAfterAt
        : null;

  const subscribe = useCallback(
    (onTick: () => void) => subscribeCountdown(effectiveAt, onTick),
    [effectiveAt],
  );
  const clientSnapshot = useCallback(
    () => retryAfterSeconds({ status: 429, retryAfterSec: effectiveSec, retryAfterAt: effectiveAt }),
    [effectiveSec, effectiveAt],
  );
  const serverSnapshot = useCallback(
    () => (effectiveSec !== null && effectiveSec >= 0 ? Math.ceil(effectiveSec) : null),
    [effectiveSec],
  );
  const remaining = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const coolingDown = remaining !== null && remaining > 0;

  return (
    <div role="alert" className={`error-panel flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <p className="min-w-0 [overflow-wrap:anywhere]">
        {formatRateLimitNotice(labels, remaining)}
      </p>
      <button
        type="button"
        className="action-secondary min-h-9 px-4 text-xs max-sm:min-h-11"
        disabled={isFetching || coolingDown}
        onClick={() => void onRetry()}
      >
        {isFetching
          ? "Wird geladen…"
          : coolingDown
            ? `Erneut versuchen (${remaining} s)`
            : "Erneut versuchen"}
      </button>
    </div>
  );
}
