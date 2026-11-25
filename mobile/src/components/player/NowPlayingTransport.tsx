import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { triggerHaptic } from '../../hooks/useHaptics';
import { strings } from '../../localization';
import { useEffectiveProgress } from '../../connect/effectivePlaybackState';
import { colors, elevation, metrics, radii, spacing } from '../../theme';
import { TvFocusable } from '../../tv';
import AppIcon from '../AppIcon';
import { AppText, IconButton, PlayButton } from '../ui';
import {
  unexpectedAudioMetaErrorMessage,
  useTrackAudioMeta,
  WaveformScrubberView,
} from './WaveformScrubber';

export interface NowPlayingTransportProps {
  position: number;
  duration: number;
  playing: boolean;
  buffering: boolean;
  onPositionChange: (seconds: number) => void;
  onSeek: (seconds: number) => void;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  variant?: 'full' | 'compact';
  testIDPrefix?: string;
  leadingControl?: ReactNode;
  trailingControl?: ReactNode;
  /** Strictly TV-only initial D-Pad focus preference for the primary Play/Pause button. */
  tvPreferredPlayFocus?: boolean;
  /** Optional `TvFocusRegistry` focus key registered for the Play/Pause button in TV mode. */
  tvPlayFocusKey?: string;
  /** Tighter vertical spacing so full controls fit inside 540dp 16:9 Android TV height. */
  isTv?: boolean;
}

export interface LiveNowPlayingTransportProps
  extends Omit<NowPlayingTransportProps, 'position' | 'duration' | 'onPositionChange'> {
  trackId: string;
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

interface ScrubberSectionProps {
  position: number;
  duration: number;
  compact: boolean;
  isTv: boolean;
  testIDPrefix: string;
  onPositionChange: (seconds: number) => void;
  onSeek: (seconds: number) => void;
}

function renderScrubberSection({
  position,
  duration,
  compact,
  isTv,
  testIDPrefix,
  onPositionChange,
  onSeek,
}: ScrubberSectionProps) {
  const usableDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const maximumValue = Math.max(usableDuration, 1);
  const displayPosition = Number.isFinite(position) ? Math.max(position, 0) : 0;
  const sliderPosition = usableDuration === 0
    ? 0
    : Math.min(displayPosition, usableDuration);

  const slider = (
    <Slider
      testID={`${testIDPrefix}-slider`}
      accessibilityLabel={strings.player.playbackPosition}
      accessibilityState={{ disabled: usableDuration === 0 }}
      accessibilityValue={{ min: 0, max: maximumValue, now: sliderPosition }}
      disabled={usableDuration === 0}
      style={compact ? styles.compactSlider : isTv ? styles.tvSlider : styles.slider}
      minimumValue={0}
      maximumValue={maximumValue}
      value={sliderPosition}
      minimumTrackTintColor={colors.accent}
      maximumTrackTintColor={colors.fillStrong}
      thumbTintColor={colors.textPrimary}
      onValueChange={onPositionChange}
      onSlidingComplete={onSeek}
    />
  );

  const time = (suffix: 'position' | 'duration', seconds: number) => (
    <AppText
      testID={`${testIDPrefix}-${suffix}`}
      variant="caption"
      color="secondary"
      style={styles.time}
    >
      {formatTime(seconds)}
    </AppText>
  );

  return compact ? (
    <View style={styles.compactProgressRow}>
      {time('position', displayPosition)}
      {slider}
      {time('duration', usableDuration)}
    </View>
  ) : (
    <>
      {slider}
      <View style={styles.timeRow}>
        {time('position', displayPosition)}
        {time('duration', usableDuration)}
      </View>
    </>
  );
}

interface TransportControlsProps {
  compact: boolean;
  isTv: boolean;
  testIDPrefix: string;
  playing: boolean;
  buffering: boolean;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  leadingControl?: ReactNode;
  trailingControl?: ReactNode;
  tvPreferredPlayFocus?: boolean;
  tvPlayFocusKey?: string;
}

function renderTransportControls({
  compact,
  isTv,
  testIDPrefix,
  playing,
  buffering,
  onPrevious,
  onTogglePlay,
  onNext,
  leadingControl,
  trailingControl,
  tvPreferredPlayFocus,
  tvPlayFocusKey,
}: TransportControlsProps) {
  const ring = compact ? COMPACT_RING : isTv ? TV_RING : FULL_RING;
  const tvPlayDiameter = compact ? metrics.minimumTouchTarget : 56;
  const tvPlayGlyph = compact ? 26 : 30;
  return (
    <View style={[styles.controls, isTv && styles.tvControls, compact && styles.compactControls]}>
      {leadingControl}
      <IconButton
        testID={`${testIDPrefix}-previous`}
        icon="skip-previous"
        size="lg"
        color={colors.textPrimary}
        haptic="commit"
        focusable
        accessibilityLabel={strings.common.previousTrack}
        onPress={onPrevious}
        style={styles.target}
      />
      <View style={styles.playSlot}>
        {/* Never `busy`: a stalled buffer must stay pausable. */}
        {tvPlayFocusKey !== undefined ? (
          <TvFocusable
            testID={`${testIDPrefix}-play-pause`}
            focusKey={tvPlayFocusKey}
            preferredFocus={tvPreferredPlayFocus}
            ringRadius="pill"
            accessibilityRole="button"
            accessibilityLabel={playing ? strings.common.pause : strings.common.play}
            accessibilityState={{ disabled: false, busy: false }}
            onPress={() => {
              triggerHaptic('commit');
              onTogglePlay();
            }}
            style={[
              styles.tvPlayButton,
              styles.target,
              { width: tvPlayDiameter, height: tvPlayDiameter },
            ]}
          >
            <AppIcon
              name={playing ? 'pause' : 'play'}
              color={colors.onAccent}
              size={tvPlayGlyph}
            />
          </TvFocusable>
        ) : (
          <PlayButton
            testID={`${testIDPrefix}-play-pause`}
            size={compact ? 'sm' : 'lg'}
            playing={playing}
            focusable
            hasTVPreferredFocus={tvPreferredPlayFocus ? true : undefined}
            accessibilityLabel={playing ? strings.common.pause : strings.common.play}
            onPress={onTogglePlay}
            style={styles.target}
          />
        )}
        {buffering ? (
          <View pointerEvents="none" style={styles.bufferingRing}>
            <ActivityIndicator
              testID={`${testIDPrefix}-buffering`}
              accessibilityRole="progressbar"
              accessibilityLabel={strings.player.buffering}
              accessibilityLiveRegion="polite"
              color={colors.accentSoft}
              size={ring}
            />
          </View>
        ) : null}
      </View>
      <IconButton
        testID={`${testIDPrefix}-next`}
        icon="skip-next"
        size="lg"
        color={colors.textPrimary}
        haptic="commit"
        focusable
        accessibilityLabel={strings.common.nextTrack}
        onPress={onNext}
        style={styles.target}
      />
      {trailingControl}
    </View>
  );
}

/**
 * Pure player transport. Native playback ownership remains in the screen;
 * this component only renders the supplied state and forwards commands.
 */
export default function NowPlayingTransport({
  position,
  duration,
  playing,
  buffering,
  onPositionChange,
  onSeek,
  onPrevious,
  onTogglePlay,
  onNext,
  variant = 'full',
  testIDPrefix = 'now-playing',
  leadingControl,
  trailingControl,
  tvPreferredPlayFocus = false,
  tvPlayFocusKey,
  isTv = false,
}: NowPlayingTransportProps) {
  const compact = variant === 'compact';

  return (
    <View
      testID={`${testIDPrefix}-transport`}
      style={[styles.transport, compact && styles.compactTransport]}
    >
      {renderScrubberSection({
        position,
        duration,
        compact,
        isTv,
        testIDPrefix,
        onPositionChange,
        onSeek,
      })}
      {renderTransportControls({
        compact,
        isTv,
        testIDPrefix,
        playing,
        buffering,
        onPrevious,
        onTogglePlay,
        onNext,
        leadingControl,
        trailingControl,
        tvPreferredPlayFocus,
        tvPlayFocusKey,
      })}
    </View>
  );
}

/**
 * Progress-isolated scrubber so 0.5-1Hz native progress ticks re-render ONLY
 * the slider and two timestamp labels — never transport buttons, artwork, or
 * parent screens.
 */
const LiveTransportScrubber = React.memo(function LiveTransportScrubber({
  trackId,
  compact,
  isTv,
  testIDPrefix,
  onSeek,
}: {
  trackId: string;
  compact: boolean;
  isTv: boolean;
  testIDPrefix: string;
  onSeek: (seconds: number) => void;
}) {
  const { position, duration } = useEffectiveProgress(0.5);
  const [seekState, setSeekState] = useState<{ trackId: string; value: number } | null>(null);
  const audioMetaQuery = useTrackAudioMeta(trackId);
  const unexpectedAudioMetaError = unexpectedAudioMetaErrorMessage(audioMetaQuery.error);
  const sliderPosition = seekState?.trackId === trackId ? seekState.value : position;

  useEffect(() => {
    if (unexpectedAudioMetaError !== null) {
      console.error(
        `[LoggeRythm] Unexpected waveform audio-meta failure for track ${trackId}:`,
        audioMetaQuery.error,
      );
    }
  }, [audioMetaQuery.error, trackId, unexpectedAudioMetaError]);

  const handlePositionChange = useCallback(
    (seconds: number) => setSeekState({ trackId, value: seconds }),
    [trackId],
  );
  const handleSeek = useCallback(
    (seconds: number) => {
      onSeek(seconds);
      setSeekState(null);
    },
    [onSeek],
  );

  const meta = audioMetaQuery.data;
  if (!compact && meta !== undefined && meta.peaks.length > 0) {
    const usableDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const displayPosition = Number.isFinite(sliderPosition) ? Math.max(sliderPosition, 0) : 0;
    return (
      <>
        <WaveformScrubberView
          meta={meta}
          position={displayPosition}
          duration={usableDuration}
          compact={compact}
          isTv={isTv}
          testIDPrefix={testIDPrefix}
          onPositionChange={handlePositionChange}
          onSeek={handleSeek}
        />
        <View style={styles.timeRow}>
          <AppText
            testID={`${testIDPrefix}-position`}
            variant="caption"
            color="secondary"
            style={styles.time}
          >
            {formatTime(displayPosition)}
          </AppText>
          <AppText
            testID={`${testIDPrefix}-duration`}
            variant="caption"
            color="secondary"
            style={styles.time}
          >
            {formatTime(usableDuration)}
          </AppText>
        </View>
      </>
    );
  }

  const scrubber = renderScrubberSection({
    position: sliderPosition,
    duration,
    compact,
    isTv,
    testIDPrefix,
    onPositionChange: handlePositionChange,
    onSeek: handleSeek,
  });
  if (!compact && unexpectedAudioMetaError !== null) {
    return (
      <>
        {scrubber}
        <AppText
          testID={`${testIDPrefix}-waveform-error`}
          accessibilityRole="alert"
          variant="micro"
          color="warning"
          numberOfLines={2}
        >
          {unexpectedAudioMetaError}
        </AppText>
      </>
    );
  }
  return scrubber;
});

const MemoTransportControls = React.memo(function MemoTransportControls(
  props: TransportControlsProps,
) {
  return renderTransportControls(props);
});

/**
 * Connected transport wrapper used by NowPlayingScreen and LiveNowPlayingLyricsSurface.
 * Isolates `useProgress(0.5)` inside `LiveTransportScrubber` so parent screens
 * do not re-render on playback ticks.
 */
export const LiveNowPlayingTransport = React.memo(function LiveNowPlayingTransport({
  trackId,
  playing,
  buffering,
  onSeek,
  onPrevious,
  onTogglePlay,
  onNext,
  variant = 'full',
  testIDPrefix = 'now-playing',
  leadingControl,
  trailingControl,
  tvPreferredPlayFocus = false,
  tvPlayFocusKey,
  isTv = false,
}: LiveNowPlayingTransportProps) {
  const compact = variant === 'compact';

  return (
    <View
      testID={`${testIDPrefix}-transport`}
      style={[styles.transport, compact && styles.compactTransport]}
    >
      <LiveTransportScrubber
        trackId={trackId}
        compact={compact}
        isTv={isTv}
        testIDPrefix={testIDPrefix}
        onSeek={onSeek}
      />
      <MemoTransportControls
        compact={compact}
        isTv={isTv}
        testIDPrefix={testIDPrefix}
        playing={playing}
        buffering={buffering}
        onPrevious={onPrevious}
        onTogglePlay={onTogglePlay}
        onNext={onNext}
        leadingControl={leadingControl}
        trailingControl={trailingControl}
        tvPreferredPlayFocus={tvPreferredPlayFocus}
        tvPlayFocusKey={tvPlayFocusKey}
      />
    </View>
  );
});

/** Spinner diameters: a ring just outside the 64dp / 56dp / 48dp play button. */
const FULL_RING = 84;
const TV_RING = 74;
const COMPACT_RING = 64;

const styles = StyleSheet.create({
  transport: { flexShrink: 0 },
  compactTransport: {
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  slider: { width: '100%', height: metrics.minimumTouchTarget, marginTop: spacing.sm },
  tvSlider: { width: '100%', height: 34, marginTop: 0 },
  compactSlider: { flex: 1, height: metrics.minimumTouchTarget },
  compactProgressRow: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -spacing.xs,
    paddingHorizontal: spacing.xxs,
  },
  time: { minWidth: 36, fontVariant: ['tabular-nums'] },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  tvControls: {
    marginTop: spacing.xs,
  },
  compactControls: { justifyContent: 'center', gap: spacing.xl, marginTop: spacing.xxs },
  target: {
    minWidth: metrics.minimumTouchTarget,
    minHeight: metrics.minimumTouchTarget,
  },
  playSlot: { alignItems: 'center', justifyContent: 'center' },
  tvPlayButton: {
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    ...elevation.floating,
    shadowColor: colors.accent,
  },
  bufferingRing: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
