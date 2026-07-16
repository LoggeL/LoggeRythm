import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ArtistSummary } from '../api/types';
import type { MusicRepository } from './repositories';
import { queryKeys } from './queryKeys';
import {
  artistFollowMutationKey,
  createArtistFollowMutationOptions,
  followContainsKeyIncludesArtist,
  withArtistFollowing,
} from './artistFollows';

vi.mock('./repositories', () => ({ musicRepository: {} }));

const artistA: ArtistSummary = { id: 'a', name: 'Artist A', picture: 'a.jpg' };
const artistB: ArtistSummary = { id: 'b', name: 'Artist B', picture: 'b.jpg' };
const artistC: ArtistSummary = { id: 'c', name: 'Artist C', picture: 'c.jpg' };

type FollowRepository = Pick<MusicRepository, 'followArtist' | 'unfollowArtist'>;

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function mutation(
  client: QueryClient,
  artist: ArtistSummary,
  repository: FollowRepository,
  scope = 'account-7',
  refreshAutoBrowse = vi.fn(async () => undefined),
) {
  return client.getMutationCache().build(
    client,
    createArtistFollowMutationOptions({
      queryClient: client,
      scope,
      artist,
      repository,
      refreshAutoBrowse,
    }),
  );
}

describe('artist follow mutation', () => {
  it('uses account-and-artist scope and matches the newest-first server list', () => {
    expect(artistFollowMutationKey('account-7', 'a')).toEqual([
      'music',
      'mutation',
      'account-7',
      'artist-follow',
      'a',
    ]);
    expect(withArtistFollowing([artistB], artistA, true)).toEqual([artistA, artistB]);
    expect(withArtistFollowing([artistA, artistB], { ...artistA, name: 'Updated' }, true)).toEqual([
      { ...artistA, name: 'Updated' },
      artistB,
    ]);
    expect(withArtistFollowing([artistA, artistB], artistA, false)).toEqual([artistB]);
  });

  it('recognises only contains batches for the same account and artist', () => {
    expect(
      followContainsKeyIncludesArtist(
        queryKeys.follows.contains('account-7', ['b', 'a']),
        'account-7',
        'a',
      ),
    ).toBe(true);
    expect(
      followContainsKeyIncludesArtist(
        queryKeys.follows.contains('account-7', ['b']),
        'account-7',
        'a',
      ),
    ).toBe(false);
    expect(
      followContainsKeyIncludesArtist(
        queryKeys.follows.contains('account-8', ['a']),
        'account-7',
        'a',
      ),
    ).toBe(false);
    expect(
      followContainsKeyIncludesArtist(queryKeys.follows.artists('account-7'), 'account-7', 'a'),
    ).toBe(false);
  });

  it('writes a confirmed follow into Library and every relevant contains cache before refetch', async () => {
    const client = queryClient();
    const listKey = queryKeys.follows.artists('account-7');
    const containsAB = queryKeys.follows.contains('account-7', ['a', 'b']);
    const containsC = queryKeys.follows.contains('account-7', ['c']);
    const otherAccountList = queryKeys.follows.artists('account-8');
    client.setQueryData<ArtistSummary[]>(listKey, [artistB]);
    client.setQueryData(containsAB, { a: false, b: true });
    client.setQueryData(containsC, { c: true });
    client.setQueryData<ArtistSummary[]>(otherAccountList, [artistC]);

    let finishFollow: (() => void) | undefined;
    const repository = {
      followArtist: vi.fn(() => new Promise<void>((resolve) => { finishFollow = resolve; })),
      unfollowArtist: vi.fn(async () => undefined),
    };
    const refreshAutoBrowse = vi.fn(async () => undefined);
    const cancel = vi.spyOn(client, 'cancelQueries');
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const pending = mutation(
      client,
      artistA,
      repository,
      'account-7',
      refreshAutoBrowse,
    ).execute(true);

    await vi.waitFor(() => expect(repository.followArtist).toHaveBeenCalledWith(artistA));
    expect(client.getQueryData(listKey)).toEqual([artistB]);
    finishFollow?.();
    await pending;

    expect(client.getQueryData(listKey)).toEqual([artistA, artistB]);
    expect(client.getQueryData(containsAB)).toEqual({ a: true, b: true });
    expect(client.getQueryData(containsC)).toEqual({ c: true });
    expect(client.getQueryData(otherAccountList)).toEqual([artistC]);
    expect(cancel).toHaveBeenCalledWith({ queryKey: listKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listKey });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.home.personalized('account-7'),
    });
    expect(refreshAutoBrowse).toHaveBeenCalledOnce();
  });

  it('removes a confirmed unfollow immediately without waiting for Library to refetch', async () => {
    const client = queryClient();
    const listKey = queryKeys.follows.artists('account-7');
    const contains = queryKeys.follows.contains('account-7', ['a']);
    client.setQueryData<ArtistSummary[]>(listKey, [artistA, artistB]);
    client.setQueryData(contains, { a: true });
    const repository = {
      followArtist: vi.fn(async () => undefined),
      unfollowArtist: vi.fn(async () => undefined),
    };

    await mutation(client, artistA, repository).execute(false);

    expect(repository.unfollowArtist).toHaveBeenCalledWith('a');
    expect(client.getQueryData(listKey)).toEqual([artistB]);
    expect(client.getQueryData(contains)).toEqual({ a: false });
  });

  it('does not seed a partial Library list when that account has not loaded it', async () => {
    const client = queryClient();
    const listKey = queryKeys.follows.artists('account-7');
    const contains = queryKeys.follows.contains('account-7', ['a']);
    client.setQueryData(contains, { a: false });
    const repository = {
      followArtist: vi.fn(async () => undefined),
      unfollowArtist: vi.fn(async () => undefined),
    };

    await mutation(client, artistA, repository).execute(true);

    expect(client.getQueryData(listKey)).toBeUndefined();
    expect(client.getQueryData(contains)).toEqual({ a: true });
  });

  it('serialises duplicate-screen toggles for one artist and leaves the final server intent cached', async () => {
    const client = queryClient();
    const listKey = queryKeys.follows.artists('account-7');
    const contains = queryKeys.follows.contains('account-7', ['a']);
    client.setQueryData<ArtistSummary[]>(listKey, []);
    client.setQueryData(contains, { a: false });

    let finishFollow: (() => void) | undefined;
    let finishUnfollow: (() => void) | undefined;
    const repository = {
      followArtist: vi.fn(() => new Promise<void>((resolve) => { finishFollow = resolve; })),
      unfollowArtist: vi.fn(() => new Promise<void>((resolve) => { finishUnfollow = resolve; })),
    };
    const follow = mutation(client, artistA, repository);
    const unfollow = mutation(client, artistA, repository);

    const first = follow.execute(true);
    const second = unfollow.execute(false);
    await vi.waitFor(() => expect(repository.followArtist).toHaveBeenCalledOnce());
    expect(repository.unfollowArtist).not.toHaveBeenCalled();

    finishFollow?.();
    await vi.waitFor(() => expect(repository.unfollowArtist).toHaveBeenCalledOnce());
    finishUnfollow?.();
    await Promise.all([first, second]);

    expect(client.getQueryData(listKey)).toEqual([]);
    expect(client.getQueryData(contains)).toEqual({ a: false });
  });

  it('keeps another artist change when independent requests finish out of order', async () => {
    const client = queryClient();
    const listKey = queryKeys.follows.artists('account-7');
    client.setQueryData<ArtistSummary[]>(listKey, []);
    const resolvers = new Map<string, () => void>();
    const repository = {
      followArtist: vi.fn(
        (artist: ArtistSummary) =>
          new Promise<void>((resolve) => { resolvers.set(artist.id, resolve); }),
      ),
      unfollowArtist: vi.fn(async () => undefined),
    };

    const first = mutation(client, artistA, repository).execute(true);
    const second = mutation(client, artistB, repository).execute(true);
    await vi.waitFor(() => expect(repository.followArtist).toHaveBeenCalledTimes(2));
    resolvers.get('b')?.();
    await vi.waitFor(() => expect(client.getQueryData(listKey)).toEqual([artistB]));
    resolvers.get('a')?.();
    await Promise.all([first, second]);

    expect(client.getQueryData<ArtistSummary[]>(listKey)).toEqual([artistA, artistB]);
  });

  it('leaves confirmed cache data untouched on failure and reports the error safely', async () => {
    const client = queryClient();
    const listKey = queryKeys.follows.artists('account-7');
    const contains = queryKeys.follows.contains('account-7', ['a']);
    client.setQueryData<ArtistSummary[]>(listKey, [artistB]);
    client.setQueryData(contains, { a: false });
    const failure = new Error('offline');
    const onMutationError = vi.fn(() => { throw new Error('presentation failed'); });
    const refreshAutoBrowse = vi.fn(async () => undefined);
    const options = createArtistFollowMutationOptions({
      queryClient: client,
      scope: 'account-7',
      artist: artistA,
      repository: {
        followArtist: vi.fn(async () => { throw failure; }),
        unfollowArtist: vi.fn(async () => undefined),
      },
      refreshAutoBrowse,
      onMutationError,
    });

    await expect(client.getMutationCache().build(client, options).execute(true)).rejects.toThrow(
      'offline',
    );
    expect(client.getQueryData(listKey)).toEqual([artistB]);
    expect(client.getQueryData(contains)).toEqual({ a: false });
    expect(onMutationError).toHaveBeenCalledWith(failure);
    expect(refreshAutoBrowse).not.toHaveBeenCalled();
  });

  it('keeps a confirmed follow successful when Android Auto publication fails', async () => {
    const client = queryClient();
    const listKey = queryKeys.follows.artists('account-7');
    client.setQueryData<ArtistSummary[]>(listKey, []);
    const autoFailure = new Error('car publication unavailable');
    const onAutoBrowseError = vi.fn(() => { throw new Error('notice unavailable'); });
    const options = createArtistFollowMutationOptions({
      queryClient: client,
      scope: 'account-7',
      artist: artistA,
      repository: {
        followArtist: vi.fn(async () => undefined),
        unfollowArtist: vi.fn(async () => undefined),
      },
      refreshAutoBrowse: vi.fn(async () => { throw autoFailure; }),
      onAutoBrowseError,
    });

    await expect(client.getMutationCache().build(client, options).execute(true)).resolves.toBe(true);

    expect(client.getQueryData(listKey)).toEqual([artistA]);
    expect(onAutoBrowseError).toHaveBeenCalledWith(autoFailure);
  });
});
