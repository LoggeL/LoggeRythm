import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as api from '../api/endpoints';
import { resolveServerUrl } from '../api/url';
import type { PlaylistSummary } from '../api/types';
import { getApiBase } from '../config';
import type { LibraryStackParams } from '../navigation';
import { colors } from '../theme';

type Props = NativeStackScreenProps<LibraryStackParams, 'LibraryHome'>;

export default function LibraryScreen({ navigation }: Props) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [loaded, base] = await Promise.all([
        api.getPlaylists(controller.signal),
        getApiBase(),
      ]);
      const resolved = loaded.map((playlist) => ({
        ...playlist,
        cover_url:
          playlist.cover_url === null ? null : resolveServerUrl(playlist.cover_url, base),
      }));
      if (!controller.signal.aborted) setPlaylists(resolved);
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(false);
      return () => activeRequest.current?.abort();
    }, [load]),
  );

  if (loading && playlists.length === 0) {
    return <ActivityIndicator color={colors.accent} style={styles.center} />;
  }
  return (
    <View style={styles.container}>
      <FlatList
        data={playlists}
        keyExtractor={(playlist) => String(playlist.id)}
        refreshing={refreshing}
        onRefresh={() => void load(true)}
        ListHeaderComponent={
          <>
            {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Liked Songs"
              style={styles.likedRow}
              onPress={() => navigation.navigate('Playlist', { kind: 'liked', name: 'Liked Songs' })}
            >
              <View style={styles.likedIcon}><Text style={styles.likedGlyph}>♥</Text></View>
              <Text style={styles.likedText}>Liked Songs</Text>
            </Pressable>
            <Text style={styles.sectionHeader}>Playlists</Text>
          </>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.track_count} tracks`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() =>
              navigation.navigate('Playlist', { kind: 'playlist', id: item.id, name: item.name })
            }
          >
            {item.cover_url ? (
              <Image source={{ uri: item.cover_url }} style={styles.plCover} />
            ) : (
              <View style={styles.plCover}><Text style={styles.coverGlyph}>♫</Text></View>
            )}
            <View style={styles.meta}>
              <Text style={styles.plName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.plCount}>{item.track_count} tracks</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={!error ? <Text style={styles.hint}>No playlists yet.</Text> : null}
        contentContainerStyle={styles.listContent}
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
  likedGlyph: { color: '#000', fontSize: 22 },
  likedText: { color: colors.text, fontSize: 17, fontWeight: '700' },
  sectionHeader: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 8,
    textTransform: 'uppercase',
  },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, paddingHorizontal: 16 },
  pressed: { backgroundColor: colors.surface },
  plCover: { width: 56, height: 56, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  coverGlyph: { color: colors.textDim, fontSize: 20 },
  meta: { minWidth: 0, flex: 1 },
  plName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  plCount: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  hint: { color: colors.textDim, textAlign: 'center', marginTop: 24 },
  listContent: { paddingBottom: 120 },
});
