import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import { createMusicQueryOptions } from '../data/queryOptions';
import { queryKeys } from '../data/queryKeys';
import type { MusicRepository } from '../data/repositories';

// The option factory is injected below. Do not load the production React Native
// API client in this deterministic Query-core integration test.
vi.mock('../data/repositories', () => ({ musicRepository: {} }));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function track(id: string, title: string): Track {
  return {
    id,
    title,
    artist: 'Artist',
    artist_id: 'artist-1',
    artists: [],
    album: 'Album',
    album_id: 'album-1',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 0,
    release_date: '',
  };
}

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
}

describe('search concurrency and offline cache policy', () => {
  it('aborts a superseded request and never publishes its late result under the replacement query', async () => {
    const oldResponse = deferred<Track[]>();
    const newResponse = deferred<Track[]>();
    let oldSignal: AbortSignal | undefined;
    const searchTracks = vi.fn((query: string, signal?: AbortSignal) => {
      if (query === 'old query') {
        oldSignal = signal;
        return oldResponse.promise;
      }
      if (query === 'new query') return newResponse.promise;
      throw new Error(`Unexpected search query ${query}`);
    });
    const queries = createMusicQueryOptions({ searchTracks } as unknown as MusicRepository);
    const client = queryClient();
    const observer = new QueryObserver(client, {
      ...queries.searchTracks('old query'),
      retry: false,
    });
    const publishedIds: string[][] = [];
    const unsubscribe = observer.subscribe((result) => {
      publishedIds.push(result.data?.map(({ id }) => id) ?? []);
    });

    await vi.waitFor(() => expect(searchTracks).toHaveBeenCalledOnce());
    expect(oldSignal).toBeInstanceOf(AbortSignal);

    await client.cancelQueries({ queryKey: queryKeys.search.root() });
    expect(oldSignal?.aborted).toBe(true);
    const replacementStartedAt = publishedIds.length;
    observer.setOptions({
      ...queries.searchTracks('new query'),
      retry: false,
    });
    await vi.waitFor(() => expect(searchTracks).toHaveBeenCalledTimes(2));

    newResponse.resolve([track('new', 'New result')]);
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().data?.map(({ id }) => id)).toEqual(['new']);
    });

    // Simulate a server/client that returns after cancellation anyway. TanStack
    // must ignore this completion because the old key is no longer live.
    oldResponse.resolve([track('old', 'Old result')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(observer.getCurrentResult().data?.map(({ id }) => id)).toEqual(['new']);
    expect(publishedIds.slice(replacementStartedAt)).not.toContainEqual(['old']);
    expect(client.getQueryData(queryKeys.search.tracks('old query'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.search.tracks('new query'))).toEqual([
      track('new', 'New result'),
    ]);

    unsubscribe();
    client.clear();
  });

  it('retains last-good data after an offline refresh only for the exact query key, then recovers', async () => {
    let sameQueryCalls = 0;
    const initial = track('initial', 'Initial result');
    const recovered = track('recovered', 'Recovered result');
    const searchTracks = vi.fn(async (query: string) => {
      if (query === 'same query') {
        sameQueryCalls += 1;
        if (sameQueryCalls === 1) return [initial];
        if (sameQueryCalls === 2) throw new Error('network offline');
        return [recovered];
      }
      if (query === 'different query') throw new Error('network offline');
      throw new Error(`Unexpected search query ${query}`);
    });
    const queries = createMusicQueryOptions({ searchTracks } as unknown as MusicRepository);
    const client = queryClient();
    const disabledOptions = (query: string) => ({
      ...queries.searchTracks(query),
      enabled: false,
      retry: false as const,
    });
    const observer = new QueryObserver(client, disabledOptions('same query'));
    const unsubscribe = observer.subscribe(() => undefined);

    const first = await observer.refetch();
    expect(first.status).toBe('success');
    expect(first.data).toEqual([initial]);

    const offline = await observer.refetch();
    expect(offline.status).toBe('error');
    expect(offline.error).toEqual(new Error('network offline'));
    expect(offline.data).toEqual([initial]);

    observer.setOptions(disabledOptions('different query'));
    expect(observer.getCurrentResult().data).toBeUndefined();
    const unrelatedFailure = await observer.refetch();
    expect(unrelatedFailure.status).toBe('error');
    expect(unrelatedFailure.data).toBeUndefined();
    expect(client.getQueryData(queryKeys.search.tracks('different query'))).toBeUndefined();

    observer.setOptions(disabledOptions('same query'));
    expect(observer.getCurrentResult().data).toEqual([initial]);
    const recovery = await observer.refetch();
    expect(recovery.status).toBe('success');
    expect(recovery.data).toEqual([recovered]);

    unsubscribe();
    client.clear();
  });
});
