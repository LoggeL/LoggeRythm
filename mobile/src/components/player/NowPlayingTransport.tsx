import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { strings } from '../../localization';
import { colors, metrics } from '../../theme';
import AppIcon from '../AppIcon';

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
      maximumTrackTintColor={colors.surfaceElevated}
      thumbTintColor={colors.accent}
      onValueChange={onPositionChange}
      onSlidingComplete={onSeek}
    />
  );

  return (
    <View
      testID={`${testIDPrefix}-transport`}
      style={[styles.transport, compact && styles.compactTransport]}
    >
      {compact ? (
        <View style={styles.compactProgressRow}>
          <Text testID={`${testIDPrefix}-position`} style={styles.time}>
            {formatTime(displayPosition)}
          </Text>
          {slider}
          <Text testID={`${testIDPrefix}-duration`} style={styles.time}>
            {formatTime(usableDuration)}
          </Text>
        </View>
      ) : (
        <>
          {slider}
          <View style={styles.timeRow}>
            <Text testID={`${testIDPrefix}-position`} style={styles.time}>
              {formatTime(displayPosition)}
            </Text>
            <Text testID={`${testIDPrefix}-duration`} style={styles.time}>
              {formatTime(usableDuration)}
            </Text>
          </View>
        </>
      )}

      <View style={[styles.controls, compact && styles.compactControls]}>
        {leadingControl}
        <Pressable
          testID={`${testIDPrefix}-previous`}
          accessibilityRole="button"
          accessibilityLabel={strings.common.previousTrack}
          onPress={onPrevious}
          style={styles.iconButton}
        >
          <AppIcon name="skip-previous" color={colors.textPrimary} size={30} />
        </Pressable>
        <Pressable
          testID={`${testIDPrefix}-play-pause`}
          accessibilityRole="button"
          accessibilityLabel={playing ? strings.common.pause : strings.common.play}
          accessibilityState={{ busy: buffering }}
          style={[styles.playButton, compact && styles.compactPlayButton]}
          onPress={onTogglePlay}
        >
          {buffering ? (
            <ActivityIndicator
              testID={`${testIDPrefix}-buffering`}
              color={colors.onAccent}
              accessibilityLabel={strings.player.buffering}
            />
          ) : (
            <AppIcon
              name={playing ? 'pause' : 'play'}
              color={colors.onAccent}
              size={compact ? 26 : 34}
            />
          )}
        </Pressable>
        <Pressable
          testID={`${testIDPrefix}-next`}
          accessibilityRole="button"
          accessibilityLabel={strings.common.nextTrack}
          onPress={onNext}
          style={styles.iconButton}
        >
          <AppIcon name="skip-next" color={colors.textPrimary} size={30} />
        </Pressable>
        {trailingControl}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  transport: { flexShrink: 0 },
  compactTransport: { paddingTop: 8 },
  slider: { width: '100%', height: metrics.minimumTouchTarget, marginTop: 16 },
  compactSlider: { flex: 1, height: metrics.minimumTouchTarget },
  compactProgressRow: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  time: {
    minWidth: 34,
    color: colors.textSecondary,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 28,
  },
  compactControls: { justifyContent: 'center', gap: 28, marginTop: 2 },
  iconButton: {
    minWidth: metrics.minimumTouchTarget,
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    minWidth: metrics.minimumTouchTarget,
    minHeight: metrics.minimumTouchTarget,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactPlayButton: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: metrics.minimumTouchTarget / 2,
  },
});
