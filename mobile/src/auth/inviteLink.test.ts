import { describe, expect, it } from 'vitest';
import { registrationInviteFromUrl, registrationLinkFromUrl } from './inviteLink';

describe('registrationInviteFromUrl', () => {
  it.each([
    ['https://loggerythm.logge.top/register?invite=invite-123', 'invite-123'],
    ['loggerythm://register?invite=invite%20code', 'invite code'],
    ['loggerythm:///register?invite=abc', 'abc'],
  ])('accepts the production and app registration links', (url, expected) => {
    expect(registrationInviteFromUrl(url)).toBe(expected);
  });

  it.each([
    'https://evil.example/register?invite=stolen',
    'http://loggerythm.logge.top/register?invite=downgrade',
    'https://loggerythm.logge.top/login?invite=wrong-route',
    'loggerythm://album/123?invite=wrong-route',
    'not a url',
    'https://loggerythm.logge.top/register?invite=',
  ])('rejects an unrelated, untrusted, malformed, or empty link', (url) => {
    expect(registrationInviteFromUrl(url)).toBeNull();
  });

  it('recognizes an ordinary registration link without inventing an invite', () => {
    expect(registrationLinkFromUrl('https://loggerythm.logge.top/register')).toEqual({
      invite: null,
    });
  });
});
