import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useActiveMediaItem, useIsPlaying, useProgress, usePlaybackState, PlaybackState } from '@rntp/player';
import { mediaItemToTrack } from '../player/mediaItem';
import { next, togglePlay } from '../player/controller';
import type { RootStackParams } from '../navigation';
import { colors } from '../theme';

/** Standard Android tab-bar height; the mini-player floats just above it. */
const TAB_BAR_HEIGHT = 56;

export default function MiniPlayer() {
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

  return (
    <Pressable
      style={[styles.bar, { bottom: TAB_BAR_HEIGHT + insets.bottom }]}
      onPress={() => navigation.navigate('NowPlaying')}
    >
      {track.cover ? (
        <Image source={{ uri: track.cover }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]} />
      )}
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
      <Pressable onPress={togglePlay} hitSlop={12} style={styles.btn}>
        {buffering ? (
          <ActivityIndicator color={colors.text} size="small" />
        ) : (
          <Text style={styles.icon}>{playing ? '⏸' : '▶'}</Text>
        )}
      </Pressable>
      <Pressable onPress={next} hitSlop={12} style={styles.btn}>
        <Text style={styles.icon}>⏭</Text>
      </Pressable>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  cover: { width: 44, height: 44, borderRadius: 5, backgroundColor: colors.surface },
  coverPlaceholder: { borderWidth: 1, borderColor: colors.border },
  meta: { flex: 1 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  artist: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  btn: { paddingHorizontal: 8 },
  icon: { color: colors.text, fontSize: 22 },
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
