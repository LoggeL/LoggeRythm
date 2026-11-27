import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import {
  clearPendingGoogleOAuth,
  consumePendingGoogleOAuth,
  googleOAuthErrorMessage,
  parseGoogleCallbackUrl,
  PENDING_GOOGLE_OAUTH_KEY,
  savePendingGoogleOAuth,
  validateGoogleAuthUrl,
} from './googleOAuth';

const mocks = vi.hoisted(() => ({
  secureStore: {
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
  },
}));

vi.mock('expo-secure-store', () => mocks.secureStore);

describe('googleOAuth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.secureStore.getItemAsync.mockResolvedValue(null);
    mocks.secureStore.setItemAsync.mockResolvedValue(undefined);
    mocks.secureStore.deleteItemAsync.mockResolvedValue(undefined);
  });

  it('validates Google authorization URLs strictly', () => {
    expect(
      validateGoogleAuthUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=123'),
    ).toBe('https://accounts.google.com/o/oauth2/v2/auth?client_id=123');

    for (const bad of [
      'not-a-url',
      'http://accounts.google.com/o/oauth2/v2/auth',
      'https://evil.example/o/oauth2/v2/auth',
      'https://accounts.google.com.evil.example/o/oauth2/v2/auth',
      'https://user:pass@accounts.google.com/o/oauth2/v2/auth',
    ]) {
      expect(() => validateGoogleAuthUrl(bad)).toThrow();
    }
  });

  it('parses app-scheme callback URLs and ignores unrelated links', () => {
    expect(parseGoogleCallbackUrl('loggerythm://auth/google/callback?code=abc123')).toEqual({
      kind: 'code',
      code: 'abc123',
    });
    expect(parseGoogleCallbackUrl('loggerythm:///auth/google/callback?code=xyz')).toEqual({
      kind: 'code',
      code: 'xyz',
    });
    expect(
      parseGoogleCallbackUrl('loggerythm://auth/google/callback?error=access_denied'),
    ).toEqual({
      kind: 'error',
      error: 'access_denied',
    });
    expect(parseGoogleCallbackUrl('loggerythm://auth/google/callback')).toEqual({
      kind: 'error',
      error: 'google_auth_failed',
    });

    expect(parseGoogleCallbackUrl('loggerythm://register?invite=INV1')).toBeNull();
    expect(
      parseGoogleCallbackUrl('https://loggerythm.logge.top/auth/google/callback?code=abc'),
    ).toBeNull();
    expect(parseGoogleCallbackUrl('not-a-url')).toBeNull();
  });

  it('saves, consumes single-use, expires, and rejects corrupted SecureStore state', async () => {
    const pending = {
      version: 1 as const,
      serverUrl: 'https://loggerythm.logge.top/',
      handoffSecret: 'secret-value-1234567890',
      expiresAt: 10_000,
    };
    await savePendingGoogleOAuth(pending);
    expect(mocks.secureStore.setItemAsync).toHaveBeenCalledWith(
      PENDING_GOOGLE_OAUTH_KEY,
      JSON.stringify({
        version: 1,
        serverUrl: 'https://loggerythm.logge.top',
        handoffSecret: 'secret-value-1234567890',
        expiresAt: 10_000,
      }),
    );

    mocks.secureStore.getItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        serverUrl: 'https://loggerythm.logge.top',
        handoffSecret: 'secret-value-1234567890',
        expiresAt: 10_000,
      }),
    );
    await expect(consumePendingGoogleOAuth(5_000)).resolves.toEqual({
      version: 1,
      serverUrl: 'https://loggerythm.logge.top',
      handoffSecret: 'secret-value-1234567890',
      expiresAt: 10_000,
    });
    expect(mocks.secureStore.deleteItemAsync).toHaveBeenCalledWith(PENDING_GOOGLE_OAUTH_KEY);

    // Expired entry is still deleted and returns null.
    mocks.secureStore.getItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        serverUrl: 'https://loggerythm.logge.top',
        handoffSecret: 'secret-value-1234567890',
        expiresAt: 10_000,
      }),
    );
    await expect(consumePendingGoogleOAuth(10_000)).resolves.toBeNull();
    expect(mocks.secureStore.deleteItemAsync).toHaveBeenCalledTimes(2);

    // Corrupted JSON is deleted and fails loudly.
    mocks.secureStore.getItemAsync.mockResolvedValueOnce('{broken');
    await expect(consumePendingGoogleOAuth(5_000)).rejects.toThrow(/invalid JSON/);
    expect(mocks.secureStore.deleteItemAsync).toHaveBeenCalledTimes(3);

    await clearPendingGoogleOAuth();
    expect(mocks.secureStore.deleteItemAsync).toHaveBeenCalledTimes(4);
  });

  it('maps callback error codes to localized copy', () => {
    expect(googleOAuthErrorMessage('access_denied')).toBe(strings.auth.googleSignInCancelled);
    expect(googleOAuthErrorMessage('invalid_state')).toBe(strings.auth.googleSessionExpired);
    expect(googleOAuthErrorMessage('invalid_invite')).toBe(strings.auth.googleInvalidInvite);
    expect(googleOAuthErrorMessage('google_email_unverified')).toBe(
      strings.auth.googleEmailUnverified,
    );
    expect(googleOAuthErrorMessage('google_account_conflict')).toBe(
      strings.auth.googleAccountConflict,
    );
    expect(googleOAuthErrorMessage('not_configured')).toBe(strings.auth.googleNotConfigured);
    expect(googleOAuthErrorMessage('anything_else')).toBe(strings.auth.googleSignInFailed);
  });
});
