import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
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
import type { RootStackParams } from '../navigation';
import { trackArtistLabel } from '../api/trackArtists';
import { strings } from '../localization';
import { colors, elevation, metrics, opacity, radii, spacing, typography } from '../theme';
import TrackLikeButton from './TrackLikeButton';
import PlayerNoticeBanner from './PlayerNoticeBanner';
import AppIcon from './AppIcon';
import { Artwork } from './ui/Artwork';

export const TAB_BAR_HEIGHT = metrics.tabBarHeight;
/** Content reserves the surface and the gap above the tab bar or safe area. */
export const MINI_PLAYER_HEIGHT = metrics.miniPlayerSurfaceHeight + metrics.miniPlayerGap;

/**
 * The floating playback card above the tab bar (or the safe area outside the
 * tabs): artwork, title/artist, like, play/pause, next and a thin progress
 * line along its bottom edge. Tap opens Now Playing; horizontal swipes skip,
 * an upward swipe expands. Renders nothing while no track is loaded — pair
 * scroll views with `useBottomInset()` so content clears it.
 */
export default function MiniPlayer({ hasTabBar = true }: { hasTabBar?: boolean }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const item = useActiveMediaItem();
  const playing = useIsPlaying();
  const playbackState = usePlaybackState();
  const { position, duration } = useProgress(1);
  const track = mediaItemToTrack(item);

  const openNowPlaying = useCallback(
    () => navigation.navigate('NowPlaying'),
    [navigation],
  );
  const run = (label: string, action: () => void) => {
    try {
      action();
    } catch (error) {
      reportPlayerError(label, error);
    }
  };
  const swipeResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      shouldCaptureMiniPlayerSwipe(gesture),
    onPanResponderRelease: (_event, gesture) => {
      const action = resolveMiniPlayerSwipe(gesture);
      if (action === 'next') run(strings.player.nextFailed, next);
      else if (action === 'previous') run(strings.player.previousFailed, prev);
      else if (action === 'expand') openNowPlaying();
    },
    onPanResponderTerminationRequest: () => true,
  }), [openNowPlaying]);

  if (!track) return null;
  const artistLabel = trackArtistLabel(track);
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const buffering = playbackState === PlaybackState.Buffering;

  return (
    <>
      <PlayerNoticeBanner
        bottom={(hasTabBar ? TAB_BAR_HEIGHT : 0) + insets.bottom + MINI_PLAYER_HEIGHT + spacing.xs}
      />
      <View
        testID="mini-player"
        style={[styles.bar, {
          bottom: (hasTabBar ? TAB_BAR_HEIGHT : 0) + insets.bottom + metrics.miniPlayerGap,
        }]}
        {...swipeResponder.panHandlers}
      >
        <Pressable
          testID="mini-player-open"
          accessibilityRole="button"
          accessibilityLabel={strings.player.openNowPlaying(track.title, artistLabel)}
          style={({ pressed }) => [styles.trackButton, pressed && styles.pressed]}
          onPress={openNowPlaying}
        >
          <Artwork uri={track.cover} size={ARTWORK_SIZE} />
          <View style={styles.meta}>
            <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
            <Text style={styles.artist} numberOfLines={1}>{artistLabel}</Text>
          </View>
        </Pressable>
        <TrackLikeButton track={track} testID="mini-player-like" />
        <Pressable
          testID="mini-player-play-pause"
          accessibilityRole="button"
          accessibilityLabel={playing ? strings.common.pause : strings.common.play}
          accessibilityState={{ busy: buffering }}
          onPress={() => run(strings.player.playPauseFailed, togglePlay)}
          style={({ pressed }) => [styles.btn, pressed && styles.pressedControl]}
        >
          <View style={styles.playDisc}>
            {buffering ? (
              <ActivityIndicator color={colors.onLight} size="small" />
            ) : (
              <AppIcon name={playing ? 'pause' : 'play'} color={colors.onLight} size={24} />
            )}
          </View>
        </Pressable>
        <Pressable
          testID="mini-player-next"
          accessibilityRole="button"
          accessibilityLabel={strings.common.nextTrack}
          onPress={() => run(strings.player.nextFailed, next)}
          style={({ pressed }) => [styles.btn, pressed && styles.pressedControl]}
        >
          <AppIcon name="skip-next" color={colors.textPrimary} size={28} />
        </Pressable>
        <View accessible={false} pointerEvents="none" style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      </View>
    </>
  );
}

const ARTWORK_SIZE = 44;
const PLAY_DISC_SIZE = 40;

const styles = StyleSheet.create({
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
  trackButton: {
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.xs,
  },
  meta: { minWidth: 0, flex: 1 },
  title: { ...typography.label, color: colors.textPrimary },
  artist: { ...typography.caption, color: colors.textSecondary },
  btn: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
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
  },
  progressFill: { height: 2, backgroundColor: colors.accent },
});
