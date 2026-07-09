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
import { colors } from '../theme';

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
  const run = (label: string, action: () => void) => {
    try {
      action();
    } catch (error) {
      reportPlayerError(label, error);
    }
  };

  return (
    <View style={[styles.bar, { bottom: TAB_BAR_HEIGHT + insets.bottom }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open Now Playing for ${track.title} by ${track.artist}`}
        style={styles.trackButton}
        onPress={() => navigation.navigate('NowPlaying')}
      >
        {track.cover ? (
          <Image source={{ uri: track.cover }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]} />
        )}
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause' : 'Play'}
        onPress={() => run('Play/pause failed', togglePlay)}
        hitSlop={12}
        style={styles.btn}
      >
        {buffering ? <ActivityIndicator color={colors.text} size="small" /> : <Text style={styles.icon}>{playing ? 'Ⅱ' : '▶'}</Text>}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next track"
        onPress={() => run('Skipping to the next track failed', next)}
        hitSlop={12}
        style={styles.btn}
      >
        <Text style={styles.icon}>▶|</Text>
      </Pressable>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
    </View>
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
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  trackButton: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cover: { width: 44, height: 44, borderRadius: 5, backgroundColor: colors.surface },
  coverPlaceholder: { borderWidth: 1, borderColor: colors.border },
  meta: { minWidth: 0, flex: 1 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  artist: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  btn: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  icon: { color: colors.text, fontSize: 20 },
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
