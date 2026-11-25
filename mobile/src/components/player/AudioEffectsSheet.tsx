import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AudioQualityTier } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { getCurrentApiBase } from '../../config';
import { musicCacheScope, musicRepository, queryKeys } from '../../data';
import { useHaptics } from '../../hooks/useHaptics';
import { wave2Strings } from '../../localization/wave2Strings';
import {
  EQUALIZER_PRESET_NAMES,
  getBassBoostState,
  getEqualizerState,
  getLoudnessConfig,
  getPlaybackSpeed,
  isNativeAudioCraftAvailable,
  LOUDNESS_PRESETS,
  PLAYBACK_SPEED_PRESETS,
  setBassBoost,
  setEqualizerBandLevel,
  setEqualizerEnabled,
  setEqualizerPreset,
  setLoudnessConfig,
  setPlaybackSpeed,
  type BassBoostState,
  type EqualizerPresetName,
  type EqualizerState,
  type LoudnessConfig,
  type LoudnessPreset,
  type PlaybackSpeedState,
} from '../../player/nativeAudioCraft';
import {
  setAudioQualityPreference,
  useAudioQualityPreference,
} from '../../player/qualityPreference';
import { colors, radii, spacing } from '../../theme';
import { ActionButton, AppText, FilterChip, ListSeparator } from '../ui';

const QUALITY_TIERS: readonly AudioQualityTier[] = ['lossless', 'high', 'saver'] as const;

function formatBandFreq(hz: number): string {
  if (hz >= 1000) {
    const khz = hz / 1000;
    return Number.isInteger(khz) ? `${khz} kHz` : `${khz.toFixed(1)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

function formatDb(levelMb: number): string {
  const db = levelMb / 100;
  const sign = db > 0 ? '+' : '';
  return `${sign}${db.toFixed(1)} dB`;
}

/** Pure-RN TV/touch-friendly stepped level bar with minus/plus buttons and visual meter. */
function LevelStepBar({
  testID,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  testID: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}) {
  const span = Math.max(1, max - min);
  const ratio = Math.max(0, Math.min(1, (value - min) / span));
  const decrement = () => onChange(Math.max(min, value - step));
  const increment = () => onChange(Math.min(max, value + step));

  return (
    <View
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      style={styles.stepBarWrap}
    >
      <Pressable
        testID={`${testID}-minus`}
        accessibilityRole="button"
        accessibilityLabel={`${label} -`}
        focusable
        onPress={decrement}
        style={styles.stepBtn}
      >
        <AppText variant="bodyStrong">−</AppText>
      </Pressable>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.round(ratio * 100)}%` }]} />
      </View>
      <Pressable
        testID={`${testID}-plus`}
        accessibilityRole="button"
        accessibilityLabel={`${label} +`}
        focusable
        onPress={increment}
        style={styles.stepBtn}
      >
        <AppText variant="bodyStrong">+</AppText>
      </Pressable>
    </View>
  );
}

export interface AudioEffectsSheetProps {
  onClose?: () => void;
}

/**
 * Full Native Audio Craft sheet: 5-band Equalizer with presets, Bass Boost,
 * Loudness Normalization (LoudnessEnhancer), Playback Speed/Pitch, and Stream Quality.
 */
export function AudioEffectsSheet({ onClose }: AudioEffectsSheetProps) {
  const haptics = useHaptics();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const scope = user === null ? null : musicCacheScope(getCurrentApiBase(), user.id);
  const quality = useAudioQualityPreference();

  const nativeAvailable = isNativeAudioCraftAvailable();
  const [loading, setLoading] = useState(nativeAvailable);
  const [error, setError] = useState<string | null>(null);
  const [eqState, setEqState] = useState<EqualizerState | null>(null);
  const [bassState, setBassState] = useState<BassBoostState | null>(null);
  const [loudnessState, setLoudnessState] = useState<LoudnessConfig | null>(null);
  const [speedState, setSpeedState] = useState<PlaybackSpeedState>({ speed: 1.0, pitch: 1.0 });

  useEffect(() => {
    if (!nativeAvailable) return undefined;
    let cancelled = false;
    void Promise.all([
      getEqualizerState(),
      getBassBoostState(),
      getLoudnessConfig(),
      getPlaybackSpeed(),
    ])
      .then(([eq, bass, loudness, speed]) => {
        if (cancelled) return;
        setEqState(eq);
        setBassState(bass);
        setLoudnessState(loudness);
        setSpeedState(speed);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const detail = cause instanceof Error ? cause.message : String(cause);
        setError(`${wave2Strings.audioEffects.loadFailed} (${detail})`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nativeAvailable]);

  const qualityMutation = useMutation({
    mutationFn: (tier: AudioQualityTier) =>
      musicRepository.updatePlaybackSettings({ preferred_quality: tier }),
    onSuccess: (updated, tier) => {
      setAudioQualityPreference(updated.preferred_quality ?? tier);
      if (scope !== null) {
        queryClient.setQueryData(queryKeys.profile.settings(scope), updated);
      }
      setError(null);
    },
    onError: (cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`${wave2Strings.audioEffects.updateFailed} (${detail})`);
    },
  });

  const runUpdate = async <T,>(action: () => Promise<T>, apply: (result: T) => void) => {
    setError(null);
    try {
      const next = await action();
      apply(next);
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`${wave2Strings.audioEffects.updateFailed} (${detail})`);
    }
  };

  return (
    <ScrollView
      testID="audio-effects-sheet"
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="title">{wave2Strings.audioEffects.title}</AppText>
          <AppText variant="caption" color="secondary">
            {wave2Strings.audioEffects.subtitle}
          </AppText>
        </View>
        {onClose !== undefined ? (
          <ActionButton
            testID="audio-effects-close"
            label={wave2Strings.audioEffects.closeButton}
            variant="ghost"
            onPress={onClose}
          />
        ) : null}
      </View>

      {error !== null ? (
        <View testID="audio-effects-error" accessibilityRole="alert" style={styles.errorBox}>
          <AppText variant="callout" color="danger">
            {error}
          </AppText>
        </View>
      ) : null}

      {/* Stream Quality */}
      <View style={styles.section}>
        <AppText variant="overline" color="secondary">
          {wave2Strings.audioEffects.qualityTitle}
        </AppText>
        <AppText variant="caption" color="muted">
          {wave2Strings.audioEffects.qualitySubtitle}
        </AppText>
        <View style={styles.chipRow}>
          {QUALITY_TIERS.map((tier) => (
            <FilterChip
              key={tier}
              testID={`audio-quality-${tier}`}
              label={wave2Strings.audioEffects.qualityOptions[tier].label}
              selected={quality === tier}
              disabled={qualityMutation.isPending}
              onPress={() => {
                haptics.trigger('tap');
                qualityMutation.mutate(tier);
              }}
            />
          ))}
        </View>
        <AppText variant="caption" color="secondary">
          {wave2Strings.audioEffects.qualityOptions[quality].hint}
        </AppText>
      </View>

      <ListSeparator />

      {!nativeAvailable ? (
        <AppText testID="audio-effects-unavailable" variant="callout" color="secondary">
          {wave2Strings.audioEffects.nativeUnavailable}
        </AppText>
      ) : loading ? (
        <View testID="audio-effects-loading" style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <>
          {/* 5-Band Equalizer */}
          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <AppText variant="bodyStrong">{wave2Strings.audioEffects.eqTitle}</AppText>
                {eqState !== null && !eqState.supported ? (
                  <AppText variant="caption" color="muted">
                    {wave2Strings.audioEffects.eqUnsupported}
                  </AppText>
                ) : null}
              </View>
              <Switch
                testID="audio-eq-toggle"
                accessibilityLabel={wave2Strings.audioEffects.eqEnabled}
                disabled={eqState === null || !eqState.supported}
                value={eqState?.enabled === true}
                onValueChange={(next) => {
                  haptics.trigger('tap');
                  void runUpdate(() => setEqualizerEnabled(next), setEqState);
                }}
                trackColor={{ false: colors.border, true: colors.accentSolid }}
                thumbColor={eqState?.enabled ? colors.onAccent : colors.textSecondary}
              />
            </View>

            {eqState !== null && eqState.supported ? (
              <>
                <View style={styles.chipRow}>
                  {EQUALIZER_PRESET_NAMES.map((preset: EqualizerPresetName) => (
                    <FilterChip
                      key={preset}
                      testID={`audio-eq-preset-${preset}`}
                      label={wave2Strings.audioEffects.presets[preset]}
                      selected={eqState.preset === preset}
                      onPress={() => {
                        haptics.trigger('tap');
                        void runUpdate(() => setEqualizerPreset(preset), setEqState);
                      }}
                    />
                  ))}
                </View>

                <View style={styles.bandsList}>
                  {eqState.bands.map((band) => (
                    <View key={band.index} style={styles.bandRow}>
                      <AppText variant="caption" color="secondary" style={styles.bandFreq}>
                        {formatBandFreq(band.centerFreqHz)}
                      </AppText>
                      <LevelStepBar
                        testID={`audio-eq-band-${band.index}`}
                        label={formatBandFreq(band.centerFreqHz)}
                        min={eqState.minBandLevelMb}
                        max={eqState.maxBandLevelMb}
                        step={100}
                        value={band.levelMb}
                        onChange={(value) => {
                          haptics.trigger('drag');
                          void runUpdate(
                            () => setEqualizerBandLevel(band.index, value),
                            setEqState,
                          );
                        }}
                      />
                      <AppText variant="caption" color="primary" style={styles.bandDb}>
                        {formatDb(band.levelMb)}
                      </AppText>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </View>

          <ListSeparator />

          {/* Bass Boost */}
          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <AppText variant="bodyStrong">{wave2Strings.audioEffects.bassBoostTitle}</AppText>
                <AppText variant="caption" color="secondary">
                  {wave2Strings.audioEffects.bassBoostStrength(
                    Math.round(((bassState?.strength ?? 0) / 1000) * 100),
                  )}
                </AppText>
              </View>
              <Switch
                testID="audio-bass-toggle"
                accessibilityLabel={wave2Strings.audioEffects.bassBoostEnabled}
                disabled={bassState === null || !bassState.supported}
                value={bassState?.enabled === true}
                onValueChange={(next) => {
                  haptics.trigger('tap');
                  void runUpdate(
                    () => setBassBoost(next, bassState?.strength ?? 400),
                    setBassState,
                  );
                }}
                trackColor={{ false: colors.border, true: colors.accentSolid }}
                thumbColor={bassState?.enabled ? colors.onAccent : colors.textSecondary}
              />
            </View>
            {bassState !== null && bassState.supported ? (
              <LevelStepBar
                testID="audio-bass-slider"
                label={wave2Strings.audioEffects.bassBoostTitle}
                min={0}
                max={1000}
                step={100}
                value={bassState.strength}
                onChange={(value) => {
                  haptics.trigger('drag');
                  void runUpdate(
                    () => setBassBoost(value > 0 ? true : bassState.enabled, value),
                    setBassState,
                  );
                }}
              />
            ) : null}
          </View>

          <ListSeparator />

          {/* Loudness Normalization */}
          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <AppText variant="bodyStrong">{wave2Strings.audioEffects.loudnessTitle}</AppText>
              </View>
              <Switch
                testID="audio-loudness-toggle"
                accessibilityLabel={wave2Strings.audioEffects.loudnessEnabled}
                disabled={loudnessState === null}
                value={loudnessState?.enabled === true}
                onValueChange={(next) => {
                  haptics.trigger('tap');
                  void runUpdate(
                    () => setLoudnessConfig(next, loudnessState?.preset ?? 'normal'),
                    setLoudnessState,
                  );
                }}
                trackColor={{ false: colors.border, true: colors.accentSolid }}
                thumbColor={loudnessState?.enabled ? colors.onAccent : colors.textSecondary}
              />
            </View>
            {loudnessState !== null ? (
              <View style={styles.chipRow}>
                {LOUDNESS_PRESETS.map((preset: LoudnessPreset) => (
                  <FilterChip
                    key={preset}
                    testID={`audio-loudness-${preset}`}
                    label={wave2Strings.audioEffects.loudnessPresets[preset]}
                    selected={loudnessState.preset === preset}
                    onPress={() => {
                      haptics.trigger('tap');
                      void runUpdate(
                        () => setLoudnessConfig(true, preset),
                        setLoudnessState,
                      );
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>

          <ListSeparator />

          {/* Playback Speed */}
          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <AppText variant="bodyStrong">{wave2Strings.audioEffects.speedTitle}</AppText>
              <AppText variant="caption" color="accent">
                {wave2Strings.audioEffects.speedValue(speedState.speed)}
              </AppText>
            </View>
            <View style={styles.chipRow}>
              {PLAYBACK_SPEED_PRESETS.map((rate) => (
                <FilterChip
                  key={rate}
                  testID={`audio-speed-${String(rate).replace('.', '_')}`}
                  label={wave2Strings.audioEffects.speedValue(rate)}
                  selected={Math.abs(speedState.speed - rate) < 0.01}
                  onPress={() => {
                    haptics.trigger('tap');
                    void runUpdate(
                      () => setPlaybackSpeed(rate, speedState.pitch),
                      setSpeedState,
                    );
                  }}
                />
              ))}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    maxHeight: 560,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  section: {
    gap: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  toggleCopy: {
    flex: 1,
    gap: spacing.xxs / 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  bandsList: {
    gap: spacing.xs,
  },
  bandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  bandFreq: {
    width: 56,
  },
  bandDb: {
    width: 60,
    textAlign: 'right',
  },
  stepBarWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepBtn: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meterTrack: {
    flex: 1,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.fillStrong,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  loadingRow: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  errorBox: {
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.fill,
  },
});
