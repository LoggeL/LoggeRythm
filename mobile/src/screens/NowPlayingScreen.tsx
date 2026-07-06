import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { useActiveMediaItem, useIsPlaying, useProgress, usePlaybackState, PlaybackState, RepeatMode } from '@rntp/player';
import TrackPlayer from '@rntp/player';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as api from '../api/endpoints';
import { mediaItemToTrack } from '../player/mediaItem';
import { cycleRepeat, next, prev, seekTo, toggleShuffle, togglePlay } from '../player/controller';
import type { RootStackParams } from '../navigation';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParams, 'NowPlaying'>;

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function NowPlayingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const item = useActiveMediaItem();
  const playing = useIsPlaying();
  const playbackState = usePlaybackState();
  const { position, duration } = useProgress(0.5);
  const track = mediaItemToTrack(item);
  const buffering = playbackState === PlaybackState.Buffering;

  const [seekValue, setSeekValue] = useState<number | null>(null);
  const [repeat, setRepeat] = useState<RepeatMode>(RepeatMode.Off);
  const [shuffle, setShuffle] = useState(false);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    setRepeat(TrackPlayer.getRepeatMode());
    setShuffle(TrackPlayer.isShuffleEnabled());
  }, []);

  useEffect(() => {
    if (!track) return;
    let alive = true;
    api
      .likesContains([track.id])
      .then((m) => alive && setLiked(!!m[String(track.id)]))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [track?.id]);

  const toggleLike = async () => {
    if (!track) return;
    const wasLiked = liked;
    setLiked(!wasLiked);
    try {
      if (wasLiked) await api.unlikeTrack(track.id);
      else await api.likeTrack(track);
    } catch {
      setLiked(wasLiked); // revert on failure
    }
  };

  if (!track) {
    return (
      <View style={[styles.container, styles.empty]}>
        <Text style={styles.dim}>Nothing playing.</Text>
      </View>
    );
  }

  const sliderPos = seekValue ?? position;
  const repeatLabel = repeat === RepeatMode.One ? '🔂' : '🔁';

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <Pressable style={styles.closeBtn} onPress={() => navigation.goBack()} hitSlop={16}>
        <Text style={styles.closeText}>▾</Text>
      </Pressable>

      <View style={styles.artWrap}>
        {track.cover ? (
          <Image source={{ uri: track.cover }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]} />
        )}
      </View>

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {track.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {track.artist}
          </Text>
        </View>
        <Pressable onPress={toggleLike} hitSlop={12}>
          <Text style={[styles.heart, liked && styles.heartOn]}>{liked ? '♥' : '♡'}</Text>
        </Pressable>
      </View>

      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={Math.max(duration, 1)}
        value={sliderPos}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.surfaceAlt}
        thumbTintColor={colors.accent}
        onValueChange={setSeekValue}
        onSlidingComplete={(v) => {
          seekTo(v);
          setSeekValue(null);
        }}
      />
      <View style={styles.timeRow}>
        <Text style={styles.time}>{fmt(sliderPos)}</Text>
        <Text style={styles.time}>{fmt(duration)}</Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={() => setShuffle(toggleShuffle())}
          hitSlop={12}
        >
          <Text style={[styles.secondaryBtn, shuffle && styles.activeBtn]}>🔀</Text>
        </Pressable>
        <Pressable onPress={prev} hitSlop={12}>
          <Text style={styles.skipBtn}>⏮</Text>
        </Pressable>
        <Pressable style={styles.playBtn} onPress={togglePlay}>
          {buffering ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.playIcon}>{playing ? '⏸' : '▶'}</Text>
          )}
        </Pressable>
        <Pressable onPress={next} hitSlop={12}>
          <Text style={styles.skipBtn}>⏭</Text>
        </Pressable>
        <Pressable onPress={() => setRepeat(cycleRepeat())} hitSlop={12}>
          <Text style={[styles.secondaryBtn, repeat !== RepeatMode.Off && styles.activeBtn]}>
            {repeatLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 28 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  dim: { color: colors.textDim },
  closeBtn: { alignSelf: 'flex-start', paddingVertical: 8 },
  closeText: { color: colors.text, fontSize: 22 },
  // Flexible middle: artwork scales to fill available space and shrinks on
  // small screens so the title/slider/controls below always stay visible.
  artWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 0 },
  art: { width: '100%', aspectRatio: 1, maxHeight: '100%', borderRadius: 12, backgroundColor: colors.surfaceAlt },
  artPlaceholder: { borderWidth: 1, borderColor: colors.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 12 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  artist: { color: colors.textDim, fontSize: 16, marginTop: 4 },
  heart: { color: colors.textDim, fontSize: 28 },
  heartOn: { color: colors.accent },
  slider: { width: '100%', height: 40, marginTop: 24 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  time: { color: colors.textDim, fontSize: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 },
  secondaryBtn: { color: colors.textDim, fontSize: 22 },
  activeBtn: { color: colors.accent },
  skipBtn: { color: colors.text, fontSize: 34 },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#000', fontSize: 30 },
});
