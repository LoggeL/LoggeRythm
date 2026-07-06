import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as api from '../api/endpoints';
import type { Track } from '../api/types';
import TrackRow from '../components/TrackRow';
import { addToQueue, playNext, playTracks } from '../player/controller';
import { colors } from '../theme';

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic token so a slow earlier request can't overwrite a newer one.
  const reqId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const token = ++reqId.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api.searchTracks(q);
        if (token === reqId.current) {
          setResults(r);
          setError(null);
        }
      } catch (e) {
        if (token === reqId.current) setError((e as Error).message);
      } finally {
        if (token === reqId.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const onTrackPress = (index: number) => {
    playTracks(results, index).catch((e) => setError((e as Error).message));
  };

  const onTrackLongPress = (track: Track) => {
    Alert.alert(track.title, undefined, [
      { text: 'Play next', onPress: () => void playNext(track) },
      { text: 'Add to queue', onPress: () => void addToQueue(track) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="Songs, artists…"
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {loading && <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />}
      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={results}
        keyExtractor={(t) => String(t.id)}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            onPress={() => onTrackPress(index)}
            onLongPress={() => onTrackLongPress(item)}
          />
        )}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={styles.hint}>Search your library — long-press a result to queue it.</Text>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchBar: { padding: 16 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { color: colors.error, paddingHorizontal: 16, paddingTop: 8 },
  hint: { color: colors.textDim, textAlign: 'center', marginTop: 48, paddingHorizontal: 32 },
});
