import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MINI_PLAYER_HEIGHT, TAB_BAR_HEIGHT } from '../components/MiniPlayer';
import PlayerNoticeBanner from '../components/PlayerNoticeBanner';
import {
  createFocusRingController,
  FocusRingOverlay,
} from '../components/ui/PressableScale';
import { strings } from '../localization';
import { useHasEffectiveActiveTrack } from '../connect/effectivePlaybackState';
import { useMiniPlayerOutputStripHeight } from '../hooks/useBottomInset';
import { clearPlayerError, usePlayerError } from '../player/errors';
import { colors, elevation, metrics, opacity, radii, spacing, typography } from '../theme';
import { useTvEnvironment } from '../tv';

/** Matches `TV_BAR_HEIGHT` in `MiniPlayer.tsx` (76dp surface + 16dp bottom offset = 92dp). */
const TV_MINI_PLAYER_SURFACE_HEIGHT = 76;

export interface PlayerOverlayBottomOffsetInput {
  hasTabBar: boolean;
  bottomInset: number;
  isTv: boolean;
  aboveMiniPlayer: boolean;
  /** Height of the mini player's output strip row while it is shown; see `useMiniPlayerOutputStripHeight`. */
  outputStripHeight?: number;
}

/**
 * Computes overlay bottom clearance across phones (optional 64dp tab bar +
 * 72dp MiniPlayer) and Android TV (no phone tab bar; 92dp TV MiniPlayer
 * footprint when a MiniPlayer sits below).
 */
export function playerOverlayBottomOffset({
  hasTabBar,
  bottomInset,
  isTv,
  aboveMiniPlayer,
  outputStripHeight = 0,
}: PlayerOverlayBottomOffsetInput): number {
  if (isTv) {
    if (!aboveMiniPlayer) {
      return Math.max(spacing.md, bottomInset + spacing.xs);
    }
    const tvBarBottom = Math.max(spacing.md, bottomInset + metrics.miniPlayerGap);
    return tvBarBottom + TV_MINI_PLAYER_SURFACE_HEIGHT + outputStripHeight + spacing.xs;
  }
  return (
    (hasTabBar ? TAB_BAR_HEIGHT : 0) +
    bottomInset +
    (aboveMiniPlayer ? MINI_PLAYER_HEIGHT + outputStripHeight : 0) +
    spacing.xs
  );
}

/** Fatal playback error, floating above the mini player until dismissed. */
export function PlayerErrorBanner({ hasTabBar = true }: { hasTabBar?: boolean }) {
  const error = usePlayerError();
  const insets = useSafeAreaInsets();
  const tv = useTvEnvironment();
  const [dismissFocus] = useState(createFocusRingController);
  const outputStripHeight = useMiniPlayerOutputStripHeight();
  if (!error) return null;
  const bottom = playerOverlayBottomOffset({
    hasTabBar: hasTabBar && !tv.isTv,
    bottomInset: insets.bottom,
    isTv: tv.isTv,
    aboveMiniPlayer: true,
    outputStripHeight,
  });
  return (
    <View
      testID="player-error-banner"
      focusable={false}
      style={[styles.errorBanner, { bottom }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Text style={styles.errorText} numberOfLines={3}>{error}</Text>
      <Pressable
        testID="player-error-dismiss"
        accessibilityRole="button"
        accessibilityLabel={strings.player.playerErrorDismiss}
        focusable
        onFocus={() => dismissFocus.setFocused(true)}
        onBlur={() => dismissFocus.setFocused(false)}
        onPress={clearPlayerError}
        hitSlop={8}
        style={({ pressed }) => [styles.dismissButton, pressed && styles.pressed]}
      >
        <Text style={styles.dismiss}>{strings.common.dismiss}</Text>
        <FocusRingOverlay controller={dismissFocus} borderRadius={radii.md} />
      </Pressable>
    </View>
  );
}

/** Non-fatal notices while nothing is loaded; MiniPlayer hosts them otherwise. */
export function PlayerNoticeWithoutMiniPlayer({ hasTabBar = true }: { hasTabBar?: boolean }) {
  const hasActiveTrack = useHasEffectiveActiveTrack();
  const insets = useSafeAreaInsets();
  const tv = useTvEnvironment();
  if (hasActiveTrack) return null;
  const bottom = playerOverlayBottomOffset({
    hasTabBar: hasTabBar && !tv.isTv,
    bottomInset: insets.bottom,
    isTv: tv.isTv,
    aboveMiniPlayer: false,
  });
  return <PlayerNoticeBanner bottom={bottom} />;
}

const styles = StyleSheet.create({
  errorBanner: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSubtle,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    zIndex: 3,
    ...elevation.floating,
  },
  errorText: { ...typography.callout, color: colors.textPrimary, flex: 1 },
  dismissButton: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
  },
  dismiss: { ...typography.label, color: colors.textPrimary },
  pressed: { opacity: opacity.pressed },
});
