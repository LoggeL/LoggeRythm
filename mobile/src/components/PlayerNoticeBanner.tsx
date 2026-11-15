import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { clearPlayerNotice, usePlayerNotice } from '../player/notices';
import { usePlayerError } from '../player/errors';
import { strings } from '../localization';
import { colors, elevation, metrics, opacity, radii, spacing } from '../theme';
import { AppText } from './ui';

export default function PlayerNoticeBanner({ bottom }: { bottom?: number }) {
  const notice = usePlayerNotice();
  const fatalError = usePlayerError();
  // A bookkeeping status must never cover or visually compete with a real
  // playback failure. It remains short-lived in the separate notice store.
  if (notice === null || fatalError !== null) return null;

  return (
    <View
      testID="player-nonfatal-notice"
      accessibilityLiveRegion="polite"
      style={[styles.notice, bottom === undefined ? styles.inline : styles.overlay, { bottom }]}
    >
      <View style={styles.copy}>
        <AppText variant="label" color="warning">{notice.title}</AppText>
        <AppText variant="caption" color="secondary">{notice.message}</AppText>
      </View>
      <Pressable
        testID="player-nonfatal-notice-dismiss"
        accessibilityRole="button"
        accessibilityLabel={strings.common.dismiss}
        onPress={() => clearPlayerNotice(notice.id)}
        style={({ pressed }) => [styles.dismissButton, pressed && styles.pressed]}
      >
        <AppText variant="label">{strings.common.dismiss}</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warning,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  inline: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  overlay: {
    position: 'absolute',
    left: spacing.xs,
    right: spacing.xs,
    zIndex: 1,
    ...elevation.floating,
  },
  copy: { minWidth: 0, flex: 1 },
  dismissButton: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  pressed: { opacity: opacity.pressed },
});
