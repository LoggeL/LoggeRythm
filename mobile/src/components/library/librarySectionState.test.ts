import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { createMusicQueryOptions } from '../../data/queryOptions';
import { queryKeys } from '../../data/queryKeys';
import type { MusicRepository } from '../../data/repositories';
import {
  LIBRARY_POLICY_SECTION_STATE,
  isLibraryOfflineState,
  libraryQuerySectionState,
  refreshLibraryQueries,
  resolveLibrarySectionVisualState,
  type LibraryQuerySectionState,
} from './librarySectionState';

vi.mock('../../data/repositories', () => ({ musicRepository: {} }));

const likedTrack: Track = {
  id: 'track-1',
  title: 'Last good track',
  artist: 'Artist',
  artist_id: 'artist-1',
  artists: [],
  album: 'Album',
  album_id: 'album-1',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 1,
  release_date: '2026-07-15',
};

function queryState(
  overrides: Partial<LibraryQuerySectionState> = {},
): LibraryQuerySectionState {
  return {
    kind: 'query',
    hasData: true,
    empty: false,
    pending: false,
    fetching: false,
    paused: false,
    stale: false,
    error: null,
    ...overrides,
  };
}

describe('Library section state model', () => {
  it('distinguishes no response from a successful empty last-good response', () => {
    const noResponse = libraryQuerySectionState(
      {
        data: undefined,
        error: null,
        isPending: true,
        isFetching: true,
        isStale: true,
        fetchStatus: 'fetching',
      },
      false,
    );
    const successfulEmpty = libraryQuerySectionState(
      {
        data: [],
        error: null,
        isPending: false,
        isFetching: false,
        isStale: false,
        fetchStatus: 'idle',
      },
      true,
    );

    expect(noResponse.hasData).toBe(false);
    expect(resolveLibrarySectionVisualState(noResponse)).toEqual({
      body: 'loading',
      notice: null,
    });
    expect(successfulEmpty.hasData).toBe(true);
    expect(resolveLibrarySectionVisualState(successfulEmpty)).toEqual({
      body: 'empty',
      notice: null,
    });
    expect(successfulEmpty).not.toHaveProperty('data');
  });

  it('separates hard errors from paused and transport-offline states', () => {
    expect(
      resolveLibrarySectionVisualState(
        queryState({ hasData: false, error: new Error('500 from server') }),
      ),
    ).toEqual({ body: 'hard-error', notice: null });

    expect(
      resolveLibrarySectionVisualState(
        queryState({ hasData: false, pending: true, paused: true }),
      ),
    ).toEqual({ body: 'offline', notice: null });

    const offlineError = Object.assign(new Error('Network request failed'), { status: 0 });
    expect(isLibraryOfflineState(offlineError, false)).toBe(true);
    expect(
      resolveLibrarySectionVisualState(
        queryState({ hasData: false, error: offlineError }),
      ),
    ).toEqual({ body: 'offline', notice: null });
  });

  it('keeps content and known-empty results while refresh fails or pauses offline', () => {
    expect(
      resolveLibrarySectionVisualState(
        queryState({ error: new Error('refresh failed'), stale: true }),
      ),
    ).toEqual({ body: 'content', notice: 'cached-refresh-error' });

    expect(
      resolveLibrarySectionVisualState(
        queryState({ empty: true, error: new Error('refresh failed'), stale: true }),
      ),
    ).toEqual({ body: 'empty', notice: 'cached-refresh-error' });

    expect(
      resolveLibrarySectionVisualState(queryState({ paused: true, stale: true })),
    ).toEqual({ body: 'content', notice: 'cached-offline' });
  });

  it('prioritizes cached error, refresh, and stale notices deterministically', () => {
    expect(
      resolveLibrarySectionVisualState(
        queryState({ error: new Error('failed'), fetching: true, stale: true }),
      ).notice,
    ).toBe('cached-refresh-error');
    expect(resolveLibrarySectionVisualState(queryState({ fetching: true, stale: true })).notice)
      .toBe('refreshing');
    expect(resolveLibrarySectionVisualState(queryState({ stale: true })).notice).toBe('stale');
    expect(resolveLibrarySectionVisualState(queryState()).notice).toBeNull();
    expect(LIBRARY_POLICY_SECTION_STATE).toEqual({ kind: 'policy' });
  });

  it('pull-to-refresh attempts every remote section even when one rejects', async () => {
    const playlists = vi.fn(async () => ({ data: [] }));
    const likes = vi.fn(async () => {
      throw new Error('offline');
    });
    const recent = vi.fn(async () => ({ data: [] }));
    const following = vi.fn(async () => ({ data: [] }));

    await expect(
      refreshLibraryQueries([
        { refetch: playlists },
        { refetch: likes },
        { refetch: recent },
        { refetch: following },
      ]),
    ).resolves.toBeUndefined();

    expect(playlists).toHaveBeenCalledOnce();
    expect(likes).toHaveBeenCalledOnce();
    expect(recent).toHaveBeenCalledOnce();
    expect(following).toHaveBeenCalledOnce();
  });

  it('retains last-good rows only inside the exact origin-and-account query scope', async () => {
    const offline = Object.assign(new Error('Network request failed'), { status: 0 });
    const getLikes = vi
      .fn<MusicRepository['getLikes']>()
      .mockResolvedValueOnce([likedTrack])
      .mockRejectedValueOnce(offline)
      .mockRejectedValueOnce(offline);
    const queries = createMusicQueryOptions({ getLikes } as unknown as MusicRepository);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
    });
    const firstScope = 'https://prod.test::user:7';
    const otherScope = 'https://other.test::user:7';
    const options = (scope: string) => ({ ...queries.likes(scope), enabled: false });
    const observer = new QueryObserver(client, options(firstScope));
    const unsubscribe = observer.subscribe(() => undefined);

    const first = await observer.refetch();
    expect(first.data).toEqual([likedTrack]);

    const failedRefresh = await observer.refetch();
    expect(failedRefresh.data).toEqual([likedTrack]);
    expect(
      resolveLibrarySectionVisualState(
        libraryQuerySectionState(failedRefresh, failedRefresh.data?.length === 0),
      ),
    ).toEqual({ body: 'content', notice: 'cached-offline' });

    observer.setOptions(options(otherScope));
    expect(observer.getCurrentResult().data).toBeUndefined();
    const unrelatedFailure = await observer.refetch();
    expect(unrelatedFailure.data).toBeUndefined();
    expect(
      resolveLibrarySectionVisualState(
        libraryQuerySectionState(unrelatedFailure, unrelatedFailure.data?.length === 0),
      ),
    ).toEqual({ body: 'offline', notice: null });
    expect(client.getQueryData(queryKeys.library.likes(firstScope))).toEqual([likedTrack]);
    expect(client.getQueryData(queryKeys.library.likes(otherScope))).toBeUndefined();

    unsubscribe();
    client.clear();
  });
});
