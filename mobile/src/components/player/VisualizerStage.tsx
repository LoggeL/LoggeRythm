import React, { useCallback, useEffect, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { wave2Strings } from '../../localization/wave2Strings';
import {
  isNativeMethodAvailable,
  setVisualizerEnabled,
  subscribeVisualizerFrames,
  type VisualizerFrameEvent,
} from '../../player/nativeAudioCraft';
import { colors, radii, spacing } from '../../theme';
import { ActionButton, AppText } from '../ui';

const DEFAULT_BAND_COUNT = 28;
const IDLE_BANDS = Array.from({ length: DEFAULT_BAND_COUNT }, () => 0.06);

export type VisualizerErrorKind =
  | 'permission-denied'
  | 'session-unavailable'
  | 'unsupported'
  | 'generic';

export function classifyVisualizerError(error: unknown): {
  kind: VisualizerErrorKind;
  message: string;
} {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const detail = error instanceof Error ? error.message : String(error);
  const combined = `${code} ${detail}`.toLowerCase();
  if (combined.includes('visualizer-permission-denied') || combined.includes('permission')) {
    return {
      kind: 'permission-denied',
      message: wave2Strings.visualizer.permissionDenied,
    };
  }
  if (combined.includes('visualizer-session-unavailable') || combined.includes('session')) {
    return {
      kind: 'session-unavailable',
      message: wave2Strings.visualizer.sessionUnavailable,
    };
  }
  return {
    kind: 'generic',
    message: `${wave2Strings.visualizer.genericError} (${detail})`,
  };
}

export interface VisualizerBarsProps {
  bands: readonly number[];
  bass?: number;
  maxBarHeight?: number;
  reducedMotion?: boolean;
  accentColor?: string;
  testID?: string;
}

/** Pure 28-band real-time FFT spectrum bar visualization. */
export function VisualizerBars({
  bands,
  bass = 0,
  maxBarHeight = 140,
  reducedMotion = false,
  accentColor = colors.accent,
  testID = 'visualizer-bars',
}: VisualizerBarsProps) {
  const rendered = bands.length > 0 ? bands : IDLE_BANDS;
  const glowOpacity = reducedMotion ? 0.12 : Math.min(0.36, 0.1 + Math.max(0, bass) * 0.28);

  return (
    <View testID={testID} style={[styles.stage, { minHeight: maxBarHeight + 24 }]}>
      <View
        accessible={false}
        pointerEvents="none"
        style={[
          styles.bassGlow,
          { backgroundColor: accentColor, opacity: glowOpacity },
        ]}
      />
      <View style={[styles.barsRow, { height: maxBarHeight }]}>
        {rendered.map((magnitude, index) => {
          const clamped = Number.isFinite(magnitude) ? Math.max(0.05, Math.min(1, magnitude)) : 0.05;
          const height = Math.max(6, Math.round(clamped * maxBarHeight));
          const highlight = index < 6 || clamped > 0.6;
          return (
            <View
              key={index}
              style={[
                styles.bar,
                {
                  height,
                  backgroundColor: highlight ? accentColor : colors.textSecondary,
                  opacity: highlight ? 0.96 : 0.55,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

export interface VisualizerStageProps {
  active?: boolean;
  maxBarHeight?: number;
  accentColor?: string;
  testID?: string;
}

/**
 * Live Android Visualizer stage. Explicitly requests RECORD_AUDIO before enabling
 * `NativeModules.LoggeRythmPlayer.setVisualizerEnabled(true)`, streams
 * `LoggeRythmVisualizerFrame`, and surfaces permission/session errors loudly.
 */
export function VisualizerStage({
  active = true,
  maxBarHeight = 140,
  accentColor = colors.accent,
  testID = 'visualizer-stage',
}: VisualizerStageProps) {
  const reducedMotion = useReducedMotion();
  const nativeSupported = isNativeMethodAvailable('setVisualizerEnabled');
  const [frame, setFrame] = useState<VisualizerFrameEvent | null>(null);
  const [error, setError] = useState<{ kind: VisualizerErrorKind; message: string } | null>(
    nativeSupported
      ? null
      : { kind: 'unsupported', message: wave2Strings.audioEffects.nativeUnavailable },
  );
  const [needsPermission, setNeedsPermission] = useState(false);
  const [starting, setStarting] = useState(false);

  const requestAndStart = useCallback(async () => {
    if (!nativeSupported) return;
    setStarting(true);
    setError(null);
    try {
      if (Platform.OS === 'android') {
        const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
        const alreadyGranted = await PermissionsAndroid.check(perm);
        if (!alreadyGranted) {
          const result = await PermissionsAndroid.request(perm, {
            title: wave2Strings.visualizer.permissionTitle,
            message: wave2Strings.visualizer.permissionBody,
            buttonPositive: wave2Strings.visualizer.permissionButton,
          });
          if (result !== PermissionsAndroid.RESULTS.GRANTED) {
            setNeedsPermission(false);
            setError({
              kind: 'permission-denied',
              message: wave2Strings.visualizer.permissionDenied,
            });
            return;
          }
        }
      }
      setNeedsPermission(false);
      await setVisualizerEnabled(true);
    } catch (cause: unknown) {
      setError(classifyVisualizerError(cause));
    } finally {
      setStarting(false);
    }
  }, [nativeSupported]);

  useEffect(() => {
    if (!active || !nativeSupported) return undefined;
    let disposed = false;
    const unsubscribe = subscribeVisualizerFrames((nextFrame) => {
      if (!disposed) setFrame(nextFrame);
    });

    const boot = async () => {
      try {
        if (Platform.OS === 'android') {
          const alreadyGranted = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          );
          if (disposed) return;
          if (!alreadyGranted) {
            setNeedsPermission(true);
            return;
          }
        }
        await setVisualizerEnabled(true);
        if (!disposed) {
          setNeedsPermission(false);
          setError(null);
        }
      } catch (cause: unknown) {
        if (!disposed) setError(classifyVisualizerError(cause));
      }
    };
    void boot();

    return () => {
      disposed = true;
      unsubscribe();
      void setVisualizerEnabled(false).catch((cause: unknown) => {
        console.error('[LoggeRythm] Failed to stop native visualizer:', cause);
      });
    };
  }, [active, nativeSupported]);

  if (needsPermission) {
    return (
      <View testID={`${testID}-permission`} style={styles.noticeCard}>
        <AppText variant="bodyStrong">{wave2Strings.visualizer.permissionTitle}</AppText>
        <AppText variant="caption" color="secondary">
          {wave2Strings.visualizer.permissionBody}
        </AppText>
        <ActionButton
          testID={`${testID}-request-permission`}
          label={wave2Strings.visualizer.permissionButton}
          variant="primary"
          busy={starting}
          disabled={starting}
          onPress={() => void requestAndStart()}
        />
      </View>
    );
  }

  if (error !== null) {
    return (
      <View
        testID={`${testID}-error`}
        accessibilityRole="alert"
        style={styles.noticeCard}
      >
        <AppText variant="callout" color="danger">
          {error.message}
        </AppText>
        {error.kind !== 'unsupported' ? (
          <ActionButton
            testID={`${testID}-retry`}
            label={wave2Strings.visualizer.permissionButton}
            variant="secondary"
            busy={starting}
            disabled={starting}
            onPress={() => void requestAndStart()}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={wave2Strings.visualizer.activeLabel}
      style={styles.wrap}
    >
      <VisualizerBars
        bands={frame?.bands ?? IDLE_BANDS}
        bass={frame?.bass ?? 0}
        maxBarHeight={maxBarHeight}
        reducedMotion={reducedMotion}
        accentColor={accentColor}
        testID={`${testID}-bars`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  stage: {
    width: '100%',
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bassGlow: {
    position: 'absolute',
    left: '15%',
    right: '15%',
    bottom: -36,
    height: 96,
    borderRadius: radii.pill,
  },
  barsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 3,
  },
  bar: {
    flex: 1,
    minWidth: 3,
    borderRadius: radii.pill,
  },
  noticeCard: {
    width: '100%',
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.hairline,
    gap: spacing.sm,
  },
});
