import { describe, expect, it, vi } from 'vitest';
import type { RecentPlay, Track } from '../api/types';
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
  it('hydrates every history occurrence and starts the exact duplicate-preserving context', async () => {
    const hydrated = [track('resolved-first'), track('resolved-second'), track('resolved-third')];
    let call = 0;
    const resolveTrack = vi.fn(async (_id: string) => hydrated[call++]);
    const startPlayback = vi.fn(async () => undefined);

    await startRecentlyHeardPlayback({
      recent: [recent('7', 'Newest'), recent('3', 'Middle'), recent('7', 'Older duplicate')],
      startIndex: 2,
      contextId: 42,
      contextLabel: 'Zuletzt gehört',
      resolveTrack,
      startPlayback,
    });

    expect(resolveTrack.mock.calls.map(([id]) => id)).toEqual(['7', '3', '7']);
    expect(startPlayback).toHaveBeenCalledOnce();
    expect(startPlayback).toHaveBeenCalledWith(hydrated, 2, {
      context: { type: 'recent', id: '42', label: 'Zuletzt gehört' },
    });
  });

  it('never replaces the queue with a partial context when hydration fails', async () => {
    const resolveTrack = vi.fn(async (id: string) => {
      if (id === 'broken') throw new Error('catalog unavailable');
      return track(id);
    });
    const startPlayback = vi.fn(async () => undefined);

    await expect(
      startRecentlyHeardPlayback({
        recent: [recent('first'), recent('broken'), recent('last')],
        startIndex: 0,
        contextId: 'user-1',
        contextLabel: 'Recently Heard',
        resolveTrack,
        startPlayback,
      }),
    ).rejects.toThrow('catalog unavailable');
    expect(startPlayback).not.toHaveBeenCalled();
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
