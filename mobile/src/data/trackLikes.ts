import { mutationOptions, type QueryClient } from '@tanstack/react-query';
import type { DeezerId, Track } from '../api/types';
import { refreshLibraryAutoBrowse } from './autoBrowseRefresh';
import { musicRepository, type MusicRepository } from './repositories';
import { queryKeys, type QueryScope } from './queryKeys';

type LikeRepository = Pick<MusicRepository, 'likeTrack' | 'unlikeTrack'>;

interface TrackLikeMutationContext {
  hadCachedLikes: boolean;
  previousTrack: Track | null;
  previousIndex: number;
}

export interface TrackLikeMutationDependencies {
  queryClient: QueryClient;
  scope: QueryScope;
  track: Track;
  refreshAutoBrowse: () => Promise<void>;
  repository?: LikeRepository;
  onMutationError?: (error: unknown) => void;
  onMutationSuccess?: (nextLiked: boolean) => void;
  onAutoBrowseError?: (error: unknown) => void;
}

function normalizedScope(scope: QueryScope): string {
  const value = String(scope).trim();
  if (value.length === 0) throw new Error('like mutation scope must not be empty');
  return value;
}

export function trackLikeMutationKey(scope: QueryScope, trackId: DeezerId) {
  return [
    'music',
    'mutation',
    normalizedScope(scope),
    'library',
    'toggle-like',
    String(trackId),
  ] as const;
}

export function withTrackLiked(
  current: readonly Track[],
  track: Track,
  nextLiked: boolean,
): Track[] {
  const withoutTrack = current.filter((item) => item.id !== track.id);
  return nextLiked ? [track, ...withoutTrack] : withoutTrack;
}

function restorePreviousTrack(
  current: readonly Track[],
  trackId: DeezerId,
  context: TrackLikeMutationContext,
): Track[] {
  const withoutTrack = current.filter((item) => item.id !== trackId);
  if (context.previousTrack === null) return withoutTrack;

  const insertionIndex = Math.min(
    Math.max(context.previousIndex, 0),
    withoutTrack.length,
  );
  return [
    ...withoutTrack.slice(0, insertionIndex),
    context.previousTrack,
    ...withoutTrack.slice(insertionIndex),
  ];
}

function safelyNotify<T>(callback: ((value: T) => void) | undefined, value: T): void {
  try {
    callback?.(value);
  } catch {
    // A presentation callback must never convert a completed server mutation
    // into a failed mutation or prevent rollback/invalidation.
  }
}

/**
 * One mutation contract for every heart control. The Library cache is the
 * immediate UI source of truth; the server and Android Auto tree are then
 * reconciled without allowing a native publication error to undo a valid like.
 */
export function createTrackLikeMutationOptions({
  queryClient,
  scope,
  track,
  refreshAutoBrowse,
  repository = musicRepository,
  onMutationError,
  onMutationSuccess,
  onAutoBrowseError,
}: TrackLikeMutationDependencies) {
  const likesKey = queryKeys.library.likes(scope);

  return mutationOptions({
    mutationKey: trackLikeMutationKey(scope, track.id),
    mutationFn: async (nextLiked: boolean) => {
      if (nextLiked) await repository.likeTrack(track);
      else await repository.unlikeTrack(track.id);
      return nextLiked;
    },
    onMutate: async (nextLiked): Promise<TrackLikeMutationContext> => {
      await queryClient.cancelQueries({ queryKey: likesKey, exact: true });
      const current = queryClient.getQueryData<Track[]>(likesKey);
      const previousIndex = current?.findIndex((item) => item.id === track.id) ?? -1;
      const previousTrack =
        current !== undefined && previousIndex >= 0 ? current[previousIndex] : null;

      if (current !== undefined) {
        queryClient.setQueryData<Track[]>(
          likesKey,
          withTrackLiked(current, track, nextLiked),
        );
      }

      return {
        hadCachedLikes: current !== undefined,
        previousTrack,
        previousIndex,
      };
    },
    onError: (error, _nextLiked, context) => {
      if (context?.hadCachedLikes) {
        queryClient.setQueryData<Track[]>(likesKey, (current = []) =>
          restorePreviousTrack(current, track.id, context),
        );
      }
      safelyNotify(onMutationError, error);
    },
    onSuccess: async (nextLiked) => {
      safelyNotify(onMutationSuccess, nextLiked);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: likesKey, exact: true }),
        refreshLibraryAutoBrowse(refreshAutoBrowse, onAutoBrowseError),
      ]);
    },
    onSettled: async (_result, error) => {
      if (error !== null) {
        await queryClient.invalidateQueries({ queryKey: likesKey, exact: true });
      }
    },
  });
}
