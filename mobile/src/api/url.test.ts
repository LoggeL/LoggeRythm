import { describe, expect, it } from 'vitest';
import { resolveServerUrl } from './url';

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

  it('rejects non-HTTP media URLs', () => {
    expect(() => resolveServerUrl('file:///secret', 'https://music.example')).toThrow(
      'must use http:// or https://',
    );
  });
});
