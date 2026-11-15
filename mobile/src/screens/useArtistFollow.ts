import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArtistSummary } from '../api/types';
import { createArtistFollowMutationOptions, musicQueries } from '../data';
import { strings } from '../localization';
import { refreshBrowseTree } from '../player/browseTree';
import { reportPlayerNotice } from '../player/notices';
import { catalogFailureMessage } from './catalogFeedback';
import { followingValue } from './catalogModel';

interface UseArtistFollowInput {
  scope: string;
  /** The artist the toggle acts on. Before the detail loads only the id is known. */
  artist: ArtistSummary;
  /** Receives the sanitized failure message, or null once a toggle succeeds. */
  onResult: (message: string | null) => void;
}

/**
 * The account-scoped follow state of one artist and the mutation that
 * toggles it. A failed toggle is reported through `onResult`; a failed
 * Android Auto refresh is a player notice. Neither is swallowed.
 */
export function useArtistFollow({ scope, artist, onResult }: UseArtistFollowInput) {
  const queryClient = useQueryClient();
  const state = useQuery(musicQueries.followingContains(scope, [artist.id]));
  const mutation = useMutation(
    createArtistFollowMutationOptions({
      queryClient,
      scope,
      artist,
      refreshAutoBrowse: refreshBrowseTree,
      onMutationSuccess: () => onResult(null),
      onMutationError: (error) => onResult(catalogFailureMessage('artist-follow', error)),
      onAutoBrowseError: () => {
        reportPlayerNotice(
          'bookkeeping',
          'auto-library-refresh',
          strings.player.autoLibraryFailed,
          strings.player.autoLibraryRefreshFailedMessage,
        );
      },
    }),
  );
  const following = followingValue(state.data, artist.id);
  return {
    state,
    following,
    updating: mutation.isPending,
    toggle: () => mutation.mutate(!following),
  };
}

export type ArtistFollow = ReturnType<typeof useArtistFollow>;
