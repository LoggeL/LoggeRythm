/**
 * Base URL of the LoggeRythm FastAPI backend.
 *
 * Release builds must never inherit a server selected by an older/debug install.
 * Local QA builds can set EXPO_PUBLIC_API_BASE before bundling; otherwise the
 * canonical production origin is baked into the Hermes bundle.
 */
export const PRODUCTION_API_BASE = 'https://loggerythm.logge.top';
export const DEFAULT_API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? PRODUCTION_API_BASE;

export function normalizeApiBase(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new Error(`Invalid API base URL "${base}": ${(error as Error).message}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid API base URL "${base}": protocol must be http:// or https://`);
  }
  if (!parsed.hostname) {
    throw new Error(`Invalid API base URL "${base}": hostname is missing`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Invalid API base URL "${base}": embedded credentials are not allowed`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`Invalid API base URL "${base}": query strings and fragments are not allowed`);
  }
  return trimmed;
}

export async function getApiBase(): Promise<string> {
  return normalizeApiBase(DEFAULT_API_BASE);
}
