/**
 * Base URL of the LoggeRythm FastAPI backend.
 *
 * Release builds must never inherit a server selected by an older/debug install.
 * Local QA builds can set EXPO_PUBLIC_API_BASE before bundling; otherwise the
 * canonical production origin is baked into the Hermes bundle.
 */
export const PRODUCTION_API_BASE = 'https://loggerythm.logge.top';
export const MAX_API_ORIGIN_LENGTH = 512;

export function selectApiBase(
  configured: string | undefined,
  productionBuild = false,
): string {
  const selected = configured === undefined || configured.trim() === ''
    ? PRODUCTION_API_BASE
    : normalizeApiBase(configured);
  if (productionBuild && selected !== PRODUCTION_API_BASE) {
    throw new Error('Production builds must use the canonical LoggeRythm API origin');
  }
  return selected;
}

export const DEFAULT_API_BASE = selectApiBase(
  process.env.EXPO_PUBLIC_API_BASE,
  process.env.NODE_ENV === 'production',
);

let activeApiBase = DEFAULT_API_BASE;

export function normalizeApiBase(base: string): string {
  const trimmed = base.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // The value can contain credentials by mistake. Do not echo parser details,
    // which may embed the original input in device or CI logs.
    throw new Error('Invalid API base URL: malformed URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid API base URL: protocol must be http:// or https://');
  }
  if (!parsed.hostname) {
    throw new Error('Invalid API base URL: hostname is missing');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Invalid API base URL: embedded credentials are not allowed');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Invalid API base URL: query strings and fragments are not allowed');
  }
  if (parsed.pathname !== '/') {
    throw new Error('Invalid API base URL: path must be the origin root');
  }
  return parsed.origin;
}

/**
 * Validate a user-selected sign-in destination.
 *
 * User input is deliberately stricter than build-time configuration: it must
 * already be an HTTPS root URL, not a value repaired by the permissive WHATWG
 * parser. This matches the native player/session-binding contract.
 */
export function normalizeSignInApiBase(base: string): string {
  const trimmed = base.trim();
  if (
    trimmed.length === 0
    || trimmed.length > MAX_API_ORIGIN_LENGTH + 1
    || !/^https:\/\//i.test(trimmed)
  ) {
    throw new Error('Invalid sign-in server: canonical HTTPS origin required');
  }
  const authority = trimmed.slice('https://'.length).replace(/\/$/, '');
  if (
    authority.length === 0
    || /[\\/?#@\s%]/.test(authority)
    || trimmed.slice('https://'.length).replace(authority, '') !== ''
      && trimmed.slice('https://'.length).replace(authority, '') !== '/'
  ) {
    throw new Error('Invalid sign-in server: canonical HTTPS origin required');
  }
  const normalized = normalizeApiBase(base);
  const parsed = new URL(normalized);
  if (
    parsed.protocol !== 'https:'
    || parsed.port === '0'
    || normalized.length > MAX_API_ORIGIN_LENGTH
  ) {
    throw new Error('Invalid sign-in server: canonical HTTPS origin required');
  }
  return normalized;
}

/** Activate one already-validated origin for all runtime API and media paths. */
export function activateApiBase(base: string): string {
  activeApiBase = normalizeApiBase(base);
  return activeApiBase;
}

/** Synchronous access for render-time cache scopes and media URL resolution. */
export function getCurrentApiBase(): string {
  return activeApiBase;
}

/** Return the signed-out runtime to the canonical build-time default. */
export function resetApiBase(): string {
  activeApiBase = DEFAULT_API_BASE;
  return activeApiBase;
}

export async function getApiBase(): Promise<string> {
  return getCurrentApiBase();
}
