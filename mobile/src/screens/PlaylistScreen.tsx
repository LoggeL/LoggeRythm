import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as api from '../api/endpoints';
import type { Track } from '../api/types';
import TrackRow from '../components/TrackRow';
import { addToQueue, playNext, playTracks } from '../player/controller';
import type { LibraryStackParams } from '../navigation';
import { colors } from '../theme';

type Props = NativeStackScreenProps<LibraryStackParams, 'Playlist'>;

export default function PlaylistScreen({ route }: Props) {
  const params = route.params;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = params.kind === 'liked' ? api.getLikes() : api.getPlaylist(params.id).then((p) => p.tracks);
    load
      .then((t) => alive && setTracks(t))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [params]);

  const onLongPress = (track: Track) => {
    Alert.alert(track.title, undefined, [
      { text: 'Play next', onPress: () => void playNext(track) },
      { text: 'Add to queue', onPress: () => void addToQueue(track) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (loading) return <ActivityIndicator color={colors.accent} style={styles.center} />;

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={tracks}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            onPress={() => playTracks(tracks, index).catch((e) => setError((e as Error).message))}
            onLongPress={() => onLongPress(item)}
          />
        )}
        ListEmptyComponent={<Text style={styles.hint}>No tracks here yet.</Text>}
        contentContainerStyle={{ paddingBottom: 120 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg },
  error: { color: colors.error, padding: 16 },
  hint: { color: colors.textDim, textAlign: 'center', marginTop: 48 },
});
