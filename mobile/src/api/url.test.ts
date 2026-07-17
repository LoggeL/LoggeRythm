import { describe, expect, it } from 'vitest';
import { resolveServerUrl, tryResolveServerUrl } from './url';

describe('resolveServerUrl', () => {
  it('resolves API-relative media against the server origin', () => {
    expect(resolveServerUrl('/api/playlists/1/cover', 'https://music.example/base')).toBe(
      'https://music.example/api/playlists/1/cover',
    );
  });

  it('preserves absolute HTTPS media URLs', () => {
    expect(resolveServerUrl('https://cdn.example/cover.jpg', 'https://music.example')).toBe(
      'https://cdn.example/cover.jpg',
    );
  });

  it('rejects non-HTTPS media URLs', () => {
    expect(() => resolveServerUrl('file:///secret', 'https://music.example')).toThrow(
      'must use https://',
    );
    expect(() => resolveServerUrl('http://cdn.example/cover.jpg', 'https://music.example'))
      .toThrow('must use https://');
  });
});

describe('tryResolveServerUrl', () => {
  it('returns a safe URL or null without crashing a render path', () => {
    expect(tryResolveServerUrl('/avatar.png', 'https://music.example')).toBe(
      'https://music.example/avatar.png',
    );
    expect(tryResolveServerUrl('file:///secret', 'https://music.example')).toBeNull();
    expect(tryResolveServerUrl(null, 'https://music.example')).toBeNull();
  });
});
