export interface ApiErrorOptions {
  retryAfterSeconds?: number | null;
}

/**
 * Parse an HTTP `Retry-After` header (delta-seconds or IMF-fixdate) into
 * non-negative whole seconds. Returns `null` when absent or unparseable.
 */
export function parseRetryAfterSeconds(
  headerValue: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (headerValue === null || headerValue === undefined) return null;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.ceil(parsed);
  }
  const timestampMs = Date.parse(trimmed);
  if (!Number.isFinite(timestampMs)) return null;
  return Math.max(0, Math.ceil((timestampMs - nowMs) / 1_000));
}

/**
 * Extract retry-after seconds from the HTTP `Retry-After` header, or fall back
 * to structured JSON body fields (`retry_after_s` / `retry_after`) if present.
 */
export function extractRetryAfterSeconds(
  headerValue: string | null | undefined,
  body: string,
  nowMs = Date.now(),
): number | null {
  const fromHeader = parseRetryAfterSeconds(headerValue, nowMs);
  if (fromHeader !== null) return fromHeader;
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) return null;
  try {
    const parsed = JSON.parse(trimmedBody) as {
      retry_after_s?: unknown;
      retry_after?: unknown;
    };
    const candidate = parsed.retry_after_s ?? parsed.retry_after;
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      return Math.ceil(candidate);
    }
    if (typeof candidate === 'string') {
      return parseRetryAfterSeconds(candidate, nowMs);
    }
  } catch {
    // Non-JSON error bodies simply carry no structured retry-after metadata.
  }
  return null;
}

export class ApiError extends Error {
  status: number;
  body: string;
  retryAfterSeconds: number | null;

  constructor(status: number, body: string, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function isRateLimitStatus(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status?: unknown }).status === 429
  );
}

export function rateLimitRetryAfterSeconds(error: unknown): number | null {
  if (!isRateLimitStatus(error)) return null;
  const candidate = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
    return Math.ceil(candidate);
  }
  return null;
}
