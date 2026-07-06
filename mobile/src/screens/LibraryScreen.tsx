import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as api from '../api/endpoints';
import type { PlaylistSummary } from '../api/types';
import type { LibraryStackParams } from '../navigation';
import { colors } from '../theme';

type Props = NativeStackScreenProps<LibraryStackParams, 'LibraryHome'>;

export default function LibraryScreen({ navigation }: Props) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setError(null);
      api
        .getPlaylists()
        .then((p) => alive && setPlaylists(p))
        .catch((e) => alive && setError((e as Error).message))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, []),
  );

  if (loading) return <ActivityIndicator color={colors.accent} style={styles.center} />;

  return (
    <View style={styles.container}>
      <FlatList
        data={playlists}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={
          <>
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              style={styles.likedRow}
              onPress={() => navigation.navigate('Playlist', { kind: 'liked', name: 'Liked Songs' })}
            >
              <View style={styles.likedIcon}>
                <Text style={{ fontSize: 22 }}>♥</Text>
              </View>
              <Text style={styles.likedText}>Liked Songs</Text>
            </Pressable>
            <Text style={styles.sectionHeader}>Playlists</Text>
          </>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              navigation.navigate('Playlist', { kind: 'playlist', id: item.id, name: item.name })
            }
          >
            <View style={styles.plCover}>
              <Text style={{ fontSize: 20 }}>🎵</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.plName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.plCount}>{item.track_count} tracks</Text>
            </View>
          </Pressable>
        )}
        contentContainerStyle={{ paddingBottom: 120 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg },
  error: { color: colors.error, padding: 16 },
  likedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  likedIcon: {
    width: 56,
    height: 56,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  likedText: { color: colors.text, fontSize: 17, fontWeight: '700' },
  sectionHeader: { color: colors.textDim, fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingTop: 8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 16 },
  plCover: { width: 56, height: 56, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  plName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  plCount: { color: colors.textDim, fontSize: 13, marginTop: 2 },
});
