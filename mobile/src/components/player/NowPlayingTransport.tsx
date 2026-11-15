import React, { type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { strings } from '../../localization';
import { colors, metrics, spacing } from '../../theme';
import { AppText, IconButton, PlayButton } from '../ui';

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
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
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
}: NowPlayingTransportProps) {
  const compact = variant === 'compact';
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
      style={compact ? styles.compactSlider : styles.slider}
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
  const ring = compact ? COMPACT_RING : FULL_RING;

  return (
    <View
      testID={`${testIDPrefix}-transport`}
      style={[styles.transport, compact && styles.compactTransport]}
    >
      {compact ? (
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
      )}

      <View style={[styles.controls, compact && styles.compactControls]}>
        {leadingControl}
        <IconButton
          testID={`${testIDPrefix}-previous`}
          icon="skip-previous"
          size="lg"
          color={colors.textPrimary}
          accessibilityLabel={strings.common.previousTrack}
          onPress={onPrevious}
          style={styles.target}
        />
        <View style={styles.playSlot}>
          {/* Never `busy`: a stalled buffer must stay pausable. */}
          <PlayButton
            testID={`${testIDPrefix}-play-pause`}
            size={compact ? 'sm' : 'lg'}
            playing={playing}
            accessibilityLabel={playing ? strings.common.pause : strings.common.play}
            onPress={onTogglePlay}
            style={styles.target}
          />
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
          accessibilityLabel={strings.common.nextTrack}
          onPress={onNext}
          style={styles.target}
        />
        {trailingControl}
      </View>
    </View>
  );
}

/** Spinner diameters: a ring just outside the 64dp / 48dp play button. */
const FULL_RING = 84;
const COMPACT_RING = 64;

const styles = StyleSheet.create({
  transport: { flexShrink: 0 },
  compactTransport: {
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  slider: { width: '100%', height: metrics.minimumTouchTarget, marginTop: spacing.sm },
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
  compactControls: { justifyContent: 'center', gap: spacing.xl, marginTop: spacing.xxs },
  target: {
    minWidth: metrics.minimumTouchTarget,
    minHeight: metrics.minimumTouchTarget,
  },
  playSlot: { alignItems: 'center', justifyContent: 'center' },
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
