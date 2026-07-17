import { describe, expect, it } from 'vitest';
import { decodeStoredSession, parseSessionCookie, sessionCookieHeader } from './session';

describe('session cookie handling', () => {
  it('binds a captured secure cookie to the login origin', () => {
    const session = parseSessionCookie(
      'sf_session=header.payload.signature; HttpOnly; Secure; Path=/; SameSite=lax',
      'https://music.example.test/api/auth/login',
    );
    expect(session).toEqual({
      version: 1,
      token: 'header.payload.signature',
      origin: 'https://music.example.test',
      secure: true,
    });
    expect(sessionCookieHeader(session, 'https://music.example.test/api/me/likes')).toBe(
      'sf_session=header.payload.signature',
    );
  });

  it('refuses to leak a session to another origin', () => {
    const session = parseSessionCookie('sf_session=token; Path=/', 'http://10.0.2.2:8000/login');
    expect(() => sessionCookieHeader(session, 'http://192.168.1.20:8000/api/me')).toThrow(
      /different origin/,
    );
  });

  it('rejects a persisted public-HTTP session before any cookie can be restored', () => {
    const raw = JSON.stringify({
      version: 1,
      token: 'token',
      origin: 'http://music.example.test',
      secure: true,
    });
    expect(() => decodeStoredSession(raw)).toThrow(
      /canonical HTTPS origin required/,
    );
  });

  it('rejects malformed persisted session data with context', () => {
    expect(() => decodeStoredSession('{not-json')).toThrow(/Stored session is not valid JSON/);
    expect(() => decodeStoredSession('{"version":1,"token":"","origin":"x","secure":false}')).toThrow(
      /token is missing/,
    );
    expect(() => decodeStoredSession(JSON.stringify({
      version: 1,
      token: 'token',
      origin: 'https://music.example.test:0',
      secure: true,
    }))).toThrow(/Stored session origin is invalid/);
  });
});
