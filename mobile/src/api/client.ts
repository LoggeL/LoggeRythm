import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBase } from '../config';

/**
 * The backend authenticates via an HttpOnly `sf_session` JWT cookie (there is no
 * bearer-token endpoint — see api/app/auth.py). A native client has no browser
 * cookie jar it can rely on across restarts, so we capture the cookie value from
 * the login response and resend it manually on every request.
 */
const SESSION_KEY = 'lr.session';
const SESSION_COOKIE = 'sf_session';

let sessionToken: string | null = null;
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  sessionToken = await AsyncStorage.getItem(SESSION_KEY);
  loaded = true;
}

export async function getSessionToken(): Promise<string | null> {
  await ensureLoaded();
  return sessionToken;
}

async function setSessionToken(token: string | null): Promise<void> {
  sessionToken = token;
  loaded = true;
  if (token) await AsyncStorage.setItem(SESSION_KEY, token);
  else await AsyncStorage.removeItem(SESSION_KEY);
}

export async function clearSession(): Promise<void> {
  await setSessionToken(null);
}

/** Extract the `sf_session` value from a Set-Cookie header, or null if absent. */
function parseSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** When true, capture the Set-Cookie session token from the response (login/register). */
  captureSession?: boolean;
  /** Skip attaching the session cookie (public endpoints during login flow). */
  noAuth?: boolean;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  await ensureLoaded();
  const base = await getApiBase();
  const url = `${base}${path}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!opts.noAuth && sessionToken) headers['Cookie'] = `${SESSION_COOKIE}=${sessionToken}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    // Network-level failure: surface it loudly with the target so the cause is obvious.
    throw new ApiError(0, '', `Network request to ${url} failed: ${(e as Error).message}`);
  }

  if (opts.captureSession) {
    const token = parseSessionCookie(res.headers.get('set-cookie'));
    if (res.ok) {
      if (!token) {
        throw new ApiError(
          res.status,
          '',
          `Login succeeded but no ${SESSION_COOKIE} cookie was returned by ${url}. ` +
            `Cannot persist the session — check that the backend sets the cookie and that ` +
            `the response Set-Cookie header is readable on this platform.`,
        );
      }
      await setSessionToken(token);
    }
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, text, `${opts.method ?? 'GET'} ${path} → ${res.status}: ${text || res.statusText}`);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** Absolute stream URL for a track id. This endpoint is unauthenticated (MP3, Range-enabled). */
export async function streamUrl(deezerId: number): Promise<string> {
  const base = await getApiBase();
  return `${base}/api/tracks/${deezerId}/stream`;
}
