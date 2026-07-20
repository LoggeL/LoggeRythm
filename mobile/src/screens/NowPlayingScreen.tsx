import React, { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Player, {
  Event,
  PlaybackState,
  RepeatMode,
  useActiveMediaItem,
  useIsPlaying,
  usePlaybackState,
  useProgress,
} from '../player/player';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import BrandLockup from '../components/BrandLockup';
import AppIcon from '../components/AppIcon';
import TrackLikeButton from '../components/TrackLikeButton';
import PlayerNoticeBanner from '../components/PlayerNoticeBanner';
import {
  NowPlayingArtwork,
  NowPlayingBackdrop,
} from '../components/player/NowPlayingArtwork';
import NowPlayingLyricsSurface from '../components/player/NowPlayingLyricsSurface';
import NowPlayingMetadata from '../components/player/NowPlayingMetadata';
import {
  DEFAULT_NOW_PLAYING_TAB,
  NowPlayingTabs,
  type NowPlayingTab,
} from '../components/player/NowPlayingTabs';
import NowPlayingTransport from '../components/player/NowPlayingTransport';
import SimilarPanel from '../components/player/SimilarPanel';
import { QueueSurface } from './QueueScreen';
import { mediaItemToTrack } from '../player/mediaItem';
import {
  cycleRepeat,
  isContextShuffleEnabled,
  next,
  prev,
  seekTo,
  toggleShuffle,
  togglePlay,
} from '../player/controller';
import { clearPlayerError, reportPlayerError, usePlayerError } from '../player/errors';
import { isPlayerReady } from '../player/setup';
import type { RootStackParams } from '../navigation';
import { strings } from '../localization';
import { colors, metrics } from '../theme';
import { nowPlayingArtworkSize } from './nowPlayingLayout';
import {
  nowPlayingAlbumDestination,
  nowPlayingArtistDestination,
} from './nowPlayingNavigation';
import { adjacentNowPlayingTab, resolveNowPlayingBody } from './nowPlayingModel';
import {
  resolveFullscreenTabSwipe,
  shouldCaptureFullscreenMinimize,
  shouldCaptureFullscreenTabSwipe,
  shouldMinimizeFullscreenPlayer,
} from '../player/playerGestures';

type Props = NativeStackScreenProps<RootStackParams, 'NowPlaying'>;

const FULLSCREEN_MINIMIZE_CAPTURE_HEIGHT = 180;

function repeatModeLabel(mode: RepeatMode): string {
  if (mode === RepeatMode.One) return strings.player.repeatOne;
  if (mode === RepeatMode.All) return strings.player.repeatAll;
  return strings.player.repeatOff;
}

export default function NowPlayingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const item = useActiveMediaItem();
  const playing = useIsPlaying();
  const playbackState = usePlaybackState();
  const { position, duration } = useProgress(0.5);
  const track = mediaItemToTrack(item);
  const body = resolveNowPlayingBody(isPlayerReady(), track !== null);
  const playerError = usePlayerError();

  const [seekState, setSeekState] = useState<{ trackId: string; value: number } | null>(null);
  const [repeat, setRepeat] = useState<RepeatMode>(() => Player.getRepeatMode());
  const [shuffle, setShuffle] = useState(isContextShuffleEnabled);
  const [shufflePending, setShufflePending] = useState(false);
  const [tab, setTab] = useState<NowPlayingTab>(DEFAULT_NOW_PLAYING_TAB);
  const fullscreenResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    // Limit vertical capture to the fixed header/tabs region so nested panels retain scrolling.
    // Horizontal tab navigation is Android-only and dominant-axis gated to avoid claiming scrolls.
    onMoveShouldSetPanResponderCapture: (_event, gesture) => (
      Platform.OS === 'android' && shouldCaptureFullscreenTabSwipe(gesture)
    ) || (
      gesture.y0 <= insets.top + FULLSCREEN_MINIMIZE_CAPTURE_HEIGHT
      && shouldCaptureFullscreenMinimize(gesture)
    ),
    onPanResponderRelease: (_event, gesture) => {
      if (shouldMinimizeFullscreenPlayer(gesture)) {
        navigation.goBack();
        return;
      }
      if (Platform.OS !== 'android') return;
      const tabDirection = resolveFullscreenTabSwipe(gesture);
      if (tabDirection !== null) {
        setTab((current) => adjacentNowPlayingTab(current, tabDirection));
      }
    },
    onPanResponderTerminationRequest: () => true,
  }), [insets.top, navigation]);

  useEffect(() => {
    const syncShuffleState = () => setShuffle(isContextShuffleEnabled());
    const queueSubscription = Player.addEventListener(Event.QueueChanged, syncShuffleState);
    const removeFocusListener = navigation.addListener('focus', syncShuffleState);
    syncShuffleState();
    return () => {
      queueSubscription.remove();
      removeFocusListener();
    };
  }, [navigation]);

  const run = (label: string, action: () => void) => {
    try {
      action();
    } catch (cause) {
      reportPlayerError(label, cause);
    }
  };

  const toggleContextShuffle = async () => {
    if (shufflePending) return;
    setShufflePending(true);
    clearPlayerError();
    try {
      const enabled = await toggleShuffle();
      setShuffle(enabled);
      AccessibilityInfo.announceForAccessibility(
        enabled ? strings.queue.shuffleEnabled : strings.queue.orderRestored,
      );
    } catch (cause) {
      reportPlayerError(strings.player.shuffleFailed, cause);
    } finally {
      setShufflePending(false);
    }
  };

  const topBar = (
    <View style={styles.topBar}>
      <Pressable
        testID="now-playing-close"
        accessibilityRole="button"
        accessibilityLabel={strings.player.closeNowPlaying}
        style={styles.closeButton}
        onPress={() => navigation.goBack()}
        hitSlop={16}
      >
        <AppIcon name="chevron-down" color={colors.textPrimary} size={28} />
      </Pressable>
      <BrandLockup compact horizontal accessibilityRole="header" />
      <View style={styles.topBarSpacer} />
    </View>
  );

  if (body === 'loading') {
    return (
      <View testID="now-playing-screen" style={[styles.container, { paddingTop: insets.top + 8 }]}>
        {topBar}
        <View
          testID="now-playing-loading"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.player.preparing}
          accessibilityLiveRegion="polite"
          style={styles.empty}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.dim}>{strings.player.preparing}</Text>
        </View>
      </View>
    );
  }

  if (body === 'empty' || !track) {
    return (
      <View testID="now-playing-screen" style={[styles.container, { paddingTop: insets.top + 8 }]}>
        {topBar}
        <View testID="now-playing-empty" accessibilityLiveRegion="polite" style={styles.empty}>
          <Text style={styles.dim}>{strings.player.nothingPlaying}</Text>
        </View>
      </View>
    );
  }

  const buffering = playbackState === PlaybackState.Buffering;
  const sliderPosition = seekState?.trackId === track.id ? seekState.value : position;
  const artworkSize = nowPlayingArtworkSize(window.width, window.height);
  const openAlbum = () => {
    const destination = nowPlayingAlbumDestination(track);
    if (destination === null) {
      reportPlayerError(strings.trackActions.navigationUnavailable, null);
      return;
    }
    navigation.navigate('Tabs', destination);
  };
  const openArtist = (artist: Parameters<typeof nowPlayingArtistDestination>[0]) => {
    const destination = nowPlayingArtistDestination(artist);
    if (destination === null) {
      reportPlayerError(strings.trackActions.navigationUnavailable, null);
      return;
    }
    navigation.navigate('Tabs', destination);
  };
  const changeSeekPosition = (seconds: number) => {
    setSeekState({ trackId: track.id, value: seconds });
  };
  const commitSeek = (seconds: number) => {
    run(strings.player.seekFailed, () => seekTo(seconds));
    setSeekState(null);
  };
  const playPrevious = () => run(strings.player.previousFailed, prev);
  const togglePlayback = () => run(strings.player.playPauseFailed, togglePlay);
  const playNext = () => run(strings.player.nextFailed, next);

  return (
    <View
      testID="now-playing-screen"
      style={[
        styles.container,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 },
      ]}
      {...fullscreenResponder.panHandlers}
    >
      <NowPlayingBackdrop coverUri={track.cover} />
      {topBar}
      <NowPlayingTabs selected={tab} onSelect={setTab} />
      {playerError && (
        <View testID="now-playing-player-error" style={styles.playerErrorRow} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <Text style={[styles.inlineError, styles.playerErrorText]}>{playerError}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={strings.player.playerErrorDismiss} onPress={clearPlayerError} style={styles.inlineDismissButton}>
            <AppIcon name="close" color={colors.textSecondary} size={20} />
          </Pressable>
        </View>
      )}
      <PlayerNoticeBanner />

      {tab === 'lyrics' ? (
        <NowPlayingLyricsSurface
          key={track.id}
          track={track}
          position={position}
          sliderPosition={sliderPosition}
          duration={duration}
          playing={playing}
          buffering={buffering}
          onOpenAlbum={openAlbum}
          onOpenArtist={openArtist}
          onPositionChange={changeSeekPosition}
          onSeek={commitSeek}
          onPrevious={playPrevious}
          onTogglePlay={togglePlayback}
          onNext={playNext}
        />
      ) : tab === 'similar' ? (
        <SimilarPanel
          seed={track}
          onOpenAlbum={(params) => navigation.navigate('Tabs', {
            screen: 'DiscoverTab',
            params: { screen: 'Album', params },
          })}
          onOpenArtist={(params) => navigation.navigate('Tabs', {
            screen: 'DiscoverTab',
            params: { screen: 'Artist', params },
          })}
        />
      ) : tab === 'queue' ? (
        <View style={styles.fullBleedTab}>
          <QueueSurface
            embedded
            onOpenAlbum={(params) => navigation.navigate('Tabs', {
              screen: 'DiscoverTab',
              params: { screen: 'Album', params },
            })}
            onOpenArtist={(params) => navigation.navigate('Tabs', {
              screen: 'DiscoverTab',
              params: { screen: 'Artist', params },
            })}
          />
        </View>
      ) : (
        <ScrollView
          testID="now-playing-playing-scroll"
          style={styles.playingScroll}
          contentContainerStyle={styles.playingContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.artWrap}>
            <NowPlayingArtwork
              coverUri={track.cover}
              style={{ width: artworkSize, height: artworkSize }}
            />
          </View>

          <View style={styles.titleRow}>
            <NowPlayingMetadata
              track={track}
              onOpenAlbum={openAlbum}
              onOpenArtist={openArtist}
            />
            <TrackLikeButton track={track} testID="now-playing-like" style={styles.likeButton} />
          </View>

          <NowPlayingTransport
            position={sliderPosition}
            duration={duration}
            playing={playing}
            buffering={buffering}
            onPositionChange={changeSeekPosition}
            onSeek={commitSeek}
            onPrevious={playPrevious}
            onTogglePlay={togglePlayback}
            onNext={playNext}
            leadingControl={<Pressable
              testID="now-playing-shuffle"
              accessibilityRole="button"
              accessibilityLabel={shuffle ? strings.player.disableShuffle : strings.player.enableShuffle}
              accessibilityState={{ checked: shuffle, busy: shufflePending, disabled: shufflePending }}
              disabled={shufflePending}
              onPress={() => void toggleContextShuffle()}
              style={styles.iconButton}
            >
              <AppIcon
                name="shuffle-variant"
                color={shuffle ? colors.accent : colors.textSecondary}
                size={24}
              />
            </Pressable>}
            trailingControl={<Pressable
              testID="now-playing-repeat"
              accessibilityRole="button"
              accessibilityLabel={repeatModeLabel(repeat)}
              accessibilityHint={strings.player.changeRepeatMode}
              accessibilityState={{ checked: repeat !== RepeatMode.Off }}
              onPress={() =>
                run(strings.player.repeatFailed, () => {
                  const nextMode = cycleRepeat();
                  setRepeat(nextMode);
                  AccessibilityInfo.announceForAccessibility(repeatModeLabel(nextMode));
                })
              }
              style={styles.iconButton}
            >
              <AppIcon
                name={repeat === RepeatMode.One ? 'repeat-once' : 'repeat'}
                color={repeat !== RepeatMode.Off ? colors.accent : colors.textSecondary}
                size={24}
              />
            </Pressable>}
          />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 28 },
  fullBleedTab: { flex: 1, minHeight: 0, marginHorizontal: -28 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { color: colors.textSecondary },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { minWidth: metrics.minimumTouchTarget, minHeight: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.textPrimary, fontSize: 26 },
  topBarSpacer: { width: metrics.minimumTouchTarget, height: metrics.minimumTouchTarget },
  playingScroll: { flex: 1, minHeight: 0 },
  playingContent: { flexGrow: 1, paddingBottom: 4 },
  artWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 12 },
  likeButton: { width: metrics.minimumTouchTarget, height: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  inlineError: { color: colors.danger, fontSize: 12, marginTop: 8 },
  playerErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playerErrorText: { flex: 1 },
  inlineDismissButton: { width: metrics.minimumTouchTarget, height: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  inlineDismissText: { color: colors.textPrimary, fontSize: 22 },
  iconButton: { minWidth: metrics.minimumTouchTarget, minHeight: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  secondaryButton: { color: colors.textSecondary, fontSize: 22 },
  activeButton: { color: colors.accent },
});
