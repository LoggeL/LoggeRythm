import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Switch, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AudioQualityTier, PlaybackSettings } from '../../api/types';
import type { PlaybackSettingsUpdate } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { getCurrentApiBase } from '../../config';
import { musicCacheScope, musicQueries, musicRepository, queryKeys } from '../../data';
import { strings } from '../../localization';
import { wave2Strings } from '../../localization/wave2Strings';
import { syncNativePlaybackSettings } from '../../player/playbackSettingsSync';
import { colors, layout, spacing } from '../../theme';
import { AudioEffectsSheet } from '../player/AudioEffectsSheet';
import { ActionButton, AppText, BottomSheet, ErrorState, FilterChip, ListSeparator, Skeleton, Surface } from '../ui';
import { ProfileGroup } from './ProfileGroup';

export const CROSSFADE_PRESETS_SECONDS = [0, 2, 4, 6, 8, 12] as const;
const QUALITY_TIERS: readonly AudioQualityTier[] = ['lossless', 'high', 'saver'] as const;

export interface PlaybackSettingsPanelProps {
  /** Omit the inner "Playback" group header when the screen header already carries that title. */
  hideHeader?: boolean;
}

export interface PlaybackSettingsPanelViewProps {
  settings: PlaybackSettings | undefined;
  isPending: boolean;
  isError: boolean;
  saving: boolean;
  savedNotice: boolean;
  saveError: string | null;
  onRetry: () => void;
  onUpdate: (patch: PlaybackSettingsUpdate) => void;
  onOpenAudioEffects?: () => void;
  hideHeader?: boolean;
}

export function PlaybackSettingsPanelView({
  settings,
  isPending,
  isError,
  saving,
  savedNotice,
  saveError,
  onRetry,
  onUpdate,
  onOpenAudioEffects,
  hideHeader = false,
}: PlaybackSettingsPanelViewProps) {
  const enabled = settings?.crossfade_enabled === true;
  const durationSec = settings?.crossfade_duration_sec ?? 4;
  const quality: AudioQualityTier = settings?.preferred_quality ?? 'high';
  const shareActivity = settings?.share_listening_activity === true;
  const djTransitions = settings?.dj_transitions_enabled === true;

  const content = isPending && settings === undefined ? (
    <View testID="profile-playback-loading" style={styles.skeleton}>
      <Skeleton width="65%" height={20} />
      <Skeleton width="90%" height={36} />
    </View>
  ) : isError && settings === undefined ? (
    <ErrorState
      testID="profile-playback-error"
      retryTestID="profile-playback-retry"
      message={strings.profile.crossfadeLoadFailed}
      onRetry={onRetry}
      style={styles.flat}
    />
  ) : (
    <>
      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <AppText variant="bodyStrong">{strings.profile.crossfadeEnabled}</AppText>
        </View>
        <Switch
          testID="profile-crossfade-toggle"
          accessibilityLabel={strings.profile.crossfadeEnabled}
          disabled={saving}
          value={enabled}
          onValueChange={(next) => {
            onUpdate({
              crossfade_enabled: next,
              ...(next && durationSec <= 0 ? { crossfade_duration_sec: 4 } : {}),
            });
          }}
          trackColor={{ false: colors.border, true: colors.accentSolid }}
          thumbColor={enabled ? colors.onAccent : colors.textSecondary}
        />
      </View>

      <View style={styles.chips}>
        {CROSSFADE_PRESETS_SECONDS.map((seconds) => {
          const selected = enabled ? durationSec === seconds : seconds === 0;
          return (
            <FilterChip
              key={seconds}
              testID={`profile-crossfade-${seconds}`}
              label={strings.profile.crossfadeDuration(seconds)}
              selected={selected}
              disabled={saving}
              onPress={() =>
                onUpdate({
                  crossfade_enabled: seconds > 0,
                  crossfade_duration_sec: seconds,
                })
              }
            />
          );
        })}
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <AppText variant="bodyStrong">{strings.profile.djTransitionsEnabled}</AppText>
          <AppText variant="caption" color="secondary">
            {strings.profile.djTransitionsHint}
          </AppText>
        </View>
        <Switch
          testID="profile-dj-transitions-toggle"
          accessibilityLabel={strings.profile.djTransitionsEnabled}
          disabled={saving}
          value={djTransitions}
          onValueChange={(next) => onUpdate({ dj_transitions_enabled: next })}
          trackColor={{ false: colors.border, true: colors.accentSolid }}
          thumbColor={djTransitions ? colors.onAccent : colors.textSecondary}
        />
      </View>

      <ListSeparator />

      <View style={styles.subSection}>
        <AppText variant="bodyStrong">{wave2Strings.audioEffects.qualityTitle}</AppText>
        <AppText variant="caption" color="secondary">
          {wave2Strings.audioEffects.qualitySubtitle}
        </AppText>
        <View style={styles.chips}>
          {QUALITY_TIERS.map((tier) => (
            <FilterChip
              key={tier}
              testID={`profile-quality-${tier}`}
              label={wave2Strings.audioEffects.qualityOptions[tier].label}
              selected={quality === tier}
              disabled={saving}
              onPress={() => onUpdate({ preferred_quality: tier })}
            />
          ))}
        </View>
      </View>

      <ListSeparator />

      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <AppText variant="bodyStrong">{wave2Strings.friends.shareActivityLabel}</AppText>
          <AppText variant="caption" color="secondary">
            {wave2Strings.friends.shareActivityHint}
          </AppText>
        </View>
        <Switch
          testID="profile-share-activity-toggle"
          accessibilityLabel={wave2Strings.friends.shareActivityLabel}
          disabled={saving}
          value={shareActivity}
          onValueChange={(next) => onUpdate({ share_listening_activity: next })}
          trackColor={{ false: colors.border, true: colors.accentSolid }}
          thumbColor={shareActivity ? colors.onAccent : colors.textSecondary}
        />
      </View>

      {onOpenAudioEffects !== undefined ? (
        <ActionButton
          testID="profile-open-audio-effects"
          label={wave2Strings.audioEffects.openFromProfile}
          variant="secondary"
          onPress={onOpenAudioEffects}
        />
      ) : null}

      {savedNotice ? (
        <AppText
          testID="profile-crossfade-saved"
          accessibilityLiveRegion="polite"
          variant="callout"
          color="success"
        >
          {strings.profile.crossfadeSaved}
        </AppText>
      ) : null}

      {saveError !== null ? (
        <AppText
          testID="profile-crossfade-save-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          variant="callout"
          color="danger"
        >
          {saveError}
        </AppText>
      ) : null}
    </>
  );

  if (hideHeader) {
    return (
      <Surface testID="profile-playback" padded style={styles.card}>
        {content}
      </Surface>
    );
  }

  return (
    <ProfileGroup
      testID="profile-playback"
      icon="transition"
      title={strings.profile.playbackTitle}
    >
      {content}
    </ProfileGroup>
  );
}

function applySyncedPlaybackSettings(settings: PlaybackSettings): void {
  void syncNativePlaybackSettings(settings).catch((cause: unknown) => {
    console.error('[LoggeRythm] Failed to sync native playback settings:', cause);
  });
}

/** Account-synced Playback settings card backed by GET/PATCH /api/me/settings. */
export default function PlaybackSettingsPanel({
  hideHeader = false,
}: PlaybackSettingsPanelProps = {}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const scope = user === null ? null : musicCacheScope(getCurrentApiBase(), user.id);
  const [savedNotice, setSavedNotice] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [effectsOpen, setEffectsOpen] = useState(false);

  const query = useQuery({
    ...musicQueries.playbackSettings(scope ?? 'signed-out'),
    enabled: scope !== null,
  });

  useEffect(() => {
    if (query.data !== undefined) {
      applySyncedPlaybackSettings(query.data);
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (patch: PlaybackSettingsUpdate) =>
      musicRepository.updatePlaybackSettings(patch),
    onMutate: () => {
      setSavedNotice(false);
      setSaveError(null);
    },
    onSuccess: (updated) => {
      if (scope !== null) {
        queryClient.setQueryData(queryKeys.profile.settings(scope), updated);
      }
      applySyncedPlaybackSettings(updated);
      setSavedNotice(true);
      AccessibilityInfo.announceForAccessibility(strings.profile.crossfadeSaved);
    },
    onError: () => {
      setSaveError(strings.profile.crossfadeSaveFailed);
    },
  });

  return (
    <>
      <PlaybackSettingsPanelView
        settings={query.data}
        isPending={query.isPending}
        isError={query.isError}
        saving={mutation.isPending}
        savedNotice={savedNotice}
        saveError={saveError}
        onRetry={() => void query.refetch()}
        onUpdate={(patch) => mutation.mutate(patch)}
        onOpenAudioEffects={() => setEffectsOpen(true)}
        hideHeader={hideHeader}
      />
      <BottomSheet
        visible={effectsOpen}
        onClose={() => setEffectsOpen(false)}
        closeLabel={wave2Strings.audioEffects.closeButton}
        testID="profile-audio-effects-sheet"
      >
        <AudioEffectsSheet onClose={() => setEffectsOpen(false)} />
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: layout.stackGap },
  flat: { padding: 0, borderWidth: 0, backgroundColor: 'transparent' },
  skeleton: { gap: spacing.sm },
  subSection: { gap: spacing.xs },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs / 2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.xs,
  },
});
