import { mutationOptions, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ArtistSummary, DeezerId } from '../api/types';
import { refreshLibraryAutoBrowse } from './autoBrowseRefresh';
import { musicRepository, type MusicRepository } from './repositories';
import { queryKeys, type QueryScope } from './queryKeys';

type FollowRepository = Pick<MusicRepository, 'followArtist' | 'unfollowArtist'>;

export interface ArtistFollowMutationDependencies {
  queryClient: QueryClient;
  scope: QueryScope;
  artist: ArtistSummary;
  refreshAutoBrowse: () => Promise<void>;
  repository?: FollowRepository;
  onMutationSuccess?: () => void;
  onMutationError?: (error: unknown) => void;
  onAutoBrowseError?: (error: unknown) => void;
}

function normalizedScope(scope: QueryScope): string {
  const value = String(scope).trim();
  if (value.length === 0) throw new Error('follow mutation scope must not be empty');
  return value;
}

function normalizedArtistId(artistId: DeezerId): string {
  const value = String(artistId).trim();
  if (value.length === 0) throw new Error('follow mutation artist id must not be empty');
  return value;
}

export function artistFollowMutationKey(scope: QueryScope, artistId: DeezerId) {
  return [
    'music',
    'mutation',
    normalizedScope(scope),
    'artist-follow',
    normalizedArtistId(artistId),
  ] as const;
}

export function withArtistFollowing(
  current: readonly ArtistSummary[],
  artist: ArtistSummary,
  nextFollowing: boolean,
): ArtistSummary[] {
  const artistId = normalizedArtistId(artist.id);
  const currentIndex = current.findIndex((item) => String(item.id) === artistId);

  if (!nextFollowing) {
    return current.filter((item) => String(item.id) !== artistId);
  }
  if (currentIndex < 0) {
    // The API lists newest follows first (`created_at DESC`).
    return [artist, ...current];
  }

  return current.map((item, index) => (index === currentIndex ? artist : item));
}

export function followContainsKeyIncludesArtist(
  queryKey: QueryKey,
  scope: QueryScope,
  artistId: DeezerId,
): boolean {
  const listKey = queryKeys.follows.artists(scope);
  const normalizedId = normalizedArtistId(artistId);
  if (queryKey.length !== listKey.length + 2) return false;
  if (!listKey.every((part, index) => queryKey[index] === part)) return false;
  if (queryKey[listKey.length] !== 'contains') return false;

  const ids = queryKey[listKey.length + 1];
  return (
    Array.isArray(ids) &&
    ids.some((id) => String(id) === normalizedId)
  );
}

function updateCachedFollowState(
  queryClient: QueryClient,
  scope: QueryScope,
  artist: ArtistSummary,
  nextFollowing: boolean,
): void {
  const listKey = queryKeys.follows.artists(scope);
  const artistId = normalizedArtistId(artist.id);

  queryClient.setQueryData<ArtistSummary[]>(listKey, (current) =>
    current === undefined ? undefined : withArtistFollowing(current, artist, nextFollowing),
  );
  queryClient.setQueriesData<Record<string, boolean>>(
    {
      queryKey: listKey,
      predicate: (query) => followContainsKeyIncludesArtist(query.queryKey, scope, artistId),
    },
    (current) =>
      current === undefined ? undefined : { ...current, [artistId]: nextFollowing },
  );
}

function safelyNotifyError(
  callback: ((error: unknown) => void) | undefined,
  error: unknown,
): void {
  try {
    callback?.(error);
  } catch {
    // Presentation callbacks must not change mutation state or cache reconciliation.
  }
}

function safelyNotifySuccess(callback: (() => void) | undefined): void {
  try {
    callback?.();
  } catch {
    // Presentation callbacks must not change mutation state or cache reconciliation.
  }
}

/**
 * Keep the Artist toggle, every cached contains batch, and the account-scoped
 * Library list on one mutation contract. Cache writes happen as soon as the
 * server confirms the change, before the background reconciliation fetch.
 */
export function createArtistFollowMutationOptions({
  queryClient,
  scope,
  artist,
  refreshAutoBrowse,
  repository = musicRepository,
  onMutationSuccess,
  onMutationError,
  onAutoBrowseError,
}: ArtistFollowMutationDependencies) {
  const listKey = queryKeys.follows.artists(scope);
  const mutationId = JSON.stringify(artistFollowMutationKey(scope, artist.id));

  return mutationOptions({
    mutationKey: artistFollowMutationKey(scope, artist.id),
    // Serialise duplicate detail screens for the same account/artist. Different
    // artists remain independent and their functional list updates commute.
    scope: { id: mutationId },
    mutationFn: async (nextFollowing: boolean) => {
      if (nextFollowing) await repository.followArtist(artist);
      else await repository.unfollowArtist(artist.id);
      return nextFollowing;
    },
    onSuccess: async (nextFollowing) => {
      // A stale in-flight Library/follow-state response must not overwrite the
      // server-confirmed result between this write and the reconciliation fetch.
      await queryClient.cancelQueries({ queryKey: listKey });
      updateCachedFollowState(queryClient, scope, artist, nextFollowing);
      safelyNotifySuccess(onMutationSuccess);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: listKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home.personalized(scope) }),
        refreshLibraryAutoBrowse(refreshAutoBrowse, onAutoBrowseError),
      ]);
    },
    onError: (error) => safelyNotifyError(onMutationError, error),
  });
}
