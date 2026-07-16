import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { clearPlayerNotice, usePlayerNotice } from '../player/notices';
import { usePlayerError } from '../player/errors';
import { strings } from '../localization';
import { colors, metrics } from '../theme';

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
        <Text style={styles.title}>{notice.title}</Text>
        <Text style={styles.message}>{notice.message}</Text>
      </View>
      <Pressable
        testID="player-nonfatal-notice-dismiss"
        accessibilityRole="button"
        accessibilityLabel={strings.common.dismiss}
        onPress={() => clearPlayerNotice(notice.id)}
        style={styles.dismissButton}
      >
        <Text style={styles.dismiss}>{strings.common.dismiss}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 6,
  },
  inline: { marginHorizontal: 16, marginBottom: 10 },
  overlay: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 1,
    elevation: 5,
  },
  copy: { minWidth: 0, flex: 1 },
  title: { color: colors.warning, fontSize: 13, fontWeight: '800' },
  message: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 1 },
  dismissButton: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  dismiss: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
});
