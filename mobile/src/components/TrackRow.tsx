import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Track } from '../api/types';
import { colors } from '../theme';

export default function TrackRow({
  track,
  onPress,
  onLongPress,
  active,
}: {
  track: Track;
  onPress: () => void;
  onLongPress?: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${track.artist}`}
      accessibilityHint={onLongPress ? 'Long press for queue and radio actions' : undefined}
      accessibilityState={{ selected: active === true }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {track.cover ? (
        <Image source={{ uri: track.cover }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]} />
      )}
      <View style={styles.meta}>
        <Text style={[styles.title, active && styles.activeText]} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, gap: 12 },
  pressed: { backgroundColor: colors.surface },
  cover: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  coverPlaceholder: { borderWidth: 1, borderColor: colors.border },
  meta: { flex: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  activeText: { color: colors.accent },
  artist: { color: colors.textDim, fontSize: 13, marginTop: 2 },
});
