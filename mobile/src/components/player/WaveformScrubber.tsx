import React, { useEffect, useMemo, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type PanResponderInstance,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { DeezerId, TrackAudioMeta } from '../../api/types';
import { musicQueries } from '../../data';
import { triggerHaptic } from '../../hooks/useHaptics';
import { wave2Strings } from '../../localization/wave2Strings';
import { colors, metrics, radii, spacing } from '../../theme';
import { AppText } from '../ui';

const TARGET_BAR_COUNT = 64;

/** Deterministically resample peak amplitudes to a clean display bar count without fabricating data. */
export function sampleWaveformPeaks(
  peaks: readonly number[],
  targetBars: number = TARGET_BAR_COUNT,
): number[] {
  if (peaks.length === 0 || targetBars <= 0) return [];
  if (peaks.length <= targetBars) {
    return peaks.map((value) => Math.max(0.08, Math.min(1, Number.isFinite(value) ? value : 0)));
  }
  const sampled: number[] = [];
  const step = peaks.length / targetBars;
  for (let i = 0; i < targetBars; i += 1) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    let maxPeak = 0;
    for (let j = start; j < end && j < peaks.length; j += 1) {
      const value = peaks[j];
      if (Number.isFinite(value) && value > maxPeak) maxPeak = value;
    }
    sampled.push(Math.max(0.08, Math.min(1, maxPeak)));
  }
  return sampled;
}

function createWaveformResponder(params: {
  width: number;
  duration: number;
  onPreview: (seconds: number) => void;
  onCommit: (seconds: number) => void;
}): PanResponderInstance {
  const positionForX = (locationX: number): number | null => {
    if (params.width <= 0 || params.duration <= 0) return null;
    const ratio = Math.max(0, Math.min(1, locationX / params.width));
    return ratio * params.duration;
  };
  return PanResponder.create({
    onStartShouldSetPanResponder: () => params.duration > 0,
    onMoveShouldSetPanResponder: () => params.duration > 0,
    onPanResponderGrant: (event) => {
      const seconds = positionForX(event.nativeEvent.locationX);
      if (seconds !== null) {
        triggerHaptic('drag');
        params.onPreview(seconds);
      }
    },
    onPanResponderMove: (event) => {
      const seconds = positionForX(event.nativeEvent.locationX);
      if (seconds !== null) {
        params.onPreview(seconds);
      }
    },
    onPanResponderRelease: (event) => {
      const seconds = positionForX(event.nativeEvent.locationX);
      if (seconds !== null) {
        triggerHaptic('commit');
        params.onCommit(seconds);
      }
    },
  });
}

export interface WaveformScrubberViewProps {
  meta: TrackAudioMeta;
  position: number;
  duration: number;
  compact?: boolean;
  isTv?: boolean;
  testIDPrefix?: string;
  onPositionChange: (seconds: number) => void;
  onSeek: (seconds: number) => void;
}

/** Pure interactive waveform scrubbar driven by real backend ffmpeg peaks. */
export function WaveformScrubberView({
  meta,
  position,
  duration,
  compact = false,
  isTv = false,
  testIDPrefix = 'now-playing',
  onPositionChange,
  onSeek,
}: WaveformScrubberViewProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [draggingSeconds, setDraggingSeconds] = useState<number | null>(null);

  const bars = useMemo(
    () => sampleWaveformPeaks(meta.peaks, compact ? 40 : TARGET_BAR_COUNT),
    [compact, meta.peaks],
  );

  const responder = useMemo(
    () =>
      createWaveformResponder({
        width: trackWidth,
        duration,
        onPreview: (seconds) => {
          setDraggingSeconds(seconds);
          onPositionChange(seconds);
        },
        onCommit: (seconds) => {
          setDraggingSeconds(null);
          onSeek(seconds);
        },
      }),
    [duration, onPositionChange, onSeek, trackWidth],
  );

  if (bars.length === 0) return null;

  const effectivePosition = draggingSeconds ?? position;
  const usableDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const progressRatio = usableDuration > 0
    ? Math.max(0, Math.min(1, effectivePosition / usableDuration))
    : 0;
  const playedBars = Math.round(progressRatio * bars.length);
  const barMaxHeight = compact ? 22 : isTv ? 28 : 36;

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (Number.isFinite(nextWidth) && nextWidth > 0) {
      setTrackWidth(nextWidth);
    }
  };

  const hasTechBadges = !compact && (meta.bpm !== null || meta.loudness_lufs !== null);

  return (
    <View testID={`${testIDPrefix}-waveform-wrap`} style={styles.wrap}>
      {hasTechBadges ? (
        <View testID={`${testIDPrefix}-waveform-meta`} style={styles.metaRow}>
          {meta.bpm !== null ? (
            <View style={styles.metaBadge}>
              <AppText variant="micro" color="secondary">
                {wave2Strings.waveform.bpmBadge(meta.bpm)}
              </AppText>
            </View>
          ) : null}
          {meta.loudness_lufs !== null ? (
            <View style={styles.metaBadge}>
              <AppText variant="micro" color="secondary">
                {wave2Strings.waveform.lufsBadge(meta.loudness_lufs)}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}
      <View
        testID={`${testIDPrefix}-waveform`}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={wave2Strings.waveform.seekLabel}
        accessibilityValue={{
          min: 0,
          max: Math.max(usableDuration, 1),
          now: Math.min(effectivePosition, Math.max(usableDuration, 1)),
        }}
        onLayout={handleLayout}
        style={[
          styles.track,
          { minHeight: compact ? 32 : metrics.minimumTouchTarget },
        ]}
        {...responder.panHandlers}
      >
        {bars.map((amplitude, index) => {
          const played = index < playedBars;
          const height = Math.max(4, Math.round(amplitude * barMaxHeight));
          return (
            <View
              key={index}
              style={[
                styles.bar,
                {
                  height,
                  backgroundColor: played ? colors.accent : colors.fillStrong,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

export interface LiveWaveformScrubberProps {
  trackId: DeezerId;
  position: number;
  duration: number;
  compact?: boolean;
  isTv?: boolean;
  testIDPrefix?: string;
  onPositionChange: (seconds: number) => void;
  onSeek: (seconds: number) => void;
}

/**
 * Expected absence statuses from `/api/tracks/{id}/audio-meta`:
 * 404 (track not yet analyzed) or 503 (analysis worker unavailable).
 * Any other failure (500/502/network/decoder error) is unexpected and must be
 * logged loudly and surfaced to the user rather than silently swallowed.
 */
export function isExpectedAudioMetaAbsence(error: unknown): boolean {
  if (error === null || error === undefined || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return status === 404 || status === 503;
}

export function unexpectedAudioMetaErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined || isExpectedAudioMetaAbsence(error)) return null;
  const detail = error instanceof Error ? error.message : String(error);
  return `${wave2Strings.waveform.metaUnavailable} (${detail})`;
}

/**
 * Fetches real ffmpeg-measured peaks from `/api/tracks/{id}/audio-meta`.
 * Returns null while loading or when analysis is unavailable so the parent
 * transport keeps its accessible linear slider without ever faking peaks.
 */
export function useTrackAudioMeta(trackId: DeezerId) {
  return useQuery({
    ...musicQueries.audioMeta(trackId),
    enabled: trackId.trim().length > 0,
  });
}

export function LiveWaveformScrubber({
  trackId,
  position,
  duration,
  compact = false,
  isTv = false,
  testIDPrefix = 'now-playing',
  onPositionChange,
  onSeek,
}: LiveWaveformScrubberProps) {
  const query = useTrackAudioMeta(trackId);
  const unexpectedError = unexpectedAudioMetaErrorMessage(query.error);

  useEffect(() => {
    if (unexpectedError !== null) {
      console.error(
        `[LoggeRythm] Unexpected waveform audio-meta failure for track ${trackId}:`,
        query.error,
      );
    }
  }, [query.error, trackId, unexpectedError]);

  const meta = query.data;
  if (meta === undefined || meta.peaks.length === 0) {
    if (unexpectedError === null) return null;
    return (
      <AppText
        testID={`${testIDPrefix}-waveform-error`}
        accessibilityRole="alert"
        variant="micro"
        color="warning"
      >
        {unexpectedError}
      </AppText>
    );
  }
  return (
    <WaveformScrubberView
      meta={meta}
      position={position}
      duration={duration}
      compact={compact}
      isTv={isTv}
      testIDPrefix={testIDPrefix}
      onPositionChange={onPositionChange}
      onSeek={onSeek}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    gap: spacing.xxs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  metaBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  track: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
    paddingVertical: spacing.xs,
  },
  bar: {
    flex: 1,
    minWidth: 2,
    borderRadius: radii.pill,
  },
});
