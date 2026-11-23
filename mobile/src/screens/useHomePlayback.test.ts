import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import type { RecentPlay } from '../domain/listeningStats';
import { useHomePlayback } from './useHomePlayback';

const mocks = vi.hoisted(() => ({
  playTracks: vi.fn(async () => undefined),
  playTrackRow: vi.fn(async () => 'started-context' as const),
  togglePlay: vi.fn(),
  reportPlayerError: vi.fn(),
  showTrackActions: vi.fn(),
  activeMediaItem: null as { extras?: { track?: Track } } | null,
  queryCache: new Map<string, Track>(),
  fetchQuery: vi.fn(),
}));

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useCallback: <T extends (...args: never[]) => unknown>(fn: T): T => fn,
  useRef: <T,>(initial: T) => ({ current: initial }),
  useState: <T,>(initial: T): [T, (next: T) => void] => [initial, vi.fn()],
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: (key: readonly unknown[]) => mocks.queryCache.get(JSON.stringify(key)),
    fetchQuery: mocks.fetchQuery,
  }),
}));

vi.mock('../data', () => ({
  queryKeys: {
    catalog: {
      track: (id: string) => ['music', 'catalog', 'track', id] as const,
    },
  },
  musicQueries: {
    track: (id: string) => ({ queryKey: ['music', 'catalog', 'track', id] as const, id }),
  },
}));

vi.mock('../player/controller', () => ({
  playTracks: mocks.playTracks,
  playTrackRow: mocks.playTrackRow,
  togglePlay: mocks.togglePlay,
}));

vi.mock('../player/errors', () => ({
  reportPlayerError: mocks.reportPlayerError,
}));

vi.mock('../player/player', () => ({
  default: {
    getActiveMediaItem: () => mocks.activeMediaItem,
  },
}));

vi.mock('../components/trackActions', () => ({
  showTrackActions: mocks.showTrackActions,
}));

const sampleTrack = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  artist_id: 'a1',
  artists: [{ id: 'a1', name: 'Artist' }],
  album: 'Album',
  album_id: 'al1',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '2026-07-16',
});

const sampleRecent = (id: string): RecentPlay => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  artist_id: 'a1',
  artists: [{ id: 'a1', name: 'Artist' }],
  album: 'Album',
  album_id: 'al1',
  cover: '',
  duration_sec: 180,
});

beforeEach(() => {
  mocks.playTracks.mockClear();
  mocks.playTrackRow.mockClear();
  mocks.togglePlay.mockClear();
  mocks.reportPlayerError.mockClear();
  mocks.showTrackActions.mockClear();
  mocks.fetchQuery.mockReset();
  mocks.queryCache.clear();
  mocks.activeMediaItem = null;
});

describe('useHomePlayback', () => {
  const context = { type: 'chart' as const, id: 'home', label: 'Charts' };

  it('uses playTrackRow for track rails so tapping an active track toggles play/pause', () => {
    const tracks = [sampleTrack('1'), sampleTrack('2')];
    const playback = useHomePlayback([], 7);

    playback.playTrackContext(tracks, 1, context);
    expect(mocks.playTrackRow).toHaveBeenCalledWith(tracks, 1, { context });
    expect(mocks.playTracks).not.toHaveBeenCalled();

    playback.playContext(tracks, 0, context);
    expect(mocks.playTracks).toHaveBeenCalledWith(tracks, 0, { context });
  });

  it('toggles an already-active recent track immediately without any track fetch', async () => {
    const active = sampleTrack('1');
    mocks.activeMediaItem = { extras: { track: active } };
    const playback = useHomePlayback([sampleRecent('1'), sampleRecent('2')], 7);

    playback.playRecent(0);
    await Promise.resolve();

    expect(mocks.togglePlay).toHaveBeenCalledOnce();
    expect(mocks.fetchQuery).not.toHaveBeenCalled();
    expect(mocks.playTrackRow).not.toHaveBeenCalled();
  });

  it('starts the tapped recent track immediately via playTrackRow and warms remaining tracks', async () => {
    mocks.fetchQuery.mockImplementation(async (query: { id: string }) => sampleTrack(query.id));
    const playback = useHomePlayback([sampleRecent('1'), sampleRecent('2'), sampleRecent('3')], 7);

    playback.playRecent(1);

    await vi.waitFor(() => {
      expect(mocks.playTrackRow).toHaveBeenCalledOnce();
    });
    expect(mocks.playTrackRow).toHaveBeenCalledWith([sampleTrack('2')], 0, {
      context: { type: 'recent', id: '7', label: expect.any(String) },
    });
    await vi.waitFor(() => {
      expect(mocks.fetchQuery).toHaveBeenCalledTimes(3);
    });
  });

  it('reports failures loudly when tapped recent playback fails', async () => {
    mocks.fetchQuery.mockRejectedValueOnce(new Error('network down'));
    const playback = useHomePlayback([sampleRecent('1')], 7);

    playback.playRecent(0);

    await vi.waitFor(() => {
      expect(mocks.reportPlayerError).toHaveBeenCalledOnce();
    });
    expect(mocks.playTrackRow).not.toHaveBeenCalled();
  });
});
