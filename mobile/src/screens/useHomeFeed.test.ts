import { beforeEach, describe, expect, it, vi } from 'vitest';
import { homeFeedSection, useHomeFeed } from './useHomeFeed';

interface FakeQueryOptions {
  queryKey: string[];
  enabled: boolean;
}

const harness = vi.hoisted(() => ({
  options: [] as { queryKey: string[]; enabled: boolean }[],
  refetch: new Map<string, ReturnType<typeof vi.fn>>(),
  fetching: new Set<string>(),
  setRefreshing: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: <T,>(initial: T) => [initial, harness.setRefreshing],
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: FakeQueryOptions) => {
    harness.options.push(options);
    const name = options.queryKey[0];
    const refetch = vi.fn(async () => undefined);
    harness.refetch.set(name, refetch);
    return {
      data: options.enabled ? [name] : undefined,
      isPending: !options.enabled,
      isFetching: harness.fetching.has(name),
      fetchStatus: harness.fetching.has(name) ? 'fetching' : 'idle',
      isStale: false,
      error: null,
      refetch,
    };
  },
}));
vi.mock('../data', () => {
  const query = (name: string) => (...args: unknown[]) => ({ queryKey: [name, ...args.map(String)] });
  return {
    musicQueries: {
      stats: query('stats'),
      homeMixes: query('homeMixes'),
      releaseRadar: query('releaseRadar'),
      becauseYouListened: query('becauseYouListened'),
      homeChartCollections: query('homeChartCollections'),
      charts: query('charts'),
      newReleases: query('newReleases'),
      publicPlaylists: query('publicPlaylists'),
      genres: query('genres'),
      mood: query('mood'),
    },
  };
});

const DISCOVERY = [
  'stats',
  'homeMixes',
  'releaseRadar',
  'becauseYouListened',
  'homeChartCollections',
  'charts',
  'newReleases',
  'publicPlaylists',
  'genres',
];

function enabledQueries(): string[] {
  return harness.options.filter((options) => options.enabled).map((options) => options.queryKey[0]);
}

function refetched(): string[] {
  return [...harness.refetch].filter(([, refetch]) => refetch.mock.calls.length > 0).map(([name]) => name);
}

describe('homeFeedSection', () => {
  it('maps a query to the section contract and passes the error through untouched', () => {
    const refetch = vi.fn(async () => undefined);
    const error = Object.assign(new Error('offline'), { status: 0 });
    const section = homeFeedSection({
      data: undefined,
      isPending: true,
      isFetching: false,
      fetchStatus: 'paused',
      isStale: true,
      error,
      refetch,
    });

    expect(section.data).toBeUndefined();
    expect(section.state).toMatchObject({
      hasData: false,
      pending: true,
      fetching: false,
      fetchStatus: 'paused',
      stale: true,
    });
    expect(section.state.error).toBe(error);
    section.state.onRetry();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('treats a successful empty response as loaded data', () => {
    const section = homeFeedSection({
      data: [],
      isPending: false,
      isFetching: false,
      fetchStatus: 'idle',
      isStale: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    });
    expect(section.state.hasData).toBe(true);
  });
});

describe('useHomeFeed', () => {
  beforeEach(() => {
    harness.options.length = 0;
    harness.refetch.clear();
    harness.fetching.clear();
    harness.setRefreshing.mockClear();
  });

  it('loads and refreshes the nine discovery sources on the top view only', () => {
    const feed = useHomeFeed('origin::user:7', null);

    expect(harness.options).toHaveLength(10);
    expect(enabledQueries()).toEqual(DISCOVERY);
    expect(harness.options[0].queryKey).toEqual(['stats', 'origin::user:7']);
    expect(feed.mixes.data).toEqual(['homeMixes']);
    expect(feed.mood.state.hasData).toBe(false);
    expect(feed.refreshing).toBe(false);

    feed.refresh();
    expect(refetched()).toEqual(DISCOVERY);
  });

  it('spins for a pull-to-refresh until every source has settled', async () => {
    const feed = useHomeFeed('origin::user:7', null);

    feed.refresh();
    expect(harness.setRefreshing.mock.calls).toEqual([[true]]);
    await vi.waitFor(() => {
      expect(harness.setRefreshing.mock.calls).toEqual([[true], [false]]);
    });
  });

  it('loads and refreshes only the mood rail while a mood is selected', () => {
    harness.fetching.add('mood');
    harness.fetching.add('charts');
    const feed = useHomeFeed('origin::user:7', 'chill');

    expect(enabledQueries()).toEqual(['mood']);
    expect(harness.options[9].queryKey).toEqual(['mood', 'chill']);
    // A background refetch (e.g. stats after a recorded play) is not a pull:
    // the spinner must not drop into the page by itself.
    expect(feed.refreshing).toBe(false);

    feed.refresh();
    expect(refetched()).toEqual(['mood']);
  });
});
