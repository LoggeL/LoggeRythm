import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import TrackPlayer, {
  PlaybackState,
  RepeatMode,
  useActiveMediaItem,
  useIsPlaying,
  usePlaybackState,
  useProgress,
} from '@rntp/player';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as api from '../api/endpoints';
import { refreshBrowseTree } from '../player/browseTree';
import { mediaItemToTrack } from '../player/mediaItem';
import { cycleRepeat, next, prev, seekTo, toggleShuffle, togglePlay } from '../player/controller';
import { clearPlayerError, reportPlayerError, usePlayerError } from '../player/errors';
import type { RootStackParams } from '../navigation';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParams, 'NowPlaying'>;

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

export default function NowPlayingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const item = useActiveMediaItem();
  const playing = useIsPlaying();
  const playbackState = usePlaybackState();
  const { position, duration } = useProgress(0.5);
  const track = mediaItemToTrack(item);
  const playerError = usePlayerError();

  const [seekState, setSeekState] = useState<{ trackId: string; value: number } | null>(null);
  const [repeat, setRepeat] = useState<RepeatMode>(() => TrackPlayer.getRepeatMode());
  const [shuffle, setShuffle] = useState(() => TrackPlayer.isShuffleEnabled());
  const [likeState, setLikeState] = useState<{
    trackId: string;
    liked: boolean;
    loading: boolean;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    const trackId = track?.id;
    if (!trackId) return;
    const controller = new AbortController();
    void api
      .likesContains([trackId], controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!(trackId in result)) {
          throw new Error(`Like lookup omitted track ${trackId}`);
        }
        setLikeState({ trackId, liked: result[trackId], loading: false, error: null });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setLikeState({ trackId, liked: false, loading: false, error: (cause as Error).message });
        }
      });
    return () => controller.abort();
  }, [track?.id]);

  const toggleLike = async () => {
    if (!track) return;
    const currentLike =
      likeState?.trackId === track.id
        ? likeState
        : { trackId: track.id, liked: false, loading: true, error: null };
    if (currentLike.loading) return;
    const targetId = track.id;
    const nextLiked = !currentLike.liked;
    setLikeState({ ...currentLike, loading: true, error: null });
    try {
      if (nextLiked) await api.likeTrack(track);
      else await api.unlikeTrack(targetId);
      if (mediaItemToTrack(TrackPlayer.getActiveMediaItem())?.id === targetId) {
        setLikeState({ trackId: targetId, liked: nextLiked, loading: false, error: null });
      }
      void refreshBrowseTree().catch((cause) =>
        reportPlayerError('Android Auto library refresh failed', cause),
      );
    } catch (cause) {
      if (mediaItemToTrack(TrackPlayer.getActiveMediaItem())?.id === targetId) {
        setLikeState({
          trackId: targetId,
          liked: currentLike.liked,
          loading: false,
          error: (cause as Error).message,
        });
      }
    }
  };

  const run = (label: string, action: () => void) => {
    try {
      action();
    } catch (cause) {
      reportPlayerError(label, cause);
    }
  };

  const topBar = (
    <View style={styles.topBar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close Now Playing"
        style={styles.closeButton}
        onPress={() => navigation.goBack()}
        hitSlop={16}
      >
        <Text style={styles.closeText}>⌄</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open queue"
        style={styles.queueButton}
        onPress={() => navigation.navigate('Queue')}
        hitSlop={12}
      >
        <Text style={styles.queueButtonText}>Queue</Text>
      </Pressable>
    </View>
  );

  if (!track) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
        {topBar}
        <View style={styles.empty}>
          <Text style={styles.dim}>Nothing playing.</Text>
        </View>
      </View>
    );
  }

  const buffering = playbackState === PlaybackState.Buffering;
  const currentLike =
    likeState?.trackId === track.id
      ? likeState
      : { trackId: track.id, liked: false, loading: true, error: null };
  const sliderPosition = seekState?.trackId === track.id ? seekState.value : position;
  const repeatLabel = repeat === RepeatMode.One ? '1↻' : '↻';

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 },
      ]}
    >
      {topBar}

      <View style={styles.artWrap}>
        {track.cover ? (
          <Image source={{ uri: track.cover }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]} />
        )}
      </View>

      <View style={styles.titleRow}>
        <View style={styles.titleMeta}>
          <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={currentLike.liked ? 'Unlike track' : 'Like track'}
          accessibilityState={{ checked: currentLike.liked, disabled: currentLike.loading }}
          onPress={() => void toggleLike()}
          disabled={currentLike.loading}
          hitSlop={12}
          style={styles.likeButton}
        >
          {currentLike.loading ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={[styles.heart, currentLike.liked && styles.heartOn]}>{currentLike.liked ? '♥' : '♡'}</Text>
          )}
        </Pressable>
      </View>
      {currentLike.error && <Text style={styles.inlineError} accessibilityRole="alert">Like failed: {currentLike.error}</Text>}
      {playerError && (
        <Pressable accessibilityRole="button" accessibilityHint="Dismiss error" onPress={clearPlayerError}>
          <Text style={styles.inlineError}>{playerError}</Text>
        </Pressable>
      )}

      <Slider
        accessibilityLabel="Playback position"
        style={styles.slider}
        minimumValue={0}
        maximumValue={Math.max(duration, 1)}
        value={Math.min(sliderPosition, Math.max(duration, 1))}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.surfaceAlt}
        thumbTintColor={colors.accent}
        onValueChange={(value) => setSeekState({ trackId: track.id, value })}
        onSlidingComplete={(value) => {
          run('Seeking failed', () => seekTo(value));
          setSeekState(null);
        }}
      />
      <View style={styles.timeRow}>
        <Text style={styles.time}>{fmt(sliderPosition)}</Text>
        <Text style={styles.time}>{fmt(duration)}</Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
          accessibilityState={{ checked: shuffle }}
          onPress={() => run('Changing shuffle failed', () => setShuffle(toggleShuffle()))}
          hitSlop={12}
        >
          <Text style={[styles.secondaryButton, shuffle && styles.activeButton]}>⇄</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous track" onPress={() => run('Previous track failed', prev)} hitSlop={12}>
          <Text style={styles.skipButton}>|◀</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} style={styles.playButton} onPress={() => run('Play/pause failed', togglePlay)}>
          {buffering ? <ActivityIndicator color="#000" /> : <Text style={styles.playIcon}>{playing ? 'Ⅱ' : '▶'}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next track" onPress={() => run('Next track failed', next)} hitSlop={12}>
          <Text style={styles.skipButton}>▶|</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change repeat mode"
          accessibilityState={{ checked: repeat !== RepeatMode.Off }}
          onPress={() => run('Changing repeat failed', () => setRepeat(cycleRepeat()))}
          hitSlop={12}
        >
          <Text style={[styles.secondaryButton, repeat !== RepeatMode.Off && styles.activeButton]}>{repeatLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 28 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { color: colors.textDim },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { paddingVertical: 8 },
  closeText: { color: colors.text, fontSize: 26 },
  queueButton: { paddingVertical: 10, paddingLeft: 16 },
  queueButtonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  artWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 0 },
  art: { width: '100%', aspectRatio: 1, maxHeight: '100%', borderRadius: 12, backgroundColor: colors.surfaceAlt },
  artPlaceholder: { borderWidth: 1, borderColor: colors.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 12 },
  titleMeta: { minWidth: 0, flex: 1 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  artist: { color: colors.textDim, fontSize: 16, marginTop: 4 },
  likeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heart: { color: colors.textDim, fontSize: 28 },
  heartOn: { color: colors.accent },
  inlineError: { color: colors.error, fontSize: 12, marginTop: 8 },
  slider: { width: '100%', height: 40, marginTop: 16 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  time: { color: colors.textDim, fontSize: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 },
  secondaryButton: { color: colors.textDim, fontSize: 22 },
  activeButton: { color: colors.accent },
  skipButton: { color: colors.text, fontSize: 28 },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#000', fontSize: 30 },
});
