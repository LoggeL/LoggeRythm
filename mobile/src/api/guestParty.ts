import { normalizeSignInApiBase } from '../config';
import { ensureApiCompatibility } from './compatibility';
import { decodePartyState, decodeTrackList } from './decoders';
import { ApiError } from './error';
import type { PartyState, Track, TrackInput } from './types';

const PARTY_GUEST_COOKIE = 'sf_party_guest';
const REQUEST_TIMEOUT_MS = 20_000;

export interface GuestPartySession {
  readonly origin: string;
  readonly code: string;
  readonly cookieHeader: string;
}

export function parseGuestCookie(setCookie: string | null, requestUrl: string): string {
  if (!setCookie) {
    throw new Error(`Guest join response from ${requestUrl} did not expose a Set-Cookie header`);
  }
  const match = setCookie.match(new RegExp(`(?:^|[,;]\\s*)${PARTY_GUEST_COOKIE}=([^;,]+)`, 'i'));
  const token = match?.[1]?.trim();
  if (!token) {
    throw new Error(`Guest join response from ${requestUrl} did not contain ${PARTY_GUEST_COOKIE}`);
  }
  return `${PARTY_GUEST_COOKIE}=${token}`;
}

function errorDetail(text: string, statusText: string): string {
  if (!text) return statusText || 'Request failed without a response body';
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string' && parsed.detail.trim().length > 0) {
      return parsed.detail;
    }
  } catch {
    // Non-JSON body: fall back to a bounded excerpt below.
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

async function guestFetch<T>(params: {
  origin: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  cookieHeader?: string;
  signal?: AbortSignal;
  expectNoContent?: boolean;
  decode?: (value: unknown) => T;
}): Promise<{ data: T; setCookie: string | null; url: string }> {
  const {
    origin,
    path,
    method = 'GET',
    body,
    cookieHeader,
    signal,
    expectNoContent = false,
    decode,
  } = params;
  await ensureApiCompatibility(origin);
  const url = `${origin}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookieHeader !== undefined) headers.Cookie = cookieHeader;

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) controller.abort();

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
    });
    text = await res.text();
  } catch (error) {
    if (timedOut) {
      throw new ApiError(0, '', `${method} ${url} timed out after ${REQUEST_TIMEOUT_MS} ms`);
    }
    if (signal?.aborted) {
      throw new ApiError(0, '', `${method} ${url} was cancelled`);
    }
    throw new ApiError(0, '', `Network request ${method} ${url} failed: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      text,
      `${method} ${path} returned ${res.status}: ${errorDetail(text, res.statusText)}`,
    );
  }
  if (expectNoContent || res.status === 204) {
    return { data: undefined as T, setCookie: res.headers.get('set-cookie'), url };
  }
  if (text.length === 0) {
    throw new ApiError(res.status, text, `${method} ${path} returned an empty success response`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ApiError(
      res.status,
      text,
      `${method} ${path} returned invalid JSON: ${(error as Error).message}`,
    );
  }
  const data = decode ? decode(json) : (json as T);
  return { data, setCookie: res.headers.get('set-cookie'), url };
}

/** Join an active Jam anonymously with a nickname and capture its path-scoped guest cookie. */
export async function joinPartyAsGuest(
  code: string,
  nickname: string,
  apiBase: string,
): Promise<{ session: GuestPartySession; state: PartyState }> {
  const origin = normalizeSignInApiBase(apiBase);
  const encodedCode = encodeURIComponent(code);
  const { data, setCookie, url } = await guestFetch<PartyState>({
    origin,
    path: `/api/party/${encodedCode}/guest`,
    method: 'POST',
    body: { nickname: nickname.trim() },
    decode: decodePartyState,
  });
  const cookieHeader = parseGuestCookie(setCookie, url);
  return {
    session: { origin, code: data.code, cookieHeader },
    state: data,
  };
}

/** Refresh a guest's active Jam state using their party-scoped cookie. */
export async function getGuestPartyState(
  session: GuestPartySession,
  signal?: AbortSignal,
): Promise<PartyState> {
  const { data } = await guestFetch<PartyState>({
    origin: session.origin,
    path: `/api/party/${encodeURIComponent(session.code)}`,
    cookieHeader: session.cookieHeader,
    signal,
    decode: decodePartyState,
  });
  return data;
}

/** Search catalog tracks without requiring a user account so guests can queue songs. */
export async function guestSearchTracks(
  origin: string,
  query: string,
  signal?: AbortSignal,
): Promise<Track[]> {
  const { data } = await guestFetch<Track[]>({
    origin,
    path: `/api/search?q=${encodeURIComponent(query)}&type=track`,
    signal,
    decode: decodeTrackList,
  });
  return data;
}

/** Queue a track in the active Jam as an anonymous guest. */
export async function guestAddPartyTrack(
  session: GuestPartySession,
  track: TrackInput,
): Promise<void> {
  await guestFetch<void>({
    origin: session.origin,
    path: `/api/party/${encodeURIComponent(session.code)}/tracks`,
    method: 'POST',
    body: track,
    cookieHeader: session.cookieHeader,
    expectNoContent: true,
  });
}

/** Leave the active Jam cleanly and invalidate the server-side guest record. */
export async function guestLeaveParty(session: GuestPartySession): Promise<void> {
  await guestFetch<void>({
    origin: session.origin,
    path: `/api/party/${encodeURIComponent(session.code)}/leave`,
    method: 'POST',
    cookieHeader: session.cookieHeader,
    expectNoContent: true,
  });
}
