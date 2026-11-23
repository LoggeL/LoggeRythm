import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  PlaybackState,
  useActiveMediaItem,
  useIsPlaying,
  usePlaybackState,
  useProgress,
} from '../player/player';
import { mediaItemToTrack } from '../player/mediaItem';
import { next, prev, togglePlay } from '../player/controller';
import { reportPlayerError } from '../player/errors';
import {
  resolveMiniPlayerSwipe,
  shouldCaptureMiniPlayerSwipe,
} from '../player/playerGestures';
import { useHaptics } from '../hooks/useHaptics';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { RootStackParams } from '../navigation';
import { trackArtistLabel } from '../api/trackArtists';
import { strings } from '../localization';
import { colors, elevation, metrics, opacity, radii, spacing, typography } from '../theme';
import { tvFocusRegistry, useTvEnvironment } from '../tv';
import TrackLikeButton from './TrackLikeButton';
import PlayerNoticeBanner from './PlayerNoticeBanner';
import AppIcon from './AppIcon';
import { Artwork } from './ui/Artwork';
import { createFocusRingController, FocusRingOverlay } from './ui/PressableScale';

export const TAB_BAR_HEIGHT = metrics.tabBarHeight;
/** Content reserves the surface and the gap above the tab bar or safe area. */
export const MINI_PLAYER_HEIGHT = metrics.miniPlayerSurfaceHeight + metrics.miniPlayerGap;

const MAX_DRAG_X = 96;
const MAX_DRAG_Y = 56;
const HORIZONTAL_DRAG_DAMPING = 0.75;
const VERTICAL_DRAG_DAMPING = 0.6;
const PROGRESS_ANIMATION_MS = 220;
const PROGRESS_JUMP_THRESHOLD = 0.15;

/** Clamped [0..1] progress ratio for native-driver `scaleX` rendering. */
export function miniPlayerProgressRatio(position: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  return Math.min(1, safePosition / duration);
}

/**
 * Finger-tracking translation for mini-player gestures: damped horizontal
 * movement for track skip and upward movement for expanding Now Playing.
 */
export function miniPlayerDragOffset(dx: number, dy: number): { x: number; y: number } {
  const safeDx = Number.isFinite(dx) ? dx : 0;
  const safeDy = Number.isFinite(dy) ? dy : 0;
  if (Math.abs(safeDx) >= Math.abs(safeDy)) {
    const clampedX = Math.max(-MAX_DRAG_X, Math.min(MAX_DRAG_X, safeDx * HORIZONTAL_DRAG_DAMPING));
    return { x: clampedX, y: 0 };
  }
  if (safeDy < 0) {
    return { x: 0, y: Math.max(-MAX_DRAG_Y, safeDy * VERTICAL_DRAG_DAMPING) };
  }
  return { x: 0, y: 0 };
}

/**
 * Isolated progress subscriber for the floating mini player.
 * Animates via native-driver `translateX` + `scaleX` so 1Hz playback ticks
 * never trigger Yoga layout passes or re-render `MiniPlayer` / `TrackLikeButton`.
 */
export const MiniPlayerProgressBar = React.memo(function MiniPlayerProgressBar() {
  const { position, duration } = useProgress(1);
  const reducedMotion = useReducedMotion();
  const ratio = miniPlayerProgressRatio(position, duration);
  const [trackWidth, setTrackWidth] = useState(0);
  const [progress] = useState(() => new Animated.Value(ratio));
  const previousRatio = useRef(ratio);

  useEffect(() => {
    const delta = Math.abs(ratio - previousRatio.current);
    previousRatio.current = ratio;
    if (reducedMotion || delta > PROGRESS_JUMP_THRESHOLD || typeof Animated.timing !== 'function') {
      progress.setValue(ratio);
      return;
    }
    Animated.timing(progress, {
      toValue: ratio,
      duration: PROGRESS_ANIMATION_MS,
      useNativeDriver: true,
    }).start();
  }, [progress, ratio, reducedMotion]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (Number.isFinite(nextWidth) && nextWidth > 0) {
      setTrackWidth(nextWidth);
    }
  };

  const translateX = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-trackWidth / 2, 0],
      }),
    [progress, trackWidth],
  );

  return (
    <View
      testID="mini-player-progress"
      accessible={false}
      pointerEvents="none"
      onLayout={handleLayout}
      style={styles.progressTrack}
    >
      <Animated.View
        testID="mini-player-progress-fill"
        style={[
          styles.progressFill,
          { transform: [{ translateX }, { scaleX: progress }] },
        ]}
      />
    </View>
  );
});

/**
 * The floating playback card above the tab bar (or the safe area outside the
 * tabs): artwork, title/artist, like, play/pause, next and a native-driver
 * progress line along its bottom edge. Tap opens Now Playing; finger-tracking
 * horizontal swipes skip, an upward swipe expands. Renders nothing while no
 * track is loaded — pair scroll views with `useBottomInset()` so content clears it.
 */
export default function MiniPlayer({ hasTabBar = true }: { hasTabBar?: boolean }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const tv = useTvEnvironment();
  const reducedMotion = useReducedMotion();
  const haptics = useHaptics();
  const item = useActiveMediaItem();
  const playing = useIsPlaying();
  const playbackState = usePlaybackState();
  const track = mediaItemToTrack(item);

  const [translateX] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(0));

  const openFocus = useMemo(() => createFocusRingController(), []);
  const playPauseFocus = useMemo(() => createFocusRingController(), []);
  const nextFocus = useMemo(() => createFocusRingController(), []);

  const run = useCallback((label: string, action: () => void) => {
    try {
      action();
    } catch (error) {
      reportPlayerError(label, error);
    }
  }, []);

  const openNowPlaying = useCallback(() => {
    haptics.trigger('tap');
    if (tv.isTv) {
      tvFocusRegistry.pushCheckpoint('mini-player');
    }
    navigation.navigate('NowPlaying');
  }, [haptics, navigation, tv.isTv]);

  const resetDragPosition = useCallback(
    (immediate: boolean) => {
      if (immediate || reducedMotion || typeof Animated.spring !== 'function') {
        translateX.setValue(0);
        translateY.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          speed: 24,
          bounciness: 6,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          speed: 24,
          bounciness: 6,
        }),
      ]).start();
    },
    [reducedMotion, translateX, translateY],
  );

  const swipeResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      !tv.isTv && shouldCaptureMiniPlayerSwipe(gesture),
    onPanResponderMove: (_event, gesture) => {
      if (reducedMotion) return;
      const offset = miniPlayerDragOffset(gesture.dx, gesture.dy);
      translateX.setValue(offset.x);
      translateY.setValue(offset.y);
    },
    onPanResponderRelease: (_event, gesture) => {
      const action = resolveMiniPlayerSwipe(gesture);
      if (action === 'next') {
        haptics.trigger('commit');
        run(strings.player.nextFailed, next);
        resetDragPosition(false);
      } else if (action === 'previous') {
        haptics.trigger('commit');
        run(strings.player.previousFailed, prev);
        resetDragPosition(false);
      } else if (action === 'expand') {
        resetDragPosition(true);
        openNowPlaying();
      } else {
        resetDragPosition(false);
      }
    },
    onPanResponderTerminate: () => resetDragPosition(false),
    onPanResponderTerminationRequest: () => true,
  }), [haptics, openNowPlaying, reducedMotion, resetDragPosition, run, translateX, translateY, tv.isTv]);

  if (!track) return null;
  const artistLabel = trackArtistLabel(track);
  const buffering = playbackState === PlaybackState.Buffering;
  const dockBottom = (hasTabBar && !tv.isTv ? TAB_BAR_HEIGHT : 0) + insets.bottom;
  const barBottom = tv.isTv
    ? Math.max(spacing.md, insets.bottom + metrics.miniPlayerGap)
    : dockBottom + metrics.miniPlayerGap;
  const barHeight = tv.isTv ? TV_BAR_HEIGHT : metrics.miniPlayerSurfaceHeight;
  const artworkSize = tv.isTv ? TV_ARTWORK_SIZE : ARTWORK_SIZE;
  const shieldHeight = hasTabBar
    ? metrics.miniPlayerGap + radii.panel
    : insets.bottom + metrics.miniPlayerGap + radii.panel;
  const shieldBottom = hasTabBar ? dockBottom : 0;

  return (
    <>
      <PlayerNoticeBanner
        bottom={barBottom + barHeight + spacing.xs}
      />
      {!tv.isTv ? (
        <View
          testID="mini-player-bottom-shield"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[
            styles.bottomShield,
            { bottom: shieldBottom, height: shieldHeight },
          ]}
        />
      ) : null}
      <Animated.View
        testID="mini-player"
        style={[
          styles.bar,
          tv.isTv ? styles.tvBar : null,
          {
            bottom: barBottom,
            height: barHeight,
            left: tv.isTv ? tv.contentPaddingHorizontal : spacing.xs,
            right: tv.isTv ? tv.contentPaddingHorizontal : spacing.xs,
            transform: [{ translateX }, { translateY }],
          },
        ]}
        {...(tv.isTv ? null : swipeResponder.panHandlers)}
      >
        <Pressable
          testID="mini-player-open"
          accessibilityRole="button"
          accessibilityLabel={strings.player.openNowPlaying(track.title, artistLabel)}
          focusable
          onFocus={() => openFocus.setFocused(true)}
          onBlur={() => openFocus.setFocused(false)}
          style={({ pressed }) => [styles.trackButton, pressed && styles.pressed]}
          onPress={openNowPlaying}
        >
          <Artwork uri={track.cover} size={artworkSize} />
          <View style={styles.meta}>
            <Text
              style={[
                styles.title,
                tv.isTv ? { fontSize: tv.typography.label.fontSize, lineHeight: tv.typography.label.lineHeight } : null,
              ]}
              numberOfLines={1}
            >
              {track.title}
            </Text>
            <Text
              style={[
                styles.artist,
                tv.isTv ? { fontSize: tv.typography.caption.fontSize, lineHeight: tv.typography.caption.lineHeight } : null,
              ]}
              numberOfLines={1}
            >
              {artistLabel}
            </Text>
          </View>
          <FocusRingOverlay controller={openFocus} borderRadius={radii.md} />
        </Pressable>
        <TrackLikeButton track={track} testID="mini-player-like" />
        <Pressable
          testID="mini-player-play-pause"
          accessibilityRole="button"
          accessibilityLabel={playing ? strings.common.pause : strings.common.play}
          accessibilityState={{ busy: buffering }}
          focusable
          onFocus={() => playPauseFocus.setFocused(true)}
          onBlur={() => playPauseFocus.setFocused(false)}
          onPress={() => {
            haptics.trigger('commit');
            run(strings.player.playPauseFailed, togglePlay);
          }}
          style={({ pressed }) => [
            styles.btn,
            pressed && (reducedMotion ? styles.pressed : styles.pressedControl),
          ]}
        >
          <View style={styles.playDisc}>
            {buffering ? (
              <ActivityIndicator color={colors.onLight} size="small" />
            ) : (
              <AppIcon name={playing ? 'pause' : 'play'} color={colors.onLight} size={24} />
            )}
          </View>
          <FocusRingOverlay controller={playPauseFocus} borderRadius={radii.pill} />
        </Pressable>
        <Pressable
          testID="mini-player-next"
          accessibilityRole="button"
          accessibilityLabel={strings.common.nextTrack}
          focusable
          onFocus={() => nextFocus.setFocused(true)}
          onBlur={() => nextFocus.setFocused(false)}
          onPress={() => {
            haptics.trigger('commit');
            run(strings.player.nextFailed, next);
          }}
          style={({ pressed }) => [
            styles.btn,
            pressed && (reducedMotion ? styles.pressed : styles.pressedControl),
          ]}
        >
          <AppIcon name="skip-next" color={colors.textPrimary} size={28} />
          <FocusRingOverlay controller={nextFocus} borderRadius={radii.pill} />
        </Pressable>
        <MiniPlayerProgressBar />
      </Animated.View>
    </>
  );
}

const ARTWORK_SIZE = 44;
const TV_ARTWORK_SIZE = 52;
const TV_BAR_HEIGHT = 76;
const PLAY_DISC_SIZE = 40;

const styles = StyleSheet.create({
  bottomShield: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.background,
    zIndex: 1,
  },
  bar: {
    position: 'absolute',
    left: spacing.xs,
    right: spacing.xs,
    height: metrics.miniPlayerSurfaceHeight,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.panel,
    paddingLeft: spacing.xs + 1,
    paddingRight: spacing.xxs,
    overflow: 'hidden',
    zIndex: 2,
    ...elevation.floating,
  },
  tvBar: {
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    gap: spacing.xs,
  },
  trackButton: {
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.xs,
    borderRadius: radii.md,
  },
  meta: { minWidth: 0, flex: 1 },
  title: { ...typography.label, color: colors.textPrimary },
  artist: { ...typography.caption, color: colors.textSecondary },
  btn: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playDisc: {
    width: PLAY_DISC_SIZE,
    height: PLAY_DISC_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.textPrimary,
  },
  pressed: { opacity: opacity.pressed },
  pressedControl: { opacity: opacity.pressed, transform: [{ scale: 0.92 }] },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: colors.fill,
    overflow: 'hidden',
  },
  progressFill: {
    width: '100%',
    height: 2,
    backgroundColor: colors.accent,
  },
});
