import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import type { MusicRepository } from './repositories';
import { queryKeys } from './queryKeys';
import {
  createTrackLikeMutationOptions,
  trackLikeMutationKey,
  withTrackLiked,
} from './trackLikes';

vi.mock('./repositories', () => ({ musicRepository: {} }));

const trackA: Track = {
  id: '1',
  title: 'One',
  artist: 'Artist A',
  artist_id: 'a',
  artists: [{ id: 'a', name: 'Artist A' }],
  album: 'Album A',
  album_id: 'aa',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
};

const trackB: Track = {
  ...trackA,
  id: '2',
  title: 'Two',
  artist: 'Artist B',
  artist_id: 'b',
  artists: [{ id: 'b', name: 'Artist B' }],
};

function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

describe('track like mutation', () => {
  it('uses an account-and-track-scoped key and keeps the optimistic list unique', () => {
    expect(trackLikeMutationKey('account-7', '1')).toEqual([
      'music',
      'mutation',
      'account-7',
      'library',
      'toggle-like',
      '1',
    ]);
    expect(withTrackLiked([trackB, trackA], trackA, true)).toEqual([trackA, trackB]);
    expect(withTrackLiked([trackA, trackB], trackA, false)).toEqual([trackB]);
  });

  it('optimistically updates Library, then invalidates it and refreshes Android Auto', async () => {
    const client = queryClient();
    const key = queryKeys.library.likes('account-7');
    client.setQueryData<Track[]>(key, [trackB]);

    let finishLike: (() => void) | undefined;
    const likeTrack = vi.fn(
      () => new Promise<void>((resolve) => { finishLike = resolve; }),
    );
    const unlikeTrack = vi.fn(async () => undefined);
    const refreshAutoBrowse = vi.fn(async () => undefined);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const mutation = client.getMutationCache().build(
      client,
      createTrackLikeMutationOptions({
        queryClient: client,
        scope: 'account-7',
        track: trackA,
        refreshAutoBrowse,
        repository: { likeTrack, unlikeTrack } as Pick<
          MusicRepository,
          'likeTrack' | 'unlikeTrack'
        >,
      }),
    );

    const pending = mutation.execute(true);
    await vi.waitFor(() => expect(client.getQueryData(key)).toEqual([trackA, trackB]));
    expect(refreshAutoBrowse).not.toHaveBeenCalled();

    finishLike?.();
    await pending;

    expect(likeTrack).toHaveBeenCalledWith(trackA);
    expect(unlikeTrack).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key, exact: true });
    expect(refreshAutoBrowse).toHaveBeenCalledOnce();
  });

  it('rolls back only the failed track and keeps another optimistic change', async () => {
    const client = queryClient();
    const key = queryKeys.library.likes('account-7');
    client.setQueryData<Track[]>(key, [trackA]);
    const failure = new Error('network unavailable');
    const onMutationError = vi.fn();
    const refreshAutoBrowse = vi.fn(async () => undefined);
    let failUnlike: ((error: Error) => void) | undefined;
    const mutation = client.getMutationCache().build(
      client,
      createTrackLikeMutationOptions({
        queryClient: client,
        scope: 'account-7',
        track: trackA,
        refreshAutoBrowse,
        repository: {
          likeTrack: vi.fn(async () => undefined),
          unlikeTrack: vi.fn(
            () => new Promise<void>((_resolve, reject) => { failUnlike = reject; }),
          ),
        } as Pick<MusicRepository, 'likeTrack' | 'unlikeTrack'>,
        onMutationError,
      }),
    );

    const pending = mutation.execute(false);
    await vi.waitFor(() => expect(client.getQueryData(key)).toEqual([]));
    client.setQueryData<Track[]>(key, [trackB]);
    failUnlike?.(failure);

    await expect(pending).rejects.toThrow('network unavailable');
    expect(client.getQueryData(key)).toEqual([trackA, trackB]);
    expect(onMutationError).toHaveBeenCalledWith(failure);
    expect(refreshAutoBrowse).not.toHaveBeenCalled();
  });

  it('does not roll back a valid server mutation when Android Auto refresh fails', async () => {
    const client = queryClient();
    const key = queryKeys.library.likes('account-7');
    client.setQueryData<Track[]>(key, []);
    const autoFailure = new Error('car publication unavailable');
    const onAutoBrowseError = vi.fn();
    const mutation = client.getMutationCache().build(
      client,
      createTrackLikeMutationOptions({
        queryClient: client,
        scope: 'account-7',
        track: trackA,
        refreshAutoBrowse: vi.fn(async () => { throw autoFailure; }),
        repository: {
          likeTrack: vi.fn(async () => undefined),
          unlikeTrack: vi.fn(async () => undefined),
        } as Pick<MusicRepository, 'likeTrack' | 'unlikeTrack'>,
        onAutoBrowseError,
      }),
    );

    await expect(mutation.execute(true)).resolves.toBe(true);
    expect(client.getQueryData(key)).toEqual([trackA]);
    expect(onAutoBrowseError).toHaveBeenCalledWith(autoFailure);
  });

  it('reports the confirmed semantic like state without letting presentation fail the mutation', async () => {
    const client = queryClient();
    const key = queryKeys.library.likes('account-7');
    client.setQueryData<Track[]>(key, []);
    const onMutationSuccess = vi.fn(() => {
      throw new Error('accessibility bridge unavailable');
    });
    const mutation = client.getMutationCache().build(
      client,
      createTrackLikeMutationOptions({
        queryClient: client,
        scope: 'account-7',
        track: trackA,
        refreshAutoBrowse: vi.fn(async () => undefined),
        repository: {
          likeTrack: vi.fn(async () => undefined),
          unlikeTrack: vi.fn(async () => undefined),
        },
        onMutationSuccess,
      }),
    );

    await expect(mutation.execute(true)).resolves.toBe(true);
    expect(onMutationSuccess).toHaveBeenCalledWith(true);
  });
});
