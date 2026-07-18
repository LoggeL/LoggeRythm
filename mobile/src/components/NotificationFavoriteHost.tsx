import React, { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { Track } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { getCurrentApiBase } from '../config';
import {
  createTrackLikeMutationOptions,
  musicCacheScope,
  musicQueries,
  trackLikeMutationKey,
} from '../data';
import Player, { Event, useActiveMediaItem } from '../player/player';
import { refreshBrowseTree } from '../player/browseTree';
import { reportPlayerError } from '../player/errors';
import { mediaItemToTrack } from '../player/mediaItem';
import { reportPlayerNotice } from '../player/notices';
import { strings } from '../localization';

interface ActiveFavoriteHostProps {
  mediaId: string;
  scope: string;
  track: Track;
}

function ActiveFavoriteHost({ mediaId, scope, track }: ActiveFavoriteHostProps) {
  const queryClient = useQueryClient();
  const likes = useQuery({
    ...musicQueries.likes(scope),
    select: (tracks) => tracks.some((item) => item.id === track.id),
  });
  const matchingMutations = useIsMutating({
    mutationKey: trackLikeMutationKey(scope, track.id),
    exact: true,
  });
  const mutation = useMutation(createTrackLikeMutationOptions({
    queryClient,
    scope,
    track,
    refreshAutoBrowse: refreshBrowseTree,
    onMutationError: () => reportPlayerError(strings.player.likeFailed, null),
    onMutationSuccess: (nextLiked) => {
      AccessibilityInfo.announceForAccessibility(
        nextLiked
          ? strings.player.likedTrack(track.title)
          : strings.player.unlikedTrack(track.title),
      );
    },
    onAutoBrowseError: () => reportPlayerNotice(
      'bookkeeping',
      'auto-library-refresh',
      strings.player.autoLibraryFailed,
      strings.player.autoLibraryRefreshFailedMessage,
    ),
  }));

  const publishedLiked = likes.data !== undefined && matchingMutations === 0
    ? likes.data
    : null;

  useEffect(() => {
    const publication = publishedLiked === null
      ? Player.setNotificationFavoriteState(null, null)
      : Player.setNotificationFavoriteState(mediaId, publishedLiked);
    void publication.catch((cause) => reportPlayerError(strings.player.likeFailed, cause));
  }, [mediaId, publishedLiked]);

  useEffect(() => {
    const subscription = Player.addEventListener(Event.RemoteToggleFavorite, (event) => {
      if (event.mediaId !== mediaId) {
        reportPlayerError(strings.player.likeFailed, new Error('Notification favorite item changed'));
        return;
      }
      mutation.mutate(event.requestedLiked);
    });
    return () => subscription.remove();
  }, [mediaId, mutation]);

  useEffect(() => () => {
    void Player.setNotificationFavoriteState(null, null).catch((cause) =>
      reportPlayerError(strings.player.likeFailed, cause));
  }, []);

  return null;
}

/** Keeps Media3's notification heart synchronized with the account-scoped likes cache. */
export default function NotificationFavoriteHost() {
  const { user } = useAuth();
  const item = useActiveMediaItem();
  const track = mediaItemToTrack(item);
  if (user === null || !user.is_approved || item?.mediaId === undefined || track === null) {
    return null;
  }
  return (
    <ActiveFavoriteHost
      key={`${item.mediaId}:${track.id}`}
      mediaId={item.mediaId}
      scope={musicCacheScope(getCurrentApiBase(), user.id)}
      track={track}
    />
  );
}
