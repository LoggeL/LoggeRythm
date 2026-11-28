import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import {
  mergeHydratedTrackCredits,
  needsTrackCreditsHydration,
  useHydratedTrackCredits,
} from './useHydratedTrackCredits';

const harness = vi.hoisted(() => ({
  queryResult: { data: undefined as Track | undefined, error: null as unknown },
  lastOptions: null as { queryKey: unknown; enabled: boolean; retry: boolean } | null,
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useMemo: <T,>(factory: () => T) => factory(),
  useEffect: (effect: () => void) => { effect(); },
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: { queryKey: unknown; enabled: boolean; retry: boolean }) => {
    harness.lastOptions = options;
    return harness.queryResult;
  },
}));

vi.mock('../data/repositories', () => ({ musicRepository: {} }));
vi.mock('../offline/registry', () => ({
  getOfflineSnapshot: () => ({ scope: null }),
  trackIsExplicitlyDownloaded: () => false,
}));
vi.mock('../offline/lyricsCache', () => ({
  readOfflineLyrics: vi.fn(),
  saveOfflineLyrics: vi.fn(),
}));
vi.mock('../data', async () => {
  const { createMusicQueryOptions } = await import('../data/queryOptions');
  return { musicQueries: createMusicQueryOptions({ getTrack: vi.fn() } as never) };
});

function sampleTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: '67238735',
    title: 'Get Lucky',
    artist: 'Daft Punk',
    artist_id: '27',
    artists: [{ id: '27', name: 'Daft Punk' }],
    album: 'Random Access Memories',
    album_id: '6575789',
    cover: '',
    duration_sec: 369,
    preview_url: null,
    rank: 900_000,
    release_date: '',
    ...overrides,
  };
}

describe('useHydratedTrackCredits', () => {
  beforeEach(() => {
    harness.queryResult = { data: undefined, error: null };
    harness.lastOptions = null;
  });

  it('hydrates single-credit numeric search tracks and skips already-hydrated or non-numeric tracks', () => {
    const singleCredit = sampleTrack();
    const multiCredit = sampleTrack({
      artists: [
        { id: '27', name: 'Daft Punk' },
        { id: '413', name: 'Pharrell Williams' },
      ],
    });

    expect(needsTrackCreditsHydration(null)).toBe(false);
    expect(needsTrackCreditsHydration(singleCredit)).toBe(true);
    expect(needsTrackCreditsHydration(multiCredit)).toBe(false);
    expect(needsTrackCreditsHydration(sampleTrack({ id: 'local-1' }))).toBe(false);

    // Non-blocking: returns original track while detail is pending.
    expect(useHydratedTrackCredits(singleCredit)).toBe(singleCredit);
    expect(harness.lastOptions).toMatchObject({
      queryKey: ['music', 'catalog', 'track', '67238735'],
      enabled: true,
      retry: false,
    });

    // Merges full credits once `/api/tracks/{id}` resolves.
    harness.queryResult = {
      data: sampleTrack({
        artist: 'Daft Punk, Pharrell Williams',
        artists: [
          { id: '27', name: 'Daft Punk' },
          { id: '413', name: 'Pharrell Williams' },
        ],
      }),
      error: null,
    };
    const merged = useHydratedTrackCredits(singleCredit);
    expect(merged?.artists).toEqual([
      { id: '27', name: 'Daft Punk' },
      { id: '413', name: 'Pharrell Williams' },
    ]);

    // Never merges a mismatched track id.
    expect(
      mergeHydratedTrackCredits(singleCredit, sampleTrack({ id: '999', artists: multiCredit.artists })),
    ).toBe(singleCredit);

    // Skips fetching when track already carries full multi-artist credits.
    harness.queryResult = { data: undefined, error: null };
    expect(useHydratedTrackCredits(multiCredit)).toBe(multiCredit);
    expect(harness.lastOptions?.enabled).toBe(false);
  });

  it('logs hydration failures loudly without crashing or blocking playback metadata', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('502');
    harness.queryResult = { data: undefined, error: failure };
    const track = sampleTrack();

    expect(useHydratedTrackCredits(track)).toBe(track);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/credits|Mitwirkende/i),
    );
    errorSpy.mockRestore();
  });
});
