/**
 * Base URL of the LoggeRythm FastAPI backend.
 *
 * Release builds must never inherit a server selected by an older/debug install.
 * Local QA builds can set EXPO_PUBLIC_API_BASE before bundling; otherwise the
 * canonical production origin is baked into the Hermes bundle.
 */
export const PRODUCTION_API_BASE = 'https://loggerythm.logge.top';

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

export async function getApiBase(): Promise<string> {
  return normalizeApiBase(DEFAULT_API_BASE);
}
