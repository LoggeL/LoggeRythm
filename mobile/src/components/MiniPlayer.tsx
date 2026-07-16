import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  PlaybackState,
  useActiveMediaItem,
  useIsPlaying,
  usePlaybackState,
  useProgress,
} from '@rntp/player';
import { mediaItemToTrack } from '../player/mediaItem';
import { next, togglePlay } from '../player/controller';
import { reportPlayerError } from '../player/errors';
import type { RootStackParams } from '../navigation';
import { strings } from '../localization';
import { colors, metrics } from '../theme';
import TrackLikeButton from './TrackLikeButton';
import PlayerNoticeBanner from './PlayerNoticeBanner';
import AppIcon from './AppIcon';

export const TAB_BAR_HEIGHT = 56;
export const MINI_PLAYER_HEIGHT = 64;

export default function MiniPlayer({ hasTabBar = true }: { hasTabBar?: boolean }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const item = useActiveMediaItem();
  const playing = useIsPlaying();
  const playbackState = usePlaybackState();
  const { position, duration } = useProgress(1);
  const track = mediaItemToTrack(item);

  if (!track) return null;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const buffering = playbackState === PlaybackState.Buffering;
  const run = (label: string, action: () => void) => {
    try {
      action();
    } catch (error) {
      reportPlayerError(label, error);
    }
  };

  return (
    <>
      <PlayerNoticeBanner
        bottom={(hasTabBar ? TAB_BAR_HEIGHT : 0) + insets.bottom + MINI_PLAYER_HEIGHT + 8}
      />
      <View
        testID="mini-player"
        style={[styles.bar, { bottom: (hasTabBar ? TAB_BAR_HEIGHT : 0) + insets.bottom }]}
      >
        <Pressable
          testID="mini-player-open"
          accessibilityRole="button"
          accessibilityLabel={strings.player.openNowPlaying(track.title, track.artist)}
          style={styles.trackButton}
          onPress={() => navigation.navigate('NowPlaying')}
        >
          {track.cover ? (
            <Image accessible={false} source={{ uri: track.cover }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverPlaceholder]} />
          )}
          <View style={styles.meta}>
            <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
            <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
          </View>
        </Pressable>
        <TrackLikeButton track={track} testID="mini-player-like" />
        <Pressable
          testID="mini-player-play-pause"
          accessibilityRole="button"
          accessibilityLabel={playing ? strings.common.pause : strings.common.play}
          accessibilityState={{ busy: buffering }}
          onPress={() => run(strings.player.playPauseFailed, togglePlay)}
          style={styles.btn}
        >
          {buffering ? (
            <ActivityIndicator color={colors.textPrimary} size="small" />
          ) : (
            <AppIcon
              name={playing ? 'pause' : 'play'}
              color={colors.textPrimary}
              size={24}
            />
          )}
        </Pressable>
        <Pressable
          testID="mini-player-next"
          accessibilityRole="button"
          accessibilityLabel={strings.common.nextTrack}
          onPress={() => run(strings.player.nextFailed, next)}
          style={styles.btn}
        >
          <AppIcon name="skip-next" color={colors.textPrimary} size={26} />
        </Pressable>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    zIndex: 2,
    elevation: 6,
  },
  trackButton: { minWidth: 0, minHeight: metrics.minimumTouchTarget, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cover: { width: 44, height: 44, borderRadius: 5, backgroundColor: colors.surface },
  coverPlaceholder: { borderWidth: 1, borderColor: colors.border },
  meta: { minWidth: 0, flex: 1 },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  artist: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  btn: { minWidth: metrics.minimumTouchTarget, minHeight: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  progressTrack: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 3,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  progressFill: { height: 2, backgroundColor: colors.accent },
});
