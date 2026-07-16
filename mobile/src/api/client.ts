import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getApiBase } from '../config';
import { ensureApiCompatibility } from './compatibility';
import type { DeezerId } from './types';
import {
  decodeStoredSession,
  parseSessionCookie,
  sessionCookieHeader,
  type StoredSession,
} from './session';

const SESSION_KEY = 'lr.session.v1';
const LEGACY_SESSION_KEY = 'lr.session';
const REQUEST_TIMEOUT_MS = 20_000;

let session: StoredSession | null = null;
let loaded = false;
let sessionLoad: Promise<void> | null = null;
let sessionRevision = 0;
let sessionMutation: Promise<void> = Promise.resolve();
const invalidationListeners = new Set<() => void>();

function mutateSession<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionMutation.then(operation, operation);
  sessionMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function loadSession(): Promise<void> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (raw !== null) {
    session = decodeStoredSession(raw);
    const legacyToken = await AsyncStorage.getItem(LEGACY_SESSION_KEY);
    if (legacyToken !== null) {
      await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
    }
    loaded = true;
    sessionRevision += 1;
    return;
  }

  // One-time migration from the original unencrypted AsyncStorage token.
  const legacyToken = await AsyncStorage.getItem(LEGACY_SESSION_KEY);
  if (legacyToken !== null) {
    if (legacyToken.length === 0) {
      throw new Error(`Legacy session ${LEGACY_SESSION_KEY} is empty`);
    }
    const base = await getApiBase();
    const migrated: StoredSession = {
      version: 1,
      token: legacyToken,
      origin: new URL(base).origin,
      secure: false,
    };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(migrated));
    await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
    session = migrated;
  }
  loaded = true;
  sessionRevision += 1;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (sessionLoad === null) sessionLoad = loadSession();
  try {
    await sessionLoad;
  } finally {
    sessionLoad = null;
  }
}

async function storeSession(
  next: StoredSession,
  expectedRevision: number,
): Promise<boolean> {
  return mutateSession(async () => {
    if (expectedRevision !== sessionRevision) return false;
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next));
    session = next;
    loaded = true;
    sessionRevision += 1;
    return true;
  });
}

async function deleteStoredSession(): Promise<void> {
  const failures: string[] = [];
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch (error) {
    failures.push(`SecureStore: ${(error as Error).message}`);
  }
  try {
    await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
  } catch (error) {
    failures.push(`legacy AsyncStorage: ${(error as Error).message}`);
  }
  if (failures.length > 0) {
    throw new Error(`Failed to clear the local session (${failures.join('; ')})`);
  }
}

export async function hasSession(): Promise<boolean> {
  await ensureLoaded();
  return session !== null;
}

async function removeSession(expectedRevision?: number): Promise<boolean> {
  return mutateSession(async () => {
    if (expectedRevision !== undefined && expectedRevision !== sessionRevision) return false;
    let deletionError: unknown;
    try {
      await deleteStoredSession();
    } catch (error) {
      deletionError = error;
    }
    session = null;
    loaded = true;
    sessionRevision += 1;
    if (deletionError !== undefined) throw deletionError;
    return true;
  });
}

export async function clearSession(): Promise<void> {
  await removeSession();
}

/**
 * Retry a failed on-disk deletion after an authoritative 401 invalidated the
 * in-memory session. Never delete before initial load or after a newer login.
 */
export async function retryInvalidatedSessionCleanup(): Promise<void> {
  await mutateSession(async () => {
    if (!loaded || session !== null) return;
    await deleteStoredSession();
  });
}

export function onSessionInvalidated(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

async function invalidateSession(expectedRevision: number): Promise<void> {
  let invalidated = false;
  let removalError: unknown;
  try {
    invalidated = await removeSession(expectedRevision);
  } catch (error) {
    invalidated = true;
    removalError = error;
  }
  if (invalidated) {
    for (const listener of invalidationListeners) listener();
  }
  if (removalError) throw removalError;
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

interface RequestOptions<T> {
  method?: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT' | 'TRACE';
  body?: unknown;
  /** Capture and persist the Set-Cookie session after the response body parses successfully. */
  captureSession?: boolean;
  /** Do not attach the manually managed session cookie. */
  noAuth?: boolean;
  signal?: AbortSignal;
  /** Exact generated 2xx statuses accepted for this operation. */
  successStatuses?: readonly number[];
  timeoutMs?: number;
  decode?: (value: unknown) => T;
}

function errorDetail(text: string, statusText: string): string {
  if (!text) return statusText || 'Request failed without a response body';
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
  } catch (error) {
    const excerpt = text.length > 240 ? `${text.slice(0, 240)}…` : text;
    return `Non-JSON error response (${(error as Error).message}): ${excerpt}`;
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export async function apiRequest<T>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const base = await getApiBase();
  await ensureApiCompatibility(base);
  await ensureLoaded();
  const url = `${base}${path}`;
  const method = opts.method ?? 'GET';

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const requestSession = session;
  const requestSessionRevision = sessionRevision;
  if (!opts.noAuth && requestSession !== null) {
    headers.Cookie = sessionCookieHeader(requestSession, url);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  opts.signal?.addEventListener('abort', abortFromCaller, { once: true });

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      // The JWT is managed explicitly so React Native's native cookie jar cannot
      // retain or resurrect a second, competing login.
      credentials: 'omit',
    });
  } catch (error) {
    if (timedOut) {
      throw new ApiError(0, '', `${method} ${url} timed out after ${timeoutMs} ms`);
    }
    if (opts.signal?.aborted) {
      throw new ApiError(0, '', `${method} ${url} was cancelled`);
    }
    throw new ApiError(0, '', `Network request ${method} ${url} failed: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', abortFromCaller);
  }

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 && !opts.noAuth) await invalidateSession(requestSessionRevision);
    throw new ApiError(
      res.status,
      text,
      `${method} ${path} returned ${res.status}: ${errorDetail(text, res.statusText)}`,
    );
  }

  if (opts.successStatuses !== undefined && !opts.successStatuses.includes(res.status)) {
    throw new ApiError(
      res.status,
      text,
      `${method} ${path} returned undocumented success status ${res.status}; expected ${
        opts.successStatuses.join(', ')
      }`,
    );
  }

  if (res.status === 204) {
    if (text.length > 0) {
      throw new ApiError(res.status, text, `${method} ${path} returned a body with HTTP 204`);
    }
    return undefined as T;
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

  let parsed: T;
  try {
    parsed = opts.decode ? opts.decode(json) : (json as T);
  } catch (error) {
    throw new ApiError(
      res.status,
      text,
      `${method} ${path} returned an invalid response shape: ${(error as Error).message}`,
    );
  }

  if (opts.captureSession) {
    let next: StoredSession;
    try {
      next = parseSessionCookie(res.headers.get('set-cookie'), url);
    } catch (error) {
      throw new ApiError(res.status, text, (error as Error).message);
    }
    if (!(await storeSession(next, requestSessionRevision))) {
      throw new Error('Authentication response was invalidated by a newer session transition');
    }
  }
  return parsed;
}

/** An authenticated Range-capable stream source for RNTP/ExoPlayer. */
export async function streamSource(deezerId: DeezerId): Promise<{
  uri: string;
  headers: Record<string, string>;
}> {
  const base = await getApiBase();
  await ensureApiCompatibility(base);
  await ensureLoaded();
  const uri = `${base}/api/tracks/${deezerId}/stream`;
  if (session === null) throw new Error(`Cannot stream track ${deezerId}: no authenticated session`);
  return { uri, headers: { Cookie: sessionCookieHeader(session, uri) } };
}

export async function authenticatedHeadersFor(url: string): Promise<Record<string, string>> {
  await ensureApiCompatibility(new URL(url).origin);
  await ensureLoaded();
  if (session === null) throw new Error(`Cannot authenticate ${url}: no local session`);
  return { Cookie: sessionCookieHeader(session, url) };
}
