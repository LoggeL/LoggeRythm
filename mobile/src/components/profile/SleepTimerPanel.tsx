import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { strings } from '../../localization';
import { ensurePlayer, isPlayerReady } from '../../player/setup';
import { profileSleepTimerFailureMessage } from '../../screens/profileFeedback';
import { SLEEP_PRESETS_MINUTES, formatTimerRemaining } from '../../screens/profileModel';
import {
  clearSleepTimer,
  nativeSleepTimerGateway,
  setCurrentTrackRemainingSleepTimer,
  setEndOfTrackSleepTimer,
  setPresetSleepTimer,
  type ProfileSleepTimerState,
} from '../../screens/profileSleepTimer';
import { colors, radii, spacing } from '../../theme';
import { ActionButton, AppText, FilterChip } from '../ui';
import { ProfileGroup } from './ProfileGroup';

function timerStatus(timer: ProfileSleepTimerState): string {
  if (timer === null) return strings.profile.timerOff;
  if (timer.type === 'mediaItem') return strings.profile.timerEndOfTrack;
  return strings.profile.timerRemaining(formatTimerRemaining(timer.remainingSeconds));
}

/**
 * SleepTimerPanel shows the live native sleep-timer state and sets it: a
 * status pill, one chip per preset plus "end of track" / "current
 * remaining", and a cancel button that is enabled only while a timer runs.
 */
export function SleepTimerPanel() {
  const [timer, setTimer] = useState<ProfileSleepTimerState>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (!isPlayerReady()) return;
      try {
        setTimer(nativeSleepTimerGateway.read());
      } catch {
        // The MediaController can disappear while Android is tearing down;
        // explicit user actions below surface their failures.
      }
    };
    const immediate = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 1000);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, []);

  const run = async (key: string, operation: () => ProfileSleepTimerState) => {
    if (busy !== null) return;
    setBusy(key);
    setError(null);
    try {
      await ensurePlayer();
      setTimer(operation());
    } catch (failure) {
      setError(profileSleepTimerFailureMessage(failure, strings.profile));
    } finally {
      setBusy(null);
    }
  };

  const active = timer !== null;
  const blocked = busy !== null;
  return (
    <ProfileGroup
      testID="profile-sleep"
      icon="timer-outline"
      title={strings.profile.sleepTitle}
    >
      <View
        testID="profile-sleep-status"
        accessibilityLiveRegion="polite"
        style={[styles.status, active ? styles.statusActive : null]}
      >
        <View style={[styles.dot, active ? styles.dotActive : null]} />
        <AppText variant="label" color={active ? 'success' : 'secondary'} style={styles.statusText}>
          {timerStatus(timer)}
        </AppText>
      </View>
      <View style={styles.chips}>
        {SLEEP_PRESETS_MINUTES.map((minutes) => (
          <FilterChip
            key={minutes}
            testID={`profile-sleep-${minutes}`}
            label={strings.profile.minutes(minutes)}
            disabled={blocked}
            onPress={() => void run(String(minutes), () => setPresetSleepTimer(minutes))}
          />
        ))}
        <FilterChip
          testID="profile-sleep-end-track"
          label={strings.profile.endOfTrack}
          disabled={blocked}
          onPress={() => void run('end', setEndOfTrackSleepTimer)}
        />
        <FilterChip
          testID="profile-sleep-current-remaining"
          label={strings.profile.currentTrackRemaining}
          disabled={blocked}
          onPress={() => void run('remaining', setCurrentTrackRemainingSleepTimer)}
        />
      </View>
      {error ? (
        <AppText
          testID="profile-sleep-error"
          variant="callout"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {error}
        </AppText>
      ) : null}
      <ActionButton
        testID="profile-sleep-cancel"
        variant="secondary"
        icon="timer-off-outline"
        label={strings.profile.cancelTimer}
        disabled={!active || blocked}
        busy={busy === 'cancel'}
        fullWidth
        onPress={() => void run('cancel', clearSleepTimer)}
      />
    </ProfileGroup>
  );
}

const styles = StyleSheet.create({
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.fill,
  },
  statusActive: { backgroundColor: colors.successSubtle },
  dot: {
    width: spacing.xs,
    height: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.textMuted,
  },
  dotActive: { backgroundColor: colors.success },
  statusText: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.xs },
});
