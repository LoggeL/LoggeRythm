/**
 * Pure HTTP 429 / `Retry-After` helpers shared by search surfaces and query retry policy.
 * Zero React/DOM imports so every Node unit & SSR test can import it directly.
 */

export interface RateLimitErrorLike {
  status?: unknown;
  retryAfterSec?: unknown;
  retryAfterAt?: unknown;
  message?: unknown;
}

export interface RetryableErrorLike {
  error: Error | null;
  isFetching: boolean;
  refetch: () => Promise<unknown> | void;
}

export interface FailureEntry<T extends RetryableErrorLike = RetryableErrorLike> {
  label: string;
  result: T;
}

export interface GroupedRateLimit {
  labels: string[];
  error: Error;
  retryAfterSec: number | null;
  retryAfterAt: number | null;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

/** True when `error` represents an HTTP 429 Too Many Requests response. */
export function isRateLimitError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as RateLimitErrorLike).status === 429,
  );
}

/**
 * Default TanStack Query retry policy: never auto-retry HTTP 429 (rate limits)
 * or 4xx client errors, which would amplify upstream quota pressure. Transient
 * 5xx/network errors on non-search queries keep a single retry.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error && typeof error === "object") {
    const status = (error as RateLimitErrorLike).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return false;
    }
  }
  return failureCount < 1;
}

/**
 * Remaining wait time in whole seconds for a rate-limit error, or `null` when
 * the server supplied no `Retry-After` duration. Returns `0` once `retryAfterAt`
 * has elapsed.
 */
export function retryAfterSeconds(error: unknown, nowMs = Date.now()): number | null {
  if (!isRateLimitError(error)) return null;
  const candidate = error as RateLimitErrorLike;
  if (typeof candidate.retryAfterAt === "number" && Number.isFinite(candidate.retryAfterAt)) {
    return Math.max(0, Math.ceil((candidate.retryAfterAt - nowMs) / 1000));
  }
  if (typeof candidate.retryAfterSec === "number" && Number.isFinite(candidate.retryAfterSec) && candidate.retryAfterSec >= 0) {
    return Math.ceil(candidate.retryAfterSec);
  }
  return null;
}

function formatGermanList(labels: readonly string[]): string {
  if (labels.length === 0) return "Suche";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} und ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} und ${labels[labels.length - 1]}`;
}

/** Clear German rate-limit copy naming affected areas and the server wait hint. */
export function formatRateLimitNotice(
  labels: readonly string[],
  remainingSec: number | null,
): string {
  const scope = formatGermanList(labels);
  if (remainingSec !== null && remainingSec > 0) {
    const unit = remainingSec === 1 ? "Sekunde" : "Sekunden";
    return `${scope}: Anfragelimit erreicht – bitte in ${remainingSec} ${unit} erneut versuchen.`;
  }
  if (remainingSec === 0) {
    return `${scope}: Anfragelimit war vorübergehend erreicht – du kannst es jetzt erneut versuchen.`;
  }
  return `${scope}: Anfragelimit erreicht – bitte kurz warten und erneut versuchen.`;
}

/**
 * Consolidates simultaneous HTTP 429 failures across catalog entities into one
 * rate-limit notice with combined retry, while keeping all non-429 errors
 * separate so every distinct failure stays visible with its exact cause.
 */
export function partitionRateLimitFailures<E extends FailureEntry<RetryableErrorLike>>(
  failures: readonly E[],
): { rateLimit: GroupedRateLimit | null; other: E[] } {
  const rateLimited: E[] = [];
  const other: E[] = [];
  for (const entry of failures) {
    if (isRateLimitError(entry.result.error)) rateLimited.push(entry);
    else other.push(entry);
  }
  if (rateLimited.length === 0) {
    return { rateLimit: null, other };
  }

  let maxSec: number | null = null;
  let maxAt: number | null = null;
  for (const { result } of rateLimited) {
    const err = result.error as RateLimitErrorLike | null;
    if (typeof err?.retryAfterSec === "number" && Number.isFinite(err.retryAfterSec)) {
      maxSec = maxSec === null ? err.retryAfterSec : Math.max(maxSec, err.retryAfterSec);
    }
    if (typeof err?.retryAfterAt === "number" && Number.isFinite(err.retryAfterAt)) {
      maxAt = maxAt === null ? err.retryAfterAt : Math.max(maxAt, err.retryAfterAt);
    }
  }

  const representativeError = rateLimited[0].result.error ?? new Error("HTTP 429");
  return {
    rateLimit: {
      labels: rateLimited.map(({ label }) => label),
      error: representativeError,
      retryAfterSec: maxSec,
      retryAfterAt: maxAt,
      isFetching: rateLimited.some(({ result }) => result.isFetching),
      refetch: () => Promise.all(rateLimited.map(({ result }) => result.refetch())),
    },
    other,
  };
}

/**
 * Browser-safe 1-second countdown subscription for `useSyncExternalStore`.
 * Starts an interval only while `retryAfterAt` is still in the future and
 * stops automatically once the cooldown expires.
 */
export function subscribeCountdown(
  retryAfterAt: number | null,
  onTick: () => void,
): () => void {
  if (
    retryAfterAt === null ||
    !Number.isFinite(retryAfterAt) ||
    typeof globalThis.setInterval !== "function" ||
    retryAfterAt <= Date.now()
  ) {
    return () => {};
  }
  const timer = globalThis.setInterval(() => {
    onTick();
    if (Date.now() >= retryAfterAt) {
      globalThis.clearInterval(timer);
    }
  }, 1_000);
  return () => {
    globalThis.clearInterval(timer);
  };
}
