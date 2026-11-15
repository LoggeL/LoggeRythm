import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MINI_PLAYER_HEIGHT, TAB_BAR_HEIGHT } from '../components/MiniPlayer';
import PlayerNoticeBanner from '../components/PlayerNoticeBanner';
import { strings } from '../localization';
import { clearPlayerError, usePlayerError } from '../player/errors';
import { useActiveMediaItem } from '../player/player';
import { colors, elevation, metrics, opacity, radii, spacing, typography } from '../theme';

/** Fatal playback error, floating above the mini player until dismissed. */
export function PlayerErrorBanner({ hasTabBar = true }: { hasTabBar?: boolean }) {
  const error = usePlayerError();
  const insets = useSafeAreaInsets();
  if (!error) return null;
  return (
    <View
      testID="player-error-banner"
      style={[
        styles.errorBanner,
        {
          bottom:
            (hasTabBar ? TAB_BAR_HEIGHT : 0) +
            insets.bottom +
            MINI_PLAYER_HEIGHT +
            spacing.xs,
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Text style={styles.errorText} numberOfLines={3}>{error}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.player.playerErrorDismiss}
        onPress={clearPlayerError}
        hitSlop={8}
        style={({ pressed }) => [styles.dismissButton, pressed && styles.pressed]}
      >
        <Text style={styles.dismiss}>{strings.common.dismiss}</Text>
      </Pressable>
    </View>
  );
}

/** Non-fatal notices while nothing is loaded; MiniPlayer hosts them otherwise. */
export function PlayerNoticeWithoutMiniPlayer({ hasTabBar = true }: { hasTabBar?: boolean }) {
  const item = useActiveMediaItem();
  const insets = useSafeAreaInsets();
  if (item !== undefined && item !== null) return null;
  return (
    <PlayerNoticeBanner
      bottom={(hasTabBar ? TAB_BAR_HEIGHT : 0) + insets.bottom + spacing.xs}
    />
  );
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
  },
  dismiss: { ...typography.label, color: colors.textPrimary },
  pressed: { opacity: opacity.pressed },
});
