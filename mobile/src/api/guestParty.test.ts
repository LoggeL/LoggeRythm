import { describe, expect, it, vi } from 'vitest';
import type { Track } from './types';
import { parseGuestCookie } from './guestParty';
import { createGuestSearchCache } from './guestSearchCache';

function sampleTrack(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    artist_id: '1',
    artists: [{ id: '1', name: 'Artist' }],
    album: 'Album',
    album_id: '2',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 0,
    release_date: '',
  };
}

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

describe('origin-scoped guest search cache', () => {
  it('isolates origins, outer-trims while preserving case/internal whitespace, and deduplicates in-flight calls', async () => {
    const cache = createGuestSearchCache(60_000);
    let resolveFirst!: (tracks: Track[]) => void;
    const firstPromise = new Promise<Track[]>((resolve) => { resolveFirst = resolve; });
    const fetcher = vi.fn((origin: string, query: string) => {
      if (origin === 'https://a.example' && query === 'Daft Punk') return firstPromise;
      return Promise.resolve([sampleTrack(`${origin}:${query}`)]);
    });

    const p1 = cache.search('https://a.example', '  Daft Punk  ', fetcher);
    const p2 = cache.search('https://a.example', 'Daft Punk', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveFirst([sampleTrack('shared')]);
    await expect(Promise.all([p1, p2])).resolves.toEqual([
      [sampleTrack('shared')],
      [sampleTrack('shared')],
    ]);

    // Cached hit for identical outer-trimmed query on the same origin.
    await expect(cache.search('https://a.example', ' Daft Punk ', fetcher)).resolves.toEqual([
      sampleTrack('shared'),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Distinct origin, case, and internal whitespace never mix cache entries.
    await expect(cache.search('https://b.example', 'Daft Punk', fetcher)).resolves.toEqual([
      sampleTrack('https://b.example:Daft Punk'),
    ]);
    await expect(cache.search('https://a.example', 'daft punk', fetcher)).resolves.toEqual([
      sampleTrack('https://a.example:daft punk'),
    ]);
    await expect(cache.search('https://a.example', 'Daft  Punk', fetcher)).resolves.toEqual([
      sampleTrack('https://a.example:Daft  Punk'),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);

    // Clearing one origin removes only that origin's entries.
    cache.clear('https://a.example');
    await cache.search('https://b.example', 'Daft Punk', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('never caches failed searches, aborts when all waiters cancel, and emits zero unhandled rejections', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const cache = createGuestSearchCache(60_000);
      let capturedSignal: AbortSignal | undefined;
      const abortableFetcher = vi.fn((_origin: string, _query: string, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise<Track[]>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      });

      const controller = new AbortController();
      const pending = cache.search('https://a.example', 'daft', abortableFetcher, controller.signal);
      controller.abort();
      await expect(pending).rejects.toThrow(/cancelled/);
      expect(capturedSignal?.aborted).toBe(true);

      const rateLimitedFetcher = vi.fn(async () => {
        throw new Error('429 rate limited');
      });
      await expect(cache.search('https://a.example', 'daft', rateLimitedFetcher))
        .rejects.toThrow('429 rate limited');

      // Flush microtasks/timers so any unhandledRejection would have fired.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);

      const retryFetcher = vi.fn(async () => [sampleTrack('ok')]);
      await expect(cache.search('https://a.example', 'daft', retryFetcher)).resolves.toEqual([
        sampleTrack('ok'),
      ]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('never repopulates a cleared origin cache from a late in-flight resolution', async () => {
    const cache = createGuestSearchCache(60_000);
    let resolveLate!: (tracks: Track[]) => void;
    // Deliberately ignore the abort signal to simulate a non-cooperative fetch
    // resolving right after cache.clear(origin).
    const slowFetcher = vi.fn(
      () => new Promise<Track[]>((resolve) => { resolveLate = resolve; }),
    );

    const inflight = cache.search('https://a.example', 'daft', slowFetcher);
    cache.clear('https://a.example');
    resolveLate([sampleTrack('stale-after-clear')]);
    await inflight;

    const freshFetcher = vi.fn(async () => [sampleTrack('fresh')]);
    await expect(cache.search('https://a.example', 'daft', freshFetcher)).resolves.toEqual([
      sampleTrack('fresh'),
    ]);
    expect(freshFetcher).toHaveBeenCalledTimes(1);
  });
});
