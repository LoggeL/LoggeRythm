import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import type { RecentPlay } from '../domain/listeningStats';
import { startRecentlyHeardPlayback } from './homePlayback';

function recent(id: string, title = `History ${id}`): RecentPlay {
  return {
    id,
    title,
    artist: 'History Artist',
    artist_id: 'artist-1',
    artists: [{ id: 'artist-1', name: 'History Artist' }],
    album: 'History Album',
    album_id: 'album-1',
    cover: '',
    duration_sec: 180,
  };
}

function track(id: string): Track {
  return {
    ...recent(id),
    preview_url: null,
    rank: 1,
    release_date: '2026-07-16',
  };
}

describe('Recently Heard playback orchestration', () => {
  it('starts the tapped track immediately without blocking on the remaining history entries', async () => {
    const tapped = track('3');
    const resolveTrack = vi.fn(async (id: string) => {
      if (id === '3') return tapped;
      throw new Error(`Should not block playback waiting for track ${id}`);
    });
    const startPlayback = vi.fn(async () => undefined);
    const hydrateRemaining = vi.fn(async () => undefined);

    const outcome = await startRecentlyHeardPlayback({
      recent: [recent('7', 'Newest'), recent('3', 'Tapped'), recent('7', 'Duplicate'), recent('9', 'Oldest')],
      startIndex: 1,
      contextId: 42,
      contextLabel: 'Zuletzt gehört',
      resolveTrack,
      startPlayback,
      hydrateRemaining,
    });

    expect(outcome).toBe('started-immediate');
    expect(resolveTrack).toHaveBeenCalledTimes(1);
    expect(resolveTrack).toHaveBeenCalledWith('3');
    expect(startPlayback).toHaveBeenCalledOnce();
    expect(startPlayback).toHaveBeenCalledWith([tapped], 0, {
      context: { type: 'recent', id: '42', label: 'Zuletzt gehört' },
    });

    await vi.waitFor(() => {
      expect(hydrateRemaining).toHaveBeenCalledOnce();
    });
    expect(hydrateRemaining).toHaveBeenCalledWith(['7', '9'], tapped);
  });

  it('starts the complete duplicate-preserving context in 0 requests when all entries are cached', async () => {
    const cache = new Map<string, Track>([
      ['7', track('7')],
      ['3', track('3')],
    ]);
    const resolveTrack = vi.fn(async (id: string) => track(id));
    const startPlayback = vi.fn(async () => undefined);
    const hydrateRemaining = vi.fn();

    const outcome = await startRecentlyHeardPlayback({
      recent: [recent('7', 'Newest'), recent('3', 'Middle'), recent('7', 'Older duplicate')],
      startIndex: 2,
      contextId: 42,
      contextLabel: 'Zuletzt gehört',
      resolveTrack,
      getCachedTrack: (id) => cache.get(id),
      startPlayback,
      hydrateRemaining,
    });

    expect(outcome).toBe('started-cached-context');
    expect(resolveTrack).not.toHaveBeenCalled();
    expect(hydrateRemaining).not.toHaveBeenCalled();
    expect(startPlayback).toHaveBeenCalledOnce();
    expect(startPlayback).toHaveBeenCalledWith(
      [cache.get('7'), cache.get('3'), cache.get('7')],
      2,
      { context: { type: 'recent', id: '42', label: 'Zuletzt gehört' } },
    );
  });

  it('toggles play/pause synchronously with zero fetches when the tapped track is already active', async () => {
    const resolveTrack = vi.fn(async (id: string) => track(id));
    const startPlayback = vi.fn(async () => undefined);
    const toggleActiveTrack = vi.fn((id: string) => id === '7');

    const outcome = await startRecentlyHeardPlayback({
      recent: [recent('7'), recent('3')],
      startIndex: 0,
      contextId: 42,
      contextLabel: 'Zuletzt gehört',
      resolveTrack,
      startPlayback,
      toggleActiveTrack,
    });

    expect(outcome).toBe('toggled-current');
    expect(toggleActiveTrack).toHaveBeenCalledWith('7');
    expect(resolveTrack).not.toHaveBeenCalled();
    expect(startPlayback).not.toHaveBeenCalled();
  });

  it('fails loudly without starting playback when the tapped track lookup fails', async () => {
    const resolveTrack = vi.fn(async (id: string) => {
      if (id === 'broken') throw new Error('catalog unavailable');
      return track(id);
    });
    const startPlayback = vi.fn(async () => undefined);

    await expect(
      startRecentlyHeardPlayback({
        recent: [recent('first'), recent('broken'), recent('last')],
        startIndex: 1,
        contextId: 'user-1',
        contextLabel: 'Recently Heard',
        resolveTrack,
        startPlayback,
      }),
    ).rejects.toThrow('catalog unavailable');
    expect(startPlayback).not.toHaveBeenCalled();
  });

  it('reports background hydration failures loudly instead of swallowing them', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onHydrationError = vi.fn();
    const failure = new Error('background catalog 503');

    const outcome = await startRecentlyHeardPlayback({
      recent: [recent('1'), recent('2')],
      startIndex: 0,
      contextId: 'user-1',
      contextLabel: 'Recently Heard',
      resolveTrack: vi.fn(async (id: string) => track(id)),
      startPlayback: vi.fn(async () => undefined),
      hydrateRemaining: async () => {
        throw failure;
      },
      onHydrationError,
    });

    expect(outcome).toBe('started-immediate');
    await vi.waitFor(() => {
      expect(onHydrationError).toHaveBeenCalledWith(failure);
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('rejects invalid history positions and identities before catalog requests', async () => {
    const resolveTrack = vi.fn(async (id: string) => track(id));
    const startPlayback = vi.fn(async () => undefined);

    await expect(
      startRecentlyHeardPlayback({
        recent: [recent('1')],
        startIndex: 1,
        contextId: 'user-1',
        contextLabel: 'Recently Heard',
        resolveTrack,
        startPlayback,
      }),
    ).rejects.toThrow('outside');
    await expect(
      startRecentlyHeardPlayback({
        recent: [recent(' ')],
        startIndex: 0,
        contextId: 'user-1',
        contextLabel: 'Recently Heard',
        resolveTrack,
        startPlayback,
      }),
    ).rejects.toThrow('track id at index 0');
    expect(resolveTrack).not.toHaveBeenCalled();
    expect(startPlayback).not.toHaveBeenCalled();
  });
});
