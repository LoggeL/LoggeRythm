import React from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  ToastAndroid,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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
import { resolveRemoteVisualState } from '../data/remoteState';
import { strings } from '../localization';
import { refreshBrowseTree } from '../player/browseTree';
import { reportPlayerNotice } from '../player/notices';
import { colors, metrics } from '../theme';
import AppIcon from './AppIcon';

interface TrackLikeButtonProps {
  track: Track;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

function notifyFailure(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
}

/** Account-scoped favorite control shared by rows, cards, and player surfaces. */
export default function TrackLikeButton({ track, testID, style }: TrackLikeButtonProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const scope =
    user === null
      ? 'signed-out'
      : musicCacheScope(getCurrentApiBase(), user.id);
  const likes = useQuery({
    ...musicQueries.likes(scope),
    enabled: user !== null,
    select: (tracks) => tracks.some((item) => item.id === track.id),
  });
  const mutationKey = trackLikeMutationKey(scope, track.id);
  const matchingMutations = useIsMutating({ mutationKey, exact: true });
  const mutation = useMutation(
    createTrackLikeMutationOptions({
      queryClient,
      scope,
      track,
      refreshAutoBrowse: refreshBrowseTree,
      onMutationError: () => notifyFailure(strings.player.likeFailed),
      onMutationSuccess: (nextLiked) => {
        AccessibilityInfo.announceForAccessibility(
          nextLiked
            ? strings.player.likedTrack(track.title)
            : strings.player.unlikedTrack(track.title),
        );
      },
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

  const visual = resolveRemoteVisualState({
    hasData: likes.data !== undefined,
    empty: false,
    pending: likes.isPending,
    fetching: likes.isFetching,
    stale: likes.isStale,
    fetchStatus: likes.fetchStatus,
    error: likes.error,
  });
  const liked = likes.data === true;
  const hasLikeState = likes.data !== undefined;
  const loading = user !== null && visual.body === 'loading';
  const queryRetry = user !== null && (
    visual.body === 'offline'
    || visual.body === 'hard-error'
  );
  const cachedQueryIssue = visual.notice === 'cached-offline'
    || visual.notice === 'cached-refresh-error';
  const busy = loading || mutation.isPending || matchingMutations > 0;
  const disabled = user === null || busy;
  let accessibilityLabel: string;
  let accessibilityHint: string | undefined;
  if (user === null) {
    accessibilityLabel = strings.player.likeStateUnavailable(track.title);
  } else if (loading) {
    accessibilityLabel = strings.player.likeStateLoading(track.title);
  } else if (queryRetry) {
    accessibilityLabel = strings.player.retryLikeState(track.title);
    accessibilityHint = visual.body === 'offline' || visual.notice === 'cached-offline'
      ? strings.player.likeStateOffline
      : strings.player.likeStateLoadFailed;
  } else {
    accessibilityLabel = `${liked ? strings.player.unlikeTrack : strings.player.likeTrack}: ${track.title}`;
    if (cachedQueryIssue) {
      accessibilityHint = visual.notice === 'cached-offline'
        ? strings.player.likeStateOffline
        : strings.player.likeStateLoadFailed;
    } else if (visual.notice === 'refreshing') {
      accessibilityHint = strings.player.likeStateRefreshing;
    } else if (visual.notice === 'stale') {
      accessibilityHint = strings.player.likeStateStale;
    }
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        ...(hasLikeState ? { checked: liked } : {}),
        disabled,
        busy,
      }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        if (queryRetry) {
          void likes.refetch();
          return;
        }
        mutation.mutate(!liked);
      }}
      style={({ pressed }) => [
        styles.button,
        style,
        busy && styles.busy,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          accessible={false}
          color={colors.accent}
          size="small"
        />
      ) : (
        <AppIcon
          name={queryRetry && !hasLikeState ? 'refresh' : liked ? 'heart' : 'heart-outline'}
          color={
            queryRetry || cachedQueryIssue
              ? colors.warning
              : liked
                ? colors.accent
                : colors.textSecondary
          }
          size={28}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busy: { opacity: 0.72 },
  pressed: { backgroundColor: colors.surfacePressed },
});
