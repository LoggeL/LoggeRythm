import { describe, expect, it } from 'vitest';
import { parseGuestCookie } from './guestParty';

describe('parseGuestCookie', () => {
  it('extracts the sf_party_guest cookie value from a Set-Cookie header', () => {
    expect(
      parseGuestCookie(
        'sf_party_guest=abc_123-XYZ; HttpOnly; Path=/api/party/ABCDEF; SameSite=Lax; Secure',
        'https://loggerythm.logge.top/api/party/ABCDEF/guest',
      ),
    ).toBe('sf_party_guest=abc_123-XYZ');
  });

  it('throws loudly when Set-Cookie or sf_party_guest is missing', () => {
    expect(() =>
      parseGuestCookie(null, 'https://loggerythm.logge.top/api/party/ABCDEF/guest'),
    ).toThrow(/Set-Cookie/i);
    expect(() =>
      parseGuestCookie('other=123; Path=/', 'https://loggerythm.logge.top/api/party/ABCDEF/guest'),
    ).toThrow(/sf_party_guest/);
  });
});
