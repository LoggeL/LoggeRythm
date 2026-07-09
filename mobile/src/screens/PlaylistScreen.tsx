import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as api from '../api/endpoints';
import type { Track } from '../api/types';
import TrackRow from '../components/TrackRow';
import { showTrackActions } from '../components/trackActions';
import { playTracks } from '../player/controller';
import type { LibraryStackParams } from '../navigation';
import { colors } from '../theme';

type Props = NativeStackScreenProps<LibraryStackParams, 'Playlist'>;

export default function PlaylistScreen({ route }: Props) {
  const params = route.params;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const loaded =
          params.kind === 'liked'
            ? await api.getLikes(controller.signal)
            : (await api.getPlaylist(params.id, controller.signal)).tracks;
        if (!controller.signal.aborted) setTracks(loaded);
      } catch (cause) {
        if (!controller.signal.aborted) setError((cause as Error).message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [params],
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
      return () => activeRequest.current?.abort();
    }, [load]),
  );

  if (loading && tracks.length === 0) {
    return <ActivityIndicator color={colors.accent} style={styles.center} />;
  }
  return (
    <View style={styles.container}>
      {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      <FlatList
        data={tracks}
        keyExtractor={(track, index) => `${track.id}:${index}`}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            onPress={() =>
              void playTracks(tracks, index).catch((cause) => setError((cause as Error).message))
            }
            onLongPress={() => showTrackActions(item, setError)}
          />
        )}
        refreshing={refreshing}
        onRefresh={() => void load(true)}
        ListEmptyComponent={!error ? <Text style={styles.hint}>No tracks here yet.</Text> : null}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg },
  error: { color: colors.error, padding: 16 },
  hint: { color: colors.textDim, textAlign: 'center', marginTop: 48 },
  listContent: { paddingBottom: 120 },
});
