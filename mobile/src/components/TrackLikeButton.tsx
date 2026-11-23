import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useHaptics } from '../hooks/useHaptics';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { strings } from '../localization';
import { refreshBrowseTree } from '../player/browseTree';
import { reportPlayerNotice } from '../player/notices';
import { colors, metrics, opacity, radii } from '../theme';
import AppIcon from './AppIcon';
import {
  createFocusRingController,
  FocusRingOverlay,
  type TvFocusProps,
} from './ui';

export interface TrackLikeButtonProps extends TvFocusProps {
  track: Track;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export interface EpicLikeGlyphProps {
  liked: boolean;
  color: string;
  celebrating?: boolean;
  celebrationKey?: number;
  onCelebrationComplete?: () => void;
}

/** Same glyph size as IconButton md, so Like lines up with the overflow control. */
const GLYPH_SIZE = 24;

const burstParticles = [
  { x: 0, y: -26, color: colors.accentSoft },
  { x: 23, y: -13, color: colors.warning },
  { x: 25, y: 14, color: colors.accent },
  { x: 0, y: 27, color: colors.accentSoft },
  { x: -24, y: 14, color: colors.warning },
  { x: -23, y: -13, color: colors.accent },
] as const;

const likedIdSetCache = new WeakMap<readonly Track[], ReadonlySet<string>>();

/**
 * Derive one O(1) lookup set per React Query likes array reference.
 * All visible rows share the cached Set without duplicating O(L) scans.
 */
export function getLikedTrackIdSet(tracks: readonly Track[]): ReadonlySet<string> {
  let ids = likedIdSetCache.get(tracks);
  if (ids === undefined) {
    ids = new Set(tracks.map((item) => String(item.id)));
    likedIdSetCache.set(tracks, ids);
  }
  return ids;
}

interface ActiveLikeCelebrationProps {
  liked: boolean;
  color: string;
  onComplete?: () => void;
}

/**
 * Mounted ONLY while an active user-triggered like burst is running (0 idle
 * Animated views or interpolations at rest). Owns transform/opacity animations
 * exclusively so Android's native driver keeps every frame off the JS thread.
 */
const ActiveLikeCelebration = React.memo(function ActiveLikeCelebration({
  liked,
  color,
  onComplete,
}: ActiveLikeCelebrationProps) {
  const [heartScale] = useState(() => new Animated.Value(1));
  const [burst] = useState(() => new Animated.Value(0));
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const interpolations = useMemo(() => {
    const burstOpacity = burst.interpolate({
      inputRange: [0, 0.12, 0.72, 1],
      outputRange: [0, 1, 0.82, 0],
    });
    const ringScale = burst.interpolate({
      inputRange: [0, 1],
      outputRange: [0.35, 1.75],
    });
    const particleScale = burst.interpolate({
      inputRange: [0, 0.32, 1],
      outputRange: [0.2, 1.15, 0.45],
    });
    const particles = burstParticles.map((particle, index) => ({
      key: `${particle.x}:${particle.y}`,
      color: particle.color,
      translateX: burst.interpolate({
        inputRange: [0, 1],
        outputRange: [0, particle.x],
      }),
      translateY: burst.interpolate({
        inputRange: [0, 1],
        outputRange: [0, particle.y],
      }),
      rotate: `${index * 60}deg`,
    }));
    return { burstOpacity, ringScale, particleScale, particles };
  }, [burst]);

  useEffect(() => {
    heartScale.setValue(1);
    burst.setValue(0);
    const animation = Animated.parallel([
      Animated.sequence([
        Animated.timing(heartScale, {
          toValue: 0.72,
          duration: 65,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(heartScale, {
          toValue: 1.48,
          speed: 24,
          bounciness: 13,
          useNativeDriver: true,
        }),
        Animated.spring(heartScale, {
          toValue: 1,
          speed: 18,
          bounciness: 8,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(burst, {
        toValue: 1,
        duration: 620,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished) {
        burst.setValue(0);
        onCompleteRef.current?.();
      }
    });
    return () => {
      animation.stop();
    };
  }, [burst, heartScale]);

  return (
    <View
      testID="like-celebration-active"
      accessible={false}
      pointerEvents="none"
      style={styles.celebrationFrame}
    >
      <Animated.View
        style={[
          styles.burstRing,
          {
            opacity: interpolations.burstOpacity,
            transform: [{ scale: interpolations.ringScale }],
          },
        ]}
      />
      {interpolations.particles.map((particle) => (
        <Animated.View
          key={particle.key}
          style={[
            styles.burstParticle,
            {
              opacity: interpolations.burstOpacity,
              transform: [
                { translateX: particle.translateX },
                { translateY: particle.translateY },
                { scale: interpolations.particleScale },
                { rotate: particle.rotate },
              ],
            },
          ]}
        >
          <AppIcon name="star-four-points" color={particle.color} size={9} />
        </Animated.View>
      ))}
      <Animated.View style={{ transform: [{ scale: heartScale }] }}>
        <AppIcon
          name={liked ? 'heart' : 'heart-outline'}
          color={color}
          size={GLYPH_SIZE}
        />
      </Animated.View>
    </View>
  );
});

/**
 * Renders a lightweight static heart at rest (0 Animated views, 0 particles,
 * 0 native listeners) and mounts `ActiveLikeCelebration` only during an active
 * user-triggered like burst.
 */
export function EpicLikeGlyph({
  liked,
  color,
  celebrating = false,
  celebrationKey = 0,
  onCelebrationComplete,
}: EpicLikeGlyphProps) {
  if (celebrating) {
    return (
      <ActiveLikeCelebration
        key={celebrationKey}
        liked={liked}
        color={color}
        onComplete={onCelebrationComplete}
      />
    );
  }
  return (
    <AppIcon
      name={liked ? 'heart' : 'heart-outline'}
      color={color}
      size={GLYPH_SIZE}
    />
  );
}

function notifyFailure(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
}

/** Account-scoped favorite control shared by rows, cards, and player surfaces. */
export default function TrackLikeButton({
  track,
  testID,
  style,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused = false,
  focusedStyle,
}: TrackLikeButtonProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const haptics = useHaptics();
  const [focusController] = useState(createFocusRingController);
  const trackId = String(track.id);
  const burstSequenceRef = useRef(0);
  const [celebration, setCelebration] = useState<{
    ownerTrackId: string;
    burstId: number;
  } | null>(null);

  // Drop stale celebration ownership immediately on FlatList row recycle (A -> B -> A)
  // or when reduced motion turns on, so passive rows never burst.
  if (
    celebration !== null
    && (celebration.ownerTrackId !== trackId || reducedMotion)
  ) {
    setCelebration(null);
  }
  const activeCelebration =
    !reducedMotion && celebration !== null && celebration.ownerTrackId === trackId
      ? celebration
      : null;

  const clearCelebration = useCallback(() => {
    setCelebration((current) =>
      current !== null && current.ownerTrackId === trackId ? null : current,
    );
  }, [trackId]);

  const scope =
    user === null
      ? 'signed-out'
      : musicCacheScope(getCurrentApiBase(), user.id);
  const selectLiked = useCallback(
    (tracks: readonly Track[]) => getLikedTrackIdSet(tracks).has(trackId),
    [trackId],
  );
  const likes = useQuery({
    ...musicQueries.likes(scope),
    enabled: user !== null,
    select: selectLiked,
  });
  const mutationKey = trackLikeMutationKey(scope, track.id);
  const matchingMutations = useIsMutating({ mutationKey, exact: true });
  const mutation = useMutation(
    createTrackLikeMutationOptions({
      queryClient,
      scope,
      track,
      refreshAutoBrowse: refreshBrowseTree,
      onMutationError: () => {
        clearCelebration();
        notifyFailure(strings.player.likeFailed);
      },
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
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      android_ripple={{
        color: colors.fillStrong,
        borderless: true,
        radius: metrics.minimumTouchTarget / 2,
      }}
      hitSlop={8}
      onFocus={(event) => {
        focusController.setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        focusController.setFocused(false);
        onBlur?.(event);
      }}
      onPress={() => {
        if (queryRetry) {
          void likes.refetch();
          return;
        }
        const nextLiked = !liked;
        if (nextLiked) {
          haptics.trigger('like');
          if (!reducedMotion) {
            burstSequenceRef.current += 1;
            setCelebration({
              ownerTrackId: trackId,
              burstId: burstSequenceRef.current,
            });
          }
        } else {
          clearCelebration();
        }
        mutation.mutate(nextLiked);
      }}
      style={({ pressed }) => [
        styles.button,
        style,
        busy && styles.busy,
        pressed && !disabled && (reducedMotion ? styles.pressedReduced : styles.pressed),
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
          <AppIcon name="refresh" color={colors.warning} size={GLYPH_SIZE} />
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
            celebrating={activeCelebration !== null}
            celebrationKey={activeCelebration?.burstId ?? 0}
            onCelebrationComplete={clearCelebration}
          />
        )
      )}
      <FocusRingOverlay
        controller={focusController}
        borderRadius={radii.pill}
        controlledFocused={focused}
        disabled={disabled}
        focusedStyle={focusedStyle}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
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
    borderRadius: radii.pill,
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
  busy: { opacity: opacity.pressed },
  pressed: { opacity: opacity.pressed, transform: [{ scale: 0.94 }] },
  pressedReduced: { opacity: opacity.pressed },
});
