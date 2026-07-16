export const MAX_SHARED_TEXT_LENGTH = 8_192;

export type SpotifyImportInputErrorCode = 'ambiguous' | 'invalid' | 'too-long';

export class SpotifyImportInputError extends Error {
  readonly code: SpotifyImportInputErrorCode;

  constructor(code: SpotifyImportInputErrorCode) {
    super(`Spotify import input is ${code}`);
    this.name = 'SpotifyImportInputError';
    this.code = code;
  }
}

const SPOTIFY_URI = /spotify:(playlist|album|track):([A-Za-z0-9]{1,128})/giu;
const SPOTIFY_WEB_URL = /https:\/\/open\.spotify\.com\/[^\s<>"']+/giu;
const TRAILING_SHARE_PUNCTUATION = /[),.;!?\]}]+$/u;

function canonicalWebUrl(candidate: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate.replace(TRAILING_SHARE_PUNCTUATION, ''));
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLocaleLowerCase('en-US') !== 'open.spotify.com' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.port.length > 0
  ) {
    return null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments[0]?.toLocaleLowerCase('en-US').startsWith('intl-')) {
    if (!/^intl-[a-z]{2}$/iu.test(segments[0])) return null;
    segments.shift();
  }
  if (segments.length !== 2) return null;
  const [rawKind, id] = segments;
  const kind = rawKind.toLocaleLowerCase('en-US');
  if (!['playlist', 'album', 'track'].includes(kind) || !/^[A-Za-z0-9]{1,128}$/u.test(id)) {
    return null;
  }
  return `https://open.spotify.com/${kind}/${id}`;
}

/**
 * Reduce pasted/share-sheet text to one canonical Spotify catalog URL.
 *
 * Android share payloads often contain a title plus a URL. Only HTTPS links
 * for the exact Spotify host (or Spotify catalog URIs) are accepted, query
 * trackers are discarded, and two different links are rejected as ambiguous.
 */
export function normalizeSpotifyImportInput(value: unknown): string {
  if (typeof value !== 'string') throw new SpotifyImportInputError('invalid');
  const input = value.trim();
  if (input.length === 0) throw new SpotifyImportInputError('invalid');
  if (input.length > MAX_SHARED_TEXT_LENGTH) throw new SpotifyImportInputError('too-long');

  const candidates = new Set<string>();
  for (const match of input.matchAll(SPOTIFY_URI)) {
    candidates.add(`https://open.spotify.com/${match[1].toLocaleLowerCase('en-US')}/${match[2]}`);
  }
  for (const match of input.matchAll(SPOTIFY_WEB_URL)) {
    const canonical = canonicalWebUrl(match[0]);
    if (canonical !== null) candidates.add(canonical);
  }

  if (candidates.size === 0) throw new SpotifyImportInputError('invalid');
  if (candidates.size > 1) throw new SpotifyImportInputError('ambiguous');
  return [...candidates][0];
}

export interface SpotifyImportRequest {
  id: number;
  accountScope: string;
  link: string | null;
  errorCode: SpotifyImportInputErrorCode | null;
}

let requestSequence = 0;
let currentRequest: SpotifyImportRequest | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

export function receiveSpotifySharedText(
  value: unknown,
  accountScope: string,
): SpotifyImportRequest {
  const normalizedAccountScope = accountScope.trim();
  if (normalizedAccountScope.length === 0) {
    throw new Error('Spotify import account scope must not be empty');
  }
  let link: string | null = null;
  let errorCode: SpotifyImportInputErrorCode | null = null;
  try {
    link = normalizeSpotifyImportInput(value);
  } catch (error) {
    errorCode = error instanceof SpotifyImportInputError ? error.code : 'invalid';
  }
  currentRequest = {
    id: ++requestSequence,
    accountScope: normalizedAccountScope,
    link,
    errorCode,
  };
  publish();
  return currentRequest;
}

export function getSpotifyImportRequest(): SpotifyImportRequest | null {
  return currentRequest;
}

export function getSpotifyImportRequestForScope(
  accountScope: string,
): SpotifyImportRequest | null {
  const normalizedAccountScope = accountScope.trim();
  if (normalizedAccountScope.length === 0) {
    throw new Error('Spotify import account scope must not be empty');
  }
  return currentRequest?.accountScope === normalizedAccountScope ? currentRequest : null;
}

export function subscribeSpotifyImportRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissSpotifyImportRequest(expectedId?: number): void {
  if (expectedId !== undefined && currentRequest?.id !== expectedId) return;
  if (currentRequest === null) return;
  currentRequest = null;
  publish();
}
