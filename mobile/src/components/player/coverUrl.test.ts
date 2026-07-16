import { describe, expect, it } from 'vitest';
import { hiResCover, usableHiResCover } from './coverUrl';

describe('high-resolution cover URLs', () => {
  it('matches the production web replacement for Deezer CDN size segments', () => {
    expect(hiResCover(
      'https://cdn-images.dzcdn.net/images/cover/hash/250x250-000000-80-0-0.jpg',
    )).toBe(
      'https://cdn-images.dzcdn.net/images/cover/hash/1000x1000-000000-80-0-0.jpg',
    );
    expect(hiResCover(
      'https://e-cdns-images.dzcdn.net/images/cover/hash/56x56-000000-80-0-0.jpg',
      720,
    )).toBe(
      'https://e-cdns-images.dzcdn.net/images/cover/hash/720x720-000000-80-0-0.jpg',
    );
  });

  it('leaves nonmatching provider and Deezer API URLs unchanged', () => {
    for (const url of [
      'https://api.deezer.com/album/42/image',
      'https://images.example.test/cover/250x250.jpg',
      'https://images.example.test/cover.jpg',
    ]) {
      expect(hiResCover(url)).toBe(url);
    }
  });

  it('matches the web empty-input behavior and gives native Image a null for blank legacy fields', () => {
    expect(hiResCover(null)).toBe('');
    expect(hiResCover(undefined)).toBe('');
    expect(hiResCover('')).toBe('');
    expect(usableHiResCover('   ')).toBeNull();
    expect(usableHiResCover(null)).toBeNull();
  });
});
