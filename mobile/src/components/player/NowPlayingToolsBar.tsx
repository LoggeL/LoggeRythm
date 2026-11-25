import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track } from '../../api/types';
import { useHaptics } from '../../hooks/useHaptics';
import { strings } from '../../localization';
import { reportPlayerError } from '../../player/errors';
import { isPlayerReady } from '../../player/setup';
import { formatTimerRemaining } from '../../screens/profileModel';
import {
  nativeSleepTimerGateway,
  type ProfileSleepTimerState,
} from '../../screens/profileSleepTimer';
import { shareTrack } from '../../share/outboundShare';
import { colors, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { SleepTimerPanel } from '../profile/SleepTimerPanel';
import { showTrackActions } from '../trackActions';
import { AppText, BottomSheet, IconButton } from '../ui';
import { NowPlayingAudioTools } from './NowPlayingAudioTools';

export interface NowPlayingToolsBarProps {
  track: Track;
}

function compactTimerLabel(timer: ProfileSleepTimerState): string | null {
  if (timer === null) return null;
  if (timer.type === 'mediaItem') return strings.profile.endOfTrack;
  return formatTimerRemaining(timer.remainingSeconds);
}

/**
 * Secondary utility row on Now Playing: quick Sleep Timer sheet with live
 * remaining badge, Audio Craft & Visualizer tools, outbound track Share, and
 * the full TrackActions overflow.
 */
export function NowPlayingToolsBar({ track }: NowPlayingToolsBarProps) {
  const haptics = useHaptics();
  const [sleepSheetOpen, setSleepSheetOpen] = useState(false);
  const [timer, setTimer] = useState<ProfileSleepTimerState>(null);

  useEffect(() => {
    const refresh = () => {
      if (!isPlayerReady()) {
        setTimer(null);
        return;
      }
      try {
        setTimer(nativeSleepTimerGateway.read());
      } catch (cause: unknown) {
        setTimer(null);
        console.error('[LoggeRythm] Failed to read native sleep timer state:', cause);
      }
    };
    const immediate = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 1000);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [sleepSheetOpen]);

  const timerBadge = compactTimerLabel(timer);

  const handleShare = () => {
    haptics.trigger('tap');
    void shareTrack(track).catch((cause: unknown) => {
      reportPlayerError(strings.player.shareFailed, cause);
    });
  };

  const handleMore = () => {
    haptics.trigger('tap');
    showTrackActions(track, (message) => {
      reportPlayerError(message, new Error(message));
    });
  };

  return (
    <>
      <View testID="now-playing-tools-bar" style={styles.row}>
        <Pressable
          testID="now-playing-sleep-timer"
          accessibilityRole="button"
          accessibilityLabel={
            timerBadge !== null
              ? strings.player.sleepTimerActive(timerBadge)
              : strings.player.sleepTimer
          }
          accessibilityState={{ selected: timerBadge !== null }}
          focusable
          onPress={() => {
            haptics.trigger('tap');
            setSleepSheetOpen(true);
          }}
          style={({ pressed }) => [
            styles.pill,
            timerBadge !== null ? styles.pillActive : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <AppIcon
            name="timer-outline"
            size={18}
            color={timerBadge !== null ? colors.accentSoft : colors.textSecondary}
          />
          <AppText
            variant="caption"
            color={timerBadge !== null ? 'accent' : 'secondary'}
            numberOfLines={1}
          >
            {timerBadge ?? strings.player.sleepTimer}
          </AppText>
        </Pressable>

        <NowPlayingAudioTools track={track} />

        <IconButton
          testID="now-playing-share"
          icon="share-variant"
          variant="tonal"
          haptic="tap"
          focusable
          accessibilityLabel={strings.player.shareTrack}
          onPress={handleShare}
        />

        <IconButton
          testID="now-playing-more"
          icon="dots-horizontal"
          variant="tonal"
          haptic="tap"
          focusable
          accessibilityLabel={strings.player.moreTrackActions}
          onPress={handleMore}
        />
      </View>

      <BottomSheet
        visible={sleepSheetOpen}
        onClose={() => setSleepSheetOpen(false)}
        closeLabel={strings.player.sleepTimerSheetClose}
        testID="now-playing-sleep-sheet"
      >
        <SleepTimerPanel />
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  pill: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.fill,
  },
  pillActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSubtle,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
