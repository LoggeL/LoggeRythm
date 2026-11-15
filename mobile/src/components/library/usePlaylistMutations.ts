import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  invalidatePlaylistCaches,
  musicMutations,
  optimisticallyRemovePlaylistTrack,
  optimisticallyReorderPlaylistTracks,
  optimisticallySetPlaylistVisibility,
  optimisticallyUpdatePlaylist,
  removeDeletedPlaylistFromCache,
  restorePlaylistCache,
  type PlaylistCacheSnapshot,
  type PlaylistVisibilityVariables,
  type RemovePlaylistTrackVariables,
  type ReorderPlaylistVariables,
  type UpdatePlaylistVariables,
} from '../../data';
import { refreshAutoBrowse } from './autoBrowse';

export interface PlaylistMutationCallbacks {
  /** The playlist no longer exists; the screen must leave. */
  onDeleted: () => void;
}

/**
 * Every write of the playlist detail screen. The four in-place edits share
 * one optimistic lifecycle: apply to the cache, roll back on failure, refetch
 * and republish the car library on success, and refetch after a failure so
 * the cache never keeps a half-applied state. Failures stay on the mutation
 * (`error`) for the screen to show; nothing is swallowed here.
 */
export function usePlaylistMutations(
  scope: string,
  { onDeleted }: PlaylistMutationCallbacks,
) {
  const queryClient = useQueryClient();

  const optimistic = <Variables extends { id: number }>(
    apply: (variables: Variables) => Promise<PlaylistCacheSnapshot>,
  ) => ({
    onMutate: apply,
    onError: (
      _error: unknown,
      { id }: Variables,
      snapshot: PlaylistCacheSnapshot | undefined,
    ) => {
      if (snapshot !== undefined) restorePlaylistCache(queryClient, scope, id, snapshot);
    },
    onSuccess: async (_result: unknown, { id }: Variables) => {
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope, id),
        refreshAutoBrowse(),
      ]);
    },
    onSettled: async (_result: unknown, error: unknown, { id }: Variables) => {
      if (error !== null) await invalidatePlaylistCaches(queryClient, scope, id);
    },
  });

  const update = useMutation({
    ...musicMutations.updatePlaylist(scope),
    ...optimistic(({ id, patch }: UpdatePlaylistVariables) =>
      optimisticallyUpdatePlaylist(queryClient, scope, id, patch)),
  });
  const visibility = useMutation({
    ...musicMutations.setPlaylistVisibility(scope),
    ...optimistic(({ id, isPublic }: PlaylistVisibilityVariables) =>
      optimisticallySetPlaylistVisibility(queryClient, scope, id, isPublic)),
  });
  const removeTrack = useMutation({
    ...musicMutations.removeFromPlaylist(scope),
    ...optimistic(({ id, entryId }: RemovePlaylistTrackVariables) =>
      optimisticallyRemovePlaylistTrack(queryClient, scope, id, entryId)),
  });
  const reorder = useMutation({
    ...musicMutations.reorderPlaylist(scope),
    ...optimistic(({ id, entryIds }: ReorderPlaylistVariables) =>
      optimisticallyReorderPlaylistTracks(queryClient, scope, id, entryIds)),
  });
  const remove = useMutation({
    ...musicMutations.deletePlaylist(scope),
    onSuccess: async (_result, id) => {
      removeDeletedPlaylistFromCache(queryClient, scope, id);
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope),
        refreshAutoBrowse(),
      ]);
      onDeleted();
    },
  });

  const all = [update, visibility, removeTrack, reorder, remove] as const;
  return {
    update,
    visibility,
    removeTrack,
    reorder,
    remove,
    pending: all.some((mutation) => mutation.isPending),
    /** The first failure in declaration order, or null. */
    error:
      update.error ?? visibility.error ?? removeTrack.error ?? reorder.error ?? remove.error,
    resetErrors: () => all.forEach((mutation) => mutation.reset()),
  };
}

export type PlaylistMutations = ReturnType<typeof usePlaylistMutations>;
