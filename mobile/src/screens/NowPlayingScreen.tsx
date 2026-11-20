import React, { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
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
import { PlayerErrorBanner } from '../components/player/PlayerErrorBanner';
import { PlayerToggleButton } from '../components/player/PlayerToggleButton';
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
import { AppText, EmptyState, IconButton, Skeleton } from '../components/ui';
import { colors, layout, metrics, radii, spacing } from '../theme';
import type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';
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
    // This responder belongs only to the noninteractive header surface.
    // Artwork and nested panels keep their native scrolling and touch handling.
    // A screen-level capture would steal native seek and transport gestures.
    onMoveShouldSetPanResponderCapture: (_event, gesture) => (
      Platform.OS === 'android' && shouldCaptureFullscreenTabSwipe(gesture)
    ) || shouldCaptureFullscreenMinimize(gesture),
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
  }), [navigation]);

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
      <IconButton
        testID="now-playing-close"
        icon="chevron-down"
        size="lg"
        color={colors.textPrimary}
        accessibilityLabel={strings.player.closeNowPlaying}
        onPress={() => navigation.goBack()}
      />
      <View
        testID="now-playing-gesture-header"
        style={styles.headerGestureSurface}
        {...fullscreenResponder.panHandlers}
      >
        <View accessible={false} style={styles.grabber} />
        <AppText accessibilityRole="header" variant="overline" color="secondary" numberOfLines={1}>
          {strings.player.nowPlayingTabs.playing}
        </AppText>
      </View>
      <IconButton
        testID="now-playing-open-queue"
        icon="playlist-music-outline"
        selected={tab === 'queue'}
        accessibilityLabel={strings.queue.title}
        onPress={() => setTab('queue')}
      />
    </View>
  );
  const framePadding = { paddingTop: insets.top + spacing.xs };
  const loadingCoverSize = nowPlayingArtworkSize(window.width, window.height);

  if (body === 'loading') {
    return (
      <View testID="now-playing-screen" style={[styles.container, framePadding]}>
        {topBar}
        <View
          testID="now-playing-loading"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.player.preparing}
          accessibilityLiveRegion="polite"
          style={styles.loading}
        >
          <Skeleton
            width={loadingCoverSize}
            height={loadingCoverSize}
            radius="xl"
            style={styles.loadingCover}
          />
          <Skeleton width="70%" height={28} />
          <Skeleton width="45%" height={18} />
          <AppText variant="callout" color="secondary" align="center">
            {strings.player.preparing}
          </AppText>
        </View>
      </View>
    );
  }

  if (body === 'empty' || !track) {
    return (
      <View testID="now-playing-screen" style={[styles.container, framePadding]}>
        {topBar}
        <EmptyState
          layout="page"
          testID="now-playing-empty"
          icon="music-circle-outline"
          title={strings.player.nothingPlaying}
        />
      </View>
    );
  }

  const buffering = playbackState === PlaybackState.Buffering;
  const sliderPosition = seekState?.trackId === track.id ? seekState.value : position;
  const artworkSize = loadingCoverSize;
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
  const openCatalogAlbum = (params: AlbumRouteParams) =>
    navigation.navigate('Tabs', {
      screen: 'DiscoverTab',
      params: { screen: 'Album', params },
    });
  const openCatalogArtist = (params: ArtistRouteParams) =>
    navigation.navigate('Tabs', {
      screen: 'DiscoverTab',
      params: { screen: 'Artist', params },
    });
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
        framePadding,
        { paddingBottom: insets.bottom + spacing.md },
      ]}
    >
      <NowPlayingBackdrop coverUri={track.cover} />
      {topBar}
      <NowPlayingTabs selected={tab} onSelect={setTab} />
      {playerError ? (
        <PlayerErrorBanner
          testID="now-playing-player-error"
          message={playerError}
          onDismiss={clearPlayerError}
          style={styles.playerError}
        />
      ) : null}
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
          onOpenAlbum={openCatalogAlbum}
          onOpenArtist={openCatalogArtist}
        />
      ) : tab === 'queue' ? (
        <View style={styles.fullBleedTab}>
          <QueueSurface
            embedded
            onOpenAlbum={openCatalogAlbum}
            onOpenArtist={openCatalogArtist}
            onOpenParty={(code) => navigation.navigate('Party', { code })}
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
            leadingControl={
              <PlayerToggleButton
                testID="now-playing-shuffle"
                icon="shuffle-variant"
                checked={shuffle}
                busy={shufflePending}
                accessibilityLabel={
                  shuffle ? strings.player.disableShuffle : strings.player.enableShuffle
                }
                onPress={() => void toggleContextShuffle()}
              />
            }
            trailingControl={
              <PlayerToggleButton
                testID="now-playing-repeat"
                icon={repeat === RepeatMode.One ? 'repeat-once' : 'repeat'}
                checked={repeat !== RepeatMode.Off}
                accessibilityLabel={repeatModeLabel(repeat)}
                accessibilityHint={strings.player.changeRepeatMode}
                onPress={() =>
                  run(strings.player.repeatFailed, () => {
                    const nextMode = cycleRepeat();
                    setRepeat(nextMode);
                    AccessibilityInfo.announceForAccessibility(repeatModeLabel(nextMode));
                  })
                }
              />
            }
          />
        </ScrollView>
      )}
    </View>
  );
}

const GRABBER_WIDTH = 36;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.pagePadding,
  },
  fullBleedTab: { flex: 1, minHeight: 0, marginHorizontal: -layout.pagePadding },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: -spacing.sm,
    paddingBottom: spacing.xxs,
  },
  headerGestureSurface: {
    flex: 1,
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  grabber: {
    width: GRABBER_WIDTH,
    height: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.fillStrong,
  },
  loading: { flex: 1, alignItems: 'center', gap: spacing.md, paddingTop: spacing.xl },
  loadingCover: { marginBottom: spacing.md },
  playerError: { marginTop: spacing.sm },
  playingScroll: { flex: 1, minHeight: 0 },
  playingContent: { flexGrow: 1, paddingBottom: spacing.sm },
  artWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  likeButton: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
