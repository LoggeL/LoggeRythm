import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import Player, {
  Event,
  PlaybackState,
  RepeatMode,
  useActiveMediaItem,
  useIsPlaying,
  usePlaybackState,
} from '../player/player';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import TrackLikeButton from '../components/TrackLikeButton';
import PlayerNoticeBanner from '../components/PlayerNoticeBanner';
import {
  MemoNowPlayingArtwork,
  MemoNowPlayingBackdrop,
} from '../components/player/NowPlayingArtwork';
import { LiveLyricsPanel } from '../components/player/LyricsPanel';
import { LiveNowPlayingLyricsSurface } from '../components/player/NowPlayingLyricsSurface';
import { MemoNowPlayingMetadata } from '../components/player/NowPlayingMetadata';
import {
  DEFAULT_NOW_PLAYING_TAB,
  MemoNowPlayingTabs,
  type NowPlayingTab,
} from '../components/player/NowPlayingTabs';
import { LiveNowPlayingTransport } from '../components/player/NowPlayingTransport';
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
import { useBackHandler } from '../hooks/useBackHandler';
import { useHaptics } from '../hooks/useHaptics';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { RootStackParams } from '../navigation';
import { strings } from '../localization';
import { AppText, EmptyState, IconButton, Skeleton } from '../components/ui';
import { colors, layout, metrics, radii, spacing } from '../theme';
import { TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../tv';
import type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';
import { nowPlayingArtworkSize, nowPlayingTvArtworkSize } from './nowPlayingLayout';
import {
  openNowPlayingAlbum,
  openNowPlayingArtist,
  openNowPlayingCatalogAlbum,
  openNowPlayingCatalogArtist,
} from './nowPlayingNavigation';
import {
  adjacentNowPlayingTab,
  resolveNowPlayingBackAction,
  resolveNowPlayingBody,
  resolveNowPlayingContextLabel,
  resolveTvPanelTab,
  TV_NOW_PLAYING_PANEL_TABS,
} from './nowPlayingModel';
import {
  resolveFullscreenTabSwipe,
  shouldCaptureFullscreenMinimize,
  shouldCaptureFullscreenTabSwipe,
  shouldMinimizeFullscreenPlayer,
} from '../player/playerGestures';

type Props = NativeStackScreenProps<RootStackParams, 'NowPlaying'>;

const SWIPE_DISMISS_OPACITY_RANGE = 320;
const NOW_PLAYING_TV_PLAY_FOCUS_KEY = 'now-playing-play-pause';

function repeatModeLabel(mode: RepeatMode): string {
  if (mode === RepeatMode.One) return strings.player.repeatOne;
  if (mode === RepeatMode.All) return strings.player.repeatAll;
  return strings.player.repeatOff;
}

export default function NowPlayingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const isFocused = useIsFocused();
  const tv = useTvEnvironment();
  const reducedMotion = useReducedMotion();
  const haptics = useHaptics();
  const item = useActiveMediaItem();
  const playing = useIsPlaying();
  const playbackState = usePlaybackState();
  const track = mediaItemToTrack(item);
  const body = resolveNowPlayingBody(isPlayerReady(), track !== null);
  const playerError = usePlayerError();

  const [repeat, setRepeat] = useState<RepeatMode>(() => Player.getRepeatMode());
  const [shuffle, setShuffle] = useState(isContextShuffleEnabled);
  const [shufflePending, setShufflePending] = useState(false);
  const [tab, setTab] = useState<NowPlayingTab>(DEFAULT_NOW_PLAYING_TAB);

  const isTvSplit = tv.isTv && tv.isWidescreen;
  const tvFocusReturn = useTvFocusReturn({
    scope: 'now-playing',
    active: isFocused,
    fallbackKey: NOW_PLAYING_TV_PLAY_FOCUS_KEY,
    enabled: tv.isTv,
  });
  const checkpointConsumedRef = useRef(false);
  const tvEnabledRef = useRef(tv.isTv);
  const popFocusReturnRef = useRef(tvFocusReturn.popAndRestore);
  useEffect(() => {
    tvEnabledRef.current = tv.isTv;
    popFocusReturnRef.current = tvFocusReturn.popAndRestore;
  }, [tv.isTv, tvFocusReturn.popAndRestore]);

  useEffect(
    () => () => {
      if (tvEnabledRef.current && !checkpointConsumedRef.current) {
        checkpointConsumedRef.current = true;
        popFocusReturnRef.current();
      }
    },
    [],
  );

  const consumeTvCheckpoint = useCallback(() => {
    if (!tv.isTv || checkpointConsumedRef.current) return;
    checkpointConsumedRef.current = true;
    tvFocusReturn.popAndRestore();
  }, [tv.isTv, tvFocusReturn]);

  const [translateY] = useState(() => new Animated.Value(0));

  const sheetOpacity = useMemo(
    () =>
      typeof translateY.interpolate === 'function'
        ? translateY.interpolate({
            inputRange: [0, SWIPE_DISMISS_OPACITY_RANGE],
            outputRange: [1, 0.55],
            extrapolate: 'clamp',
          })
        : 1,
    [translateY],
  );

  const dismissNowPlaying = useCallback(() => {
    consumeTvCheckpoint();
    navigation.goBack();
  }, [consumeTvCheckpoint, navigation]);

  const resetSheetPosition = useCallback(
    (immediate: boolean) => {
      if (immediate || reducedMotion || typeof Animated.spring !== 'function') {
        translateY.setValue(0);
        return;
      }
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        speed: 24,
        bounciness: 5,
      }).start();
    },
    [reducedMotion, translateY],
  );

  const fullscreenResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    // Attached ONLY to noninteractive header and artwork surfaces so nested
    // sliders, transport controls, and scrollable panels retain native gestures.
    onMoveShouldSetPanResponderCapture: (_event, gesture) => (
      !tv.isTv
      && (
        (Platform.OS === 'android' && shouldCaptureFullscreenTabSwipe(gesture))
        || shouldCaptureFullscreenMinimize(gesture)
      )
    ),
    onPanResponderMove: (_event, gesture) => {
      if (reducedMotion) return;
      if (gesture.dy > 0 && Math.abs(gesture.dy) >= Math.abs(gesture.dx)) {
        translateY.setValue(gesture.dy);
      }
    },
    onPanResponderRelease: (_event, gesture) => {
      if (shouldMinimizeFullscreenPlayer(gesture)) {
        haptics.trigger('tap');
        navigation.goBack();
        return;
      }
      resetSheetPosition(false);
      if (Platform.OS !== 'android') return;
      const tabDirection = resolveFullscreenTabSwipe(gesture);
      if (tabDirection !== null) {
        haptics.trigger('tap');
        setTab((current) => adjacentNowPlayingTab(current, tabDirection));
      }
    },
    onPanResponderTerminate: () => resetSheetPosition(false),
    onPanResponderTerminationRequest: () => true,
  }), [haptics, navigation, reducedMotion, resetSheetPosition, translateY, tv.isTv]);

  useBackHandler(isFocused, () => {
    if (resolveNowPlayingBackAction(tab, isTvSplit) === 'return-to-playing') {
      haptics.trigger('tap');
      setTab('playing');
      return true;
    }
    dismissNowPlaying();
    return true;
  });

  useEffect(() => {
    const syncScreenState = () => {
      setShuffle(isContextShuffleEnabled());
      translateY.setValue(0);
    };
    const queueSubscription = Player.addEventListener(Event.QueueChanged, syncScreenState);
    const removeFocusListener = navigation.addListener('focus', syncScreenState);
    syncScreenState();
    return () => {
      queueSubscription.remove();
      removeFocusListener();
    };
  }, [navigation, translateY]);

  const run = useCallback((label: string, action: () => void) => {
    try {
      action();
    } catch (cause) {
      reportPlayerError(label, cause);
    }
  }, []);

  const toggleContextShuffle = useCallback(async () => {
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
  }, [shufflePending]);

  const contextLabel = useMemo(
    () => resolveNowPlayingContextLabel(item, strings.queue.legacyContextLabel),
    [item],
  );

  const openAlbum = useCallback(() => {
    if (!track) return;
    const outcome = openNowPlayingAlbum(track);
    if (outcome === 'opened') {
      consumeTvCheckpoint();
      return;
    }
    reportPlayerError(
      strings.trackActions.navigationUnavailable,
      new Error(
        outcome === 'invalid'
          ? `Album navigation unavailable for track ${track.id}: invalid album_id ${JSON.stringify(track.album_id)}`
          : `Root navigation container is not ready to open album for track ${track.id}`,
      ),
    );
  }, [consumeTvCheckpoint, track]);

  const openArtist = useCallback(
    (artist: Parameters<typeof openNowPlayingArtist>[0]) => {
      const outcome = openNowPlayingArtist(artist);
      if (outcome === 'opened') {
        consumeTvCheckpoint();
        return;
      }
      reportPlayerError(
        strings.trackActions.navigationUnavailable,
        new Error(
          outcome === 'invalid'
            ? `Artist navigation unavailable for credit ${JSON.stringify(artist.name)}: invalid artist id ${JSON.stringify(artist.id)}`
            : `Root navigation container is not ready to open artist ${JSON.stringify(artist.name)}`,
        ),
      );
    },
    [consumeTvCheckpoint],
  );

  const openCatalogAlbum = useCallback(
    (params: AlbumRouteParams) => {
      if (openNowPlayingCatalogAlbum(params) === 'opened') {
        consumeTvCheckpoint();
        return;
      }
      reportPlayerError(
        strings.trackActions.navigationUnavailable,
        new Error(`Root navigation container is not ready to open album ${params.albumId}`),
      );
    },
    [consumeTvCheckpoint],
  );

  const openCatalogArtist = useCallback(
    (params: ArtistRouteParams) => {
      if (openNowPlayingCatalogArtist(params) === 'opened') {
        consumeTvCheckpoint();
        return;
      }
      reportPlayerError(
        strings.trackActions.navigationUnavailable,
        new Error(`Root navigation container is not ready to open artist ${params.artistId}`),
      );
    },
    [consumeTvCheckpoint],
  );

  const openParty = useCallback(
    (code: string) => navigation.navigate('Party', { code }),
    [navigation],
  );

  const commitSeek = useCallback(
    (seconds: number) => run(strings.player.seekFailed, () => seekTo(seconds)),
    [run],
  );
  const playPrevious = useCallback(() => run(strings.player.previousFailed, prev), [run]);
  const togglePlayback = useCallback(() => run(strings.player.playPauseFailed, togglePlay), [run]);
  const playNext = useCallback(() => run(strings.player.nextFailed, next), [run]);

  const topBar = (
    <View style={styles.topBar}>
      <IconButton
        testID="now-playing-close"
        icon="chevron-down"
        size="lg"
        color={colors.textPrimary}
        haptic="tap"
        focusable
        hasTVPreferredFocus={tv.isTv && isFocused && body !== 'content' ? true : undefined}
        accessibilityLabel={strings.player.closeNowPlaying}
        onPress={dismissNowPlaying}
      />
      <View
        testID="now-playing-gesture-header"
        style={styles.headerGestureSurface}
        {...(isTvSplit ? null : fullscreenResponder.panHandlers)}
      >
        {!isTvSplit ? <View accessible={false} style={styles.grabber} /> : null}
        <AppText
          testID="now-playing-context-eyebrow"
          accessibilityRole="header"
          variant="overline"
          color="secondary"
          numberOfLines={1}
        >
          {contextLabel !== null ? strings.player.playingFrom : strings.player.nowPlayingHeading}
        </AppText>
        {contextLabel !== null ? (
          <AppText
            testID="now-playing-context-label"
            variant="label"
            color="primary"
            numberOfLines={1}
            style={styles.contextLabel}
          >
            {contextLabel}
          </AppText>
        ) : null}
      </View>
      {!isTvSplit ? (
        <IconButton
          testID="now-playing-open-queue"
          icon="playlist-music-outline"
          selected={tab === 'queue'}
          haptic="tap"
          focusable
          accessibilityLabel={strings.queue.title}
          onPress={() => setTab('queue')}
        />
      ) : (
        <View style={styles.topBarSpacer} />
      )}
    </View>
  );

  // TvShellLayout already applies the 5% TV overscan margins around RootStack.
  const tvSplitPrimaryRatio = 0.43;
  const framePadding = isTvSplit
    ? {
        paddingTop: spacing.xxs,
        paddingBottom: spacing.xxs,
        paddingHorizontal: spacing.md,
      }
    : {
        paddingTop: insets.top + spacing.xs,
        paddingBottom: insets.bottom + spacing.md,
      };
  const tvContentHeight = Math.max(0, window.height - tv.overscan.top - tv.overscan.bottom);
  const loadingCoverSize = isTvSplit
    ? nowPlayingTvArtworkSize(tv.contentWidth, tvContentHeight, tvSplitPrimaryRatio)
    : nowPlayingArtworkSize(window.width, window.height);

  if (body === 'loading') {
    return (
      <TvFocusScope scope="now-playing">
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
      </TvFocusScope>
    );
  }

  if (body === 'empty' || !track) {
    return (
      <TvFocusScope scope="now-playing">
        <View testID="now-playing-screen" style={[styles.container, framePadding]}>
          {topBar}
          <EmptyState
            layout="page"
            testID="now-playing-empty"
            icon="music-circle-outline"
            title={strings.player.nothingPlaying}
          />
        </View>
      </TvFocusScope>
    );
  }

  const buffering = playbackState === PlaybackState.Buffering;
  const artworkSize = loadingCoverSize;
  const shuffleButton = (
    <PlayerToggleButton
      testID="now-playing-shuffle"
      icon="shuffle-variant"
      checked={shuffle}
      busy={shufflePending}
      haptic="tap"
      focusable
      accessibilityLabel={
        shuffle ? strings.player.disableShuffle : strings.player.enableShuffle
      }
      onPress={() => void toggleContextShuffle()}
    />
  );
  const repeatButton = (
    <PlayerToggleButton
      testID="now-playing-repeat"
      icon={repeat === RepeatMode.One ? 'repeat-once' : 'repeat'}
      checked={repeat !== RepeatMode.Off}
      haptic="tap"
      focusable
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
  );

  const tvRightTab = resolveTvPanelTab(tab);

  return (
    <TvFocusScope scope="now-playing">
      <Animated.View
        testID="now-playing-screen"
        style={[
          styles.container,
          framePadding,
          isTvSplit
            ? null
            : {
                opacity: sheetOpacity,
                transform: [{ translateY }],
              },
        ]}
      >
        <MemoNowPlayingBackdrop coverUri={track.cover} />
        {topBar}
        {!isTvSplit ? (
          <MemoNowPlayingTabs selected={tab} onSelect={setTab} fullBleed />
        ) : null}
        {playerError ? (
          <PlayerErrorBanner
            testID="now-playing-player-error"
            message={playerError}
            onDismiss={clearPlayerError}
            style={styles.playerError}
          />
        ) : null}
        <PlayerNoticeBanner />

        {isTvSplit ? (
          <View testID="now-playing-tv-split" style={styles.tvSplit}>
            <View style={[styles.tvPrimaryPane, { flex: tvSplitPrimaryRatio }]}>
              <View style={styles.tvArtWrap}>
                <MemoNowPlayingArtwork
                  coverUri={track.cover}
                  style={{ width: artworkSize, height: artworkSize }}
                />
              </View>
              <View style={styles.tvTitleRow}>
                <MemoNowPlayingMetadata
                  track={track}
                  isTv
                  onOpenAlbum={openAlbum}
                  onOpenArtist={openArtist}
                />
                <TrackLikeButton
                  track={track}
                  testID="now-playing-like"
                  style={styles.likeButton}
                />
              </View>
              <LiveNowPlayingTransport
                trackId={track.id}
                playing={playing}
                buffering={buffering}
                isTv
                tvPreferredPlayFocus={isFocused}
                tvPlayFocusKey={NOW_PLAYING_TV_PLAY_FOCUS_KEY}
                onSeek={commitSeek}
                onPrevious={playPrevious}
                onTogglePlay={togglePlayback}
                onNext={playNext}
                leadingControl={shuffleButton}
                trailingControl={repeatButton}
              />
            </View>

            <View
              testID="now-playing-tv-panel"
              style={[styles.tvSecondaryPane, { flex: 1 - tvSplitPrimaryRatio }]}
            >
              <MemoNowPlayingTabs
                selected={tvRightTab}
                tabs={TV_NOW_PLAYING_PANEL_TABS}
                compact
                onSelect={setTab}
              />
              <View style={styles.tvPanelBody}>
                {tvRightTab === 'lyrics' ? (
                  <LiveLyricsPanel key={track.id} track={track} onSeek={commitSeek} />
                ) : tvRightTab === 'similar' ? (
                  <SimilarPanel
                    seed={track}
                    onOpenAlbum={openCatalogAlbum}
                    onOpenArtist={openCatalogArtist}
                  />
                ) : (
                  <QueueSurface
                    embedded
                    onOpenAlbum={openCatalogAlbum}
                    onOpenArtist={openCatalogArtist}
                    onOpenParty={openParty}
                  />
                )}
              </View>
            </View>
          </View>
        ) : tab === 'lyrics' ? (
          <LiveNowPlayingLyricsSurface
            key={track.id}
            track={track}
            playing={playing}
            buffering={buffering}
            onOpenAlbum={openAlbum}
            onOpenArtist={openArtist}
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
              onOpenParty={openParty}
            />
          </View>
        ) : (
          <ScrollView
            testID="now-playing-playing-scroll"
            style={styles.playingScroll}
            contentContainerStyle={styles.playingContent}
            showsVerticalScrollIndicator={false}
          >
            <View
              testID="now-playing-artwork-gesture-surface"
              style={styles.artWrap}
              {...fullscreenResponder.panHandlers}
            >
              <MemoNowPlayingArtwork
                coverUri={track.cover}
                style={{ width: artworkSize, height: artworkSize }}
              />
            </View>

            <View style={styles.titleRow}>
              <MemoNowPlayingMetadata
                track={track}
                onOpenAlbum={openAlbum}
                onOpenArtist={openArtist}
              />
              <TrackLikeButton track={track} testID="now-playing-like" style={styles.likeButton} />
            </View>

            <LiveNowPlayingTransport
              trackId={track.id}
              playing={playing}
              buffering={buffering}
              tvPlayFocusKey={tv.isTv ? NOW_PLAYING_TV_PLAY_FOCUS_KEY : undefined}
              tvPreferredPlayFocus={tv.isTv && isFocused}
              onSeek={commitSeek}
              onPrevious={playPrevious}
              onTogglePlay={togglePlayback}
              onNext={playNext}
              leadingControl={shuffleButton}
              trailingControl={repeatButton}
            />
          </ScrollView>
        )}
      </Animated.View>
    </TvFocusScope>
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
  topBarSpacer: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
  },
  headerGestureSurface: {
    flex: 1,
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
  },
  contextLabel: { maxWidth: '100%' },
  grabber: {
    width: GRABBER_WIDTH,
    height: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.fillStrong,
    marginBottom: 2,
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
  tvSplit: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
  tvPrimaryPane: {
    minWidth: 0,
    minHeight: 0,
    justifyContent: 'space-between',
    gap: spacing.xs,
    overflow: 'hidden',
  },
  tvArtWrap: {
    flexShrink: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tvTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tvSecondaryPane: {
    minWidth: 0,
    minHeight: 0,
    borderRadius: radii.panel,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  tvPanelBody: {
    flex: 1,
    minHeight: 0,
  },
});
