import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  activateApiBase,
  getApiBase,
  normalizeSignInApiBase,
  PRODUCTION_API_BASE,
  resetApiBase,
} from '../config';
import {
  ensureApiCompatibility,
  resetApiCompatibilityCheck,
} from './compatibility';
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

declare const authenticatedRequestAuthorityBrand: unique symbol;
declare const sessionInvalidationAuthorityBrand: unique symbol;

/**
 * Process-local proof that a request is still using the exact authenticated
 * session captured by its caller. It deliberately has no enumerable state and
 * cannot be persisted or reconstructed outside this module.
 */
export interface AuthenticatedRequestAuthority {
  readonly [authenticatedRequestAuthorityBrand]: true;
}

/**
 * Process-local proof that one exact session generation was authoritatively
 * invalidated. UI and Headless JS receive the same object and therefore share
 * one cleanup boundary without exposing a token, cookie, or numeric revision.
 */
export interface SessionInvalidationAuthority {
  readonly [sessionInvalidationAuthorityBrand]: true;
}

interface SessionAuthorityRecord {
  readonly revision: number;
  readonly storedSession: StoredSession | null;
}

interface SessionInvalidationRecord {
  readonly authority: SessionInvalidationAuthority;
  readonly cleanupComplete: Promise<void>;
  resolveCleanup(): void;
  cleanupInFlight: Promise<void> | null;
}

let currentSessionAuthority: SessionAuthorityRecord | null = null;
let pendingSessionInvalidation: SessionInvalidationRecord | null = null;
const authenticatedRequestAuthorities =
  new WeakMap<object, Readonly<SessionAuthorityRecord>>();
const sessionInvalidationAuthorities =
  new WeakMap<object, SessionInvalidationRecord>();
const apiErrorInvalidationAuthorities =
  new WeakMap<ApiError, SessionInvalidationAuthority>();
const invalidationListeners =
  new Set<(authority: SessionInvalidationAuthority) => void>();

export class AuthenticatedRequestAuthorityError extends Error {
  constructor() {
    super('Authenticated request authority is no longer current');
    this.name = 'AuthenticatedRequestAuthorityError';
  }
}

function rotateSessionAuthority(): Readonly<SessionAuthorityRecord> {
  sessionRevision += 1;
  const authority = Object.freeze({
    revision: sessionRevision,
    storedSession: session,
  });
  currentSessionAuthority = authority;
  return authority;
}

function requireCurrentSessionAuthority(): Readonly<SessionAuthorityRecord> {
  if (currentSessionAuthority === null) {
    throw new Error('Session authority is unavailable before initial load');
  }
  return currentSessionAuthority;
}

function createAuthenticatedRequestAuthority(
  authority: Readonly<SessionAuthorityRecord>,
): AuthenticatedRequestAuthority {
  const guard = Object.freeze({}) as AuthenticatedRequestAuthority;
  authenticatedRequestAuthorities.set(guard, authority);
  return guard;
}

function resolveAuthenticatedRequestAuthority(
  guard: AuthenticatedRequestAuthority,
): Readonly<SessionAuthorityRecord> {
  const authority = authenticatedRequestAuthorities.get(guard);
  if (
    authority === undefined
    || authority !== currentSessionAuthority
    || authority.storedSession === null
  ) {
    throw new AuthenticatedRequestAuthorityError();
  }
  return authority;
}

function newSessionInvalidationAuthority(): SessionInvalidationRecord {
  let resolveCleanup!: () => void;
  const cleanupComplete = new Promise<void>((resolve) => {
    resolveCleanup = resolve;
  });
  const authority = Object.freeze({}) as SessionInvalidationAuthority;
  const record: SessionInvalidationRecord = {
    authority,
    cleanupComplete,
    resolveCleanup,
    cleanupInFlight: null,
  };
  sessionInvalidationAuthorities.set(authority, record);
  pendingSessionInvalidation = record;
  return record;
}

async function waitForPendingSessionInvalidation(): Promise<void> {
  const pending = pendingSessionInvalidation;
  if (pending !== null) await pending.cleanupComplete;
}

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
    activateApiBase(session.origin);
    const legacyToken = await AsyncStorage.getItem(LEGACY_SESSION_KEY);
    if (legacyToken !== null) {
      await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
    }
    loaded = true;
    rotateSessionAuthority();
    return;
  }

  // One-time migration from the original unencrypted AsyncStorage token.
  const legacyToken = await AsyncStorage.getItem(LEGACY_SESSION_KEY);
  if (legacyToken !== null) {
    if (legacyToken.length === 0) {
      throw new Error(`Legacy session ${LEGACY_SESSION_KEY} is empty`);
    }
    const migrated: StoredSession = {
      version: 1,
      token: legacyToken,
      // A legacy token has no trustworthy server identity. Bind it only to the
      // canonical production origin, never to a form-entered custom server.
      origin: PRODUCTION_API_BASE,
      secure: false,
    };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(migrated));
    await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
    session = migrated;
  }
  loaded = true;
  rotateSessionAuthority();
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
  expectedAuthority: Readonly<SessionAuthorityRecord>,
): Promise<boolean> {
  // An authoritative invalidation reserves the account boundary before its
  // listeners run. A replacement credential cannot commit until player,
  // offline identity, and on-disk session cleanup have all succeeded.
  await waitForPendingSessionInvalidation();
  return mutateSession(async () => {
    if (expectedAuthority !== currentSessionAuthority) return false;
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next));
    session = next;
    activateApiBase(next.origin);
    loaded = true;
    rotateSessionAuthority();
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

interface SessionRemovalResult {
  readonly removed: boolean;
  readonly deletionError?: unknown;
  readonly invalidationAuthority?: SessionInvalidationAuthority;
}

async function removeSession(
  expectedAuthority?: Readonly<SessionAuthorityRecord>,
  reserveInvalidationCleanup = false,
): Promise<SessionRemovalResult> {
  return mutateSession(async () => {
    if (
      expectedAuthority !== undefined
      && expectedAuthority !== currentSessionAuthority
    ) {
      return { removed: false };
    }
    let deletionError: unknown;
    try {
      await deleteStoredSession();
    } catch (error) {
      deletionError = error;
    }
    session = null;
    resetApiBase();
    loaded = true;
    rotateSessionAuthority();
    const invalidationAuthority = reserveInvalidationCleanup
      ? newSessionInvalidationAuthority().authority
      : undefined;
    return {
      removed: true,
      ...(deletionError === undefined ? {} : { deletionError }),
      ...(invalidationAuthority === undefined ? {} : { invalidationAuthority }),
    };
  });
}

export async function clearSession(): Promise<void> {
  const result = await removeSession();
  if (result.deletionError !== undefined) throw result.deletionError;
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

export function onSessionInvalidated(
  listener: (authority: SessionInvalidationAuthority) => void,
): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

async function invalidateSession(
  expectedAuthority: Readonly<SessionAuthorityRecord>,
): Promise<SessionInvalidationAuthority | null> {
  const result = await removeSession(expectedAuthority, true);
  const authority = result.invalidationAuthority ?? null;
  if (result.removed && authority !== null) {
    for (const listener of invalidationListeners) {
      try {
        listener(authority);
      } catch {
        // One mounted consumer must not prevent Headless JS or another listener
        // from receiving the same opaque cleanup authority.
      }
    }
  }
  return authority;
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

export function authoritativeSessionInvalidationFor(
  error: unknown,
): SessionInvalidationAuthority | null {
  return error instanceof ApiError
    ? apiErrorInvalidationAuthorities.get(error) ?? null
    : null;
}

export function isAuthenticatedRequestAuthorityError(
  error: unknown,
): error is AuthenticatedRequestAuthorityError {
  return error instanceof AuthenticatedRequestAuthorityError;
}

export async function captureAuthenticatedRequestAuthority():
Promise<AuthenticatedRequestAuthority> {
  await ensureLoaded();
  const authority = requireCurrentSessionAuthority();
  if (authority.storedSession === null) {
    throw new AuthenticatedRequestAuthorityError();
  }
  return createAuthenticatedRequestAuthority(authority);
}

export function pendingInvalidationAuthority(): SessionInvalidationAuthority | null {
  return pendingSessionInvalidation?.authority ?? null;
}

/**
 * Execute an authority cleanup only while its exact invalidation is pending.
 * Successful completion releases waiting session commits; failures retain the
 * opaque authority so the same boundary can be retried without admitting a new
 * credential over partially erased account state.
 */
export function runWithSessionInvalidationAuthority(
  authority: SessionInvalidationAuthority,
  operation: () => Promise<void>,
): Promise<void> {
  const record = sessionInvalidationAuthorities.get(authority);
  if (record === undefined || record !== pendingSessionInvalidation) {
    return Promise.resolve();
  }
  if (record.cleanupInFlight !== null) return record.cleanupInFlight;
  const attempt = operation();
  record.cleanupInFlight = attempt;
  const releaseAttempt = (): void => {
    if (record.cleanupInFlight === attempt) record.cleanupInFlight = null;
  };
  void attempt.then(
    () => {
      releaseAttempt();
      if (pendingSessionInvalidation === record) {
        pendingSessionInvalidation = null;
        record.resolveCleanup();
      }
    },
    releaseAttempt,
  );
  return attempt;
}

interface RequestOptions<T> {
  method?: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT' | 'TRACE';
  body?: unknown;
  /** Capture and persist the Set-Cookie session after the response body parses successfully. */
  captureSession?: boolean;
  /** Explicit signed-out authentication origin; forbidden for ordinary requests. */
  apiBase?: string;
  /** Do not attach the manually managed session cookie. */
  noAuth?: boolean;
  signal?: AbortSignal;
  /** Exact generated 2xx statuses accepted for this operation. */
  successStatuses?: readonly number[];
  /** Canonical UUID used by replay-safe mutation endpoints. */
  idempotencyKey?: string;
  /** Bind this request to one exact process-local authenticated session. */
  authenticatedRequestAuthority?: AuthenticatedRequestAuthority;
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
  await ensureLoaded();
  if (
    opts.apiBase !== undefined
    && (
      !opts.noAuth
      || (!opts.captureSession && path !== '/api/auth/logout')
    )
  ) {
    throw new Error('An explicit API base is allowed only for authentication lifecycle requests');
  }
  const base = opts.apiBase === undefined
    ? await getApiBase()
    : normalizeSignInApiBase(opts.apiBase);
  if (opts.apiBase !== undefined && opts.captureSession) {
    resetApiCompatibilityCheck(base);
  }
  await ensureApiCompatibility(base);
  const url = `${base}${path}`;
  const method = opts.method ?? 'GET';

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = opts.idempotencyKey;
  }
  const requestAuthority = opts.authenticatedRequestAuthority === undefined
    ? requireCurrentSessionAuthority()
    : resolveAuthenticatedRequestAuthority(opts.authenticatedRequestAuthority);
  const requestSession = requestAuthority.storedSession;
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
      // Never forward credentials or account identifiers through an HTTP
      // redirect chosen by a server.
      redirect: 'error',
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
    let invalidationAuthority: SessionInvalidationAuthority | null = null;
    if (res.status === 401 && !opts.noAuth && requestSession !== null) {
      invalidationAuthority = await invalidateSession(requestAuthority);
    }
    const error = new ApiError(
      res.status,
      text,
      `${method} ${path} returned ${res.status}: ${errorDetail(text, res.statusText)}`,
    );
    if (invalidationAuthority !== null) {
      apiErrorInvalidationAuthorities.set(error, invalidationAuthority);
    }
    throw error;
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
    if (!(await storeSession(next, requestAuthority))) {
      throw new Error('Authentication response was invalidated by a newer session transition');
    }
  }
  return parsed;
}

/** An authenticated Range-capable stream source for the Media3 player. */
export async function streamSource(deezerId: DeezerId): Promise<{
  uri: string;
  headers: Record<string, string>;
}> {
  await ensureLoaded();
  const base = await getApiBase();
  await ensureApiCompatibility(base);
  const uri = `${base}/api/tracks/${deezerId}/stream`;
  if (session === null) throw new Error(`Cannot stream track ${deezerId}: no authenticated session`);
  return { uri, headers: { Cookie: sessionCookieHeader(session, uri) } };
}

export async function authenticatedHeadersFor(
  url: string,
  authority?: AuthenticatedRequestAuthority,
): Promise<Record<string, string>> {
  await ensureApiCompatibility(new URL(url).origin);
  await ensureLoaded();
  const exactAuthority = authority === undefined
    ? requireCurrentSessionAuthority()
    : resolveAuthenticatedRequestAuthority(authority);
  if (exactAuthority.storedSession === null) {
    throw new Error(`Cannot authenticate ${url}: no local session`);
  }
  return { Cookie: sessionCookieHeader(exactAuthority.storedSession, url) };
}

/**
 * Cold Headless JS must restore the session-bound origin before any controller
 * path reads the synchronous runtime base.
 */
export async function hydrateApiBaseFromStoredSession(): Promise<string> {
  await ensureLoaded();
  return getApiBase();
}
