import * as SecureStore from 'expo-secure-store';
import { normalizeSignInApiBase } from '../config';
import { strings } from '../localization';

export const PENDING_GOOGLE_OAUTH_KEY = 'lr.google.oauth.pending.v1';

export interface PendingGoogleOAuth {
  version: 1;
  serverUrl: string;
  handoffSecret: string;
  expiresAt: number;
}

export type GoogleCallbackResult =
  | { kind: 'code'; code: string }
  | { kind: 'error'; error: string };

const GOOGLE_AUTH_HOST = 'accounts.google.com';

export function validateGoogleAuthUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Google authorization URL is malformed');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== GOOGLE_AUTH_HOST) {
    throw new Error('Google authorization URL must point to https://accounts.google.com');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Google authorization URL must not contain credentials');
  }
  return parsed.toString();
}

export function parseGoogleCallbackUrl(rawUrl: string): GoogleCallbackResult | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'loggerythm:') return null;
  const isCallbackRoute =
    (parsed.hostname === 'auth' && parsed.pathname === '/google/callback')
    || (parsed.hostname === '' && parsed.pathname === '/auth/google/callback');
  if (!isCallbackRoute) return null;

  const error = parsed.searchParams.get('error')?.trim() ?? '';
  if (error.length > 0) {
    return { kind: 'error', error };
  }
  const code = parsed.searchParams.get('code')?.trim() ?? '';
  if (code.length > 0) {
    return { kind: 'code', code };
  }
  return { kind: 'error', error: 'google_auth_failed' };
}

function parsePendingGoogleOAuth(raw: string): PendingGoogleOAuth {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Stored Google OAuth state is invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Stored Google OAuth state must be an object');
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 1) {
    throw new Error('Stored Google OAuth state has an unsupported version');
  }
  if (typeof candidate.serverUrl !== 'string') {
    throw new Error('Stored Google OAuth state is missing serverUrl');
  }
  const serverUrl = normalizeSignInApiBase(candidate.serverUrl);
  if (typeof candidate.handoffSecret !== 'string' || candidate.handoffSecret.trim().length === 0) {
    throw new Error('Stored Google OAuth state is missing handoffSecret');
  }
  if (
    typeof candidate.expiresAt !== 'number'
    || !Number.isFinite(candidate.expiresAt)
    || candidate.expiresAt <= 0
  ) {
    throw new Error('Stored Google OAuth state has an invalid expiration timestamp');
  }
  return {
    version: 1,
    serverUrl,
    handoffSecret: candidate.handoffSecret,
    expiresAt: candidate.expiresAt,
  };
}

export async function savePendingGoogleOAuth(pending: PendingGoogleOAuth): Promise<void> {
  const normalized: PendingGoogleOAuth = {
    version: 1,
    serverUrl: normalizeSignInApiBase(pending.serverUrl),
    handoffSecret: pending.handoffSecret,
    expiresAt: pending.expiresAt,
  };
  await SecureStore.setItemAsync(PENDING_GOOGLE_OAUTH_KEY, JSON.stringify(normalized));
}

export async function clearPendingGoogleOAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_GOOGLE_OAUTH_KEY);
}

export async function consumePendingGoogleOAuth(
  nowMs: number = Date.now(),
): Promise<PendingGoogleOAuth | null> {
  const raw = await SecureStore.getItemAsync(PENDING_GOOGLE_OAUTH_KEY);
  if (raw === null) return null;
  await SecureStore.deleteItemAsync(PENDING_GOOGLE_OAUTH_KEY);
  const parsed = parsePendingGoogleOAuth(raw);
  if (parsed.expiresAt <= nowMs) return null;
  return parsed;
}

export function googleOAuthErrorMessage(code: string): string {
  switch (code.trim()) {
    case 'access_denied':
      return strings.auth.googleSignInCancelled;
    case 'invalid_state':
      return strings.auth.googleSessionExpired;
    case 'invalid_invite':
      return strings.auth.googleInvalidInvite;
    case 'google_email_unverified':
      return strings.auth.googleEmailUnverified;
    case 'google_account_conflict':
      return strings.auth.googleAccountConflict;
    case 'not_configured':
      return strings.auth.googleNotConfigured;
    default:
      return strings.auth.googleSignInFailed;
  }
}
