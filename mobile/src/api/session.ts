import { normalizeSignInApiBase } from '../config';

export interface StoredSession {
  version: 1;
  token: string;
  origin: string;
  secure: boolean;
}

const SESSION_COOKIE = 'sf_session';

export function parseSessionCookie(setCookie: string | null, requestUrl: string): StoredSession {
  if (!setCookie) {
    throw new Error(`Login response from ${requestUrl} did not expose a Set-Cookie header`);
  }
  const match = setCookie.match(new RegExp(`(?:^|[,;]\\s*)${SESSION_COOKIE}=([^;,]+)`, 'i'));
  const token = match?.[1]?.trim();
  if (!token) {
    throw new Error(`Login response from ${requestUrl} did not contain ${SESSION_COOKIE}`);
  }
  return {
    version: 1,
    token,
    origin: new URL(requestUrl).origin,
    secure: /(?:^|;)\s*Secure\s*(?:;|$)/i.test(setCookie),
  };
}

export function decodeStoredSession(raw: string): StoredSession {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Stored session is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored session must be a JSON object');
  }
  const candidate = value as Partial<StoredSession>;
  if (candidate.version !== 1) {
    throw new Error(`Stored session has unsupported version ${String(candidate.version)}`);
  }
  if (typeof candidate.token !== 'string' || candidate.token.length === 0) {
    throw new Error('Stored session token is missing');
  }
  if (typeof candidate.origin !== 'string') {
    throw new Error('Stored session origin is missing');
  }
  try {
    if (normalizeSignInApiBase(candidate.origin) !== candidate.origin) {
      throw new Error('origin must be a canonical HTTPS origin');
    }
  } catch (error) {
    throw new Error(`Stored session origin is invalid: ${(error as Error).message}`);
  }
  if (typeof candidate.secure !== 'boolean') {
    throw new Error('Stored session Secure flag is missing');
  }
  return candidate as StoredSession;
}

export function sessionCookieHeader(session: StoredSession, requestUrl: string): string {
  const target = new URL(requestUrl);
  if (target.origin !== session.origin) {
    throw new Error(
      `Refusing to send a session for ${session.origin} to different origin ${target.origin}`,
    );
  }
  if (session.secure && target.protocol !== 'https:') {
    throw new Error(`Refusing to send a Secure session over ${target.protocol}// to ${target.host}`);
  }
  return `${SESSION_COOKIE}=${session.token}`;
}
