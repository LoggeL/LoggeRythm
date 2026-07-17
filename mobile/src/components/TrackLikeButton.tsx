import React from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  ToastAndroid,
  View,
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

interface EpicLikeGlyphProps {
  liked: boolean;
  color: string;
}

interface EpicLikeGlyphState {
  reduceMotion: boolean;
}

const burstParticles = [
  { x: 0, y: -26, color: colors.accentSoft },
  { x: 23, y: -13, color: colors.warning },
  { x: 25, y: 14, color: colors.accent },
  { x: 0, y: 27, color: colors.accentSoft },
  { x: -24, y: 14, color: colors.warning },
  { x: -23, y: -13, color: colors.accent },
] as const;

/**
 * The celebration owns only transform/opacity animations, allowing Android's
 * native driver to keep every frame off the JS thread.
 */
class EpicLikeGlyph extends React.PureComponent<EpicLikeGlyphProps, EpicLikeGlyphState> {
  state: EpicLikeGlyphState = { reduceMotion: true };

  private readonly heartScale = new Animated.Value(1);

  private readonly burst = new Animated.Value(0);

  private animation: Animated.CompositeAnimation | null = null;

  private mounted = false;

  private reduceMotionSubscription: { remove: () => void } | null = null;

  componentDidMount(): void {
    this.mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (this.mounted) this.setState({ reduceMotion });
    });
    this.reduceMotionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (reduceMotion) => {
        this.setState({ reduceMotion });
        if (reduceMotion) {
          this.animation?.stop();
          this.heartScale.setValue(1);
          this.burst.setValue(0);
        }
      },
    );
  }

  componentDidUpdate(previous: EpicLikeGlyphProps): void {
    if (!previous.liked && this.props.liked) this.celebrate();
  }

  componentWillUnmount(): void {
    this.mounted = false;
    this.animation?.stop();
    this.reduceMotionSubscription?.remove();
  }

  private celebrate(): void {
    this.animation?.stop();
    this.heartScale.setValue(1);
    this.burst.setValue(0);
    if (this.state.reduceMotion) return;

    this.animation = Animated.parallel([
      Animated.sequence([
        Animated.timing(this.heartScale, {
          toValue: 0.72,
          duration: 65,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(this.heartScale, {
          toValue: 1.48,
          speed: 24,
          bounciness: 13,
          useNativeDriver: true,
        }),
        Animated.spring(this.heartScale, {
          toValue: 1,
          speed: 18,
          bounciness: 8,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(this.burst, {
        toValue: 1,
        duration: 620,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    this.animation.start(({ finished }) => {
      if (finished) this.burst.setValue(0);
    });
  }

  render() {
    const { liked, color } = this.props;
    const burstOpacity = this.burst.interpolate({
      inputRange: [0, 0.12, 0.72, 1],
      outputRange: [0, 1, 0.82, 0],
    });
    return (
      <View accessible={false} pointerEvents="none" style={styles.celebrationFrame}>
        <Animated.View
          style={[
            styles.burstRing,
            {
              opacity: burstOpacity,
              transform: [{
                scale: this.burst.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.35, 1.75],
                }),
              }],
            },
          ]}
        />
        {burstParticles.map((particle, index) => (
          <Animated.View
            key={`${particle.x}:${particle.y}`}
            style={[
              styles.burstParticle,
              {
                opacity: burstOpacity,
                transform: [
                  {
                    translateX: this.burst.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, particle.x],
                    }),
                  },
                  {
                    translateY: this.burst.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, particle.y],
                    }),
                  },
                  {
                    scale: this.burst.interpolate({
                      inputRange: [0, 0.32, 1],
                      outputRange: [0.2, 1.15, 0.45],
                    }),
                  },
                  { rotate: `${index * 60}deg` },
                ],
              },
            ]}
          >
            <AppIcon name="star-four-points" color={particle.color} size={9} />
          </Animated.View>
        ))}
        <Animated.View style={{ transform: [{ scale: this.heartScale }] }}>
          <AppIcon
            name={liked ? 'heart' : 'heart-outline'}
            color={color}
            size={28}
          />
        </Animated.View>
      </View>
    );
  }
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
        queryRetry && !hasLikeState ? (
          <AppIcon name="refresh" color={colors.warning} size={28} />
        ) : (
          <EpicLikeGlyph
            liked={liked}
            color={
              cachedQueryIssue
                ? colors.warning
                : liked
                  ? colors.accent
                  : colors.textSecondary
            }
          />
        )
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
    overflow: 'visible',
  },
  celebrationFrame: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  burstRing: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.accentSoft,
  },
  burstParticle: {
    position: 'absolute',
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busy: { opacity: 0.72 },
  pressed: { backgroundColor: colors.surfacePressed },
});
