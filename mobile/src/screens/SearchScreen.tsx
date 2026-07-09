import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import * as api from '../api/endpoints';
import type { Track } from '../api/types';
import TrackRow from '../components/TrackRow';
import { showTrackActions } from '../components/trackActions';
import { playTracks } from '../player/controller';
import { colors } from '../theme';

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const token = ++requestId.current;
    const controller = new AbortController();
    const q = query.trim();
    if (q.length < 2) {
      return () => controller.abort();
    }

    const timer = setTimeout(() => {
      void api
        .searchTracks(q, controller.signal)
        .then((tracks) => {
          if (token === requestId.current && !controller.signal.aborted) {
            setResults(tracks);
            setError(null);
          }
        })
        .catch((cause) => {
          if (token === requestId.current && !controller.signal.aborted) {
            setError((cause as Error).message);
          }
        })
        .finally(() => {
          if (token === requestId.current && !controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const updateQuery = (value: string) => {
    requestId.current += 1;
    setQuery(value);
    setError(null);
    if (value.trim().length < 2) {
      setResults([]);
      setLoading(false);
    } else {
      setLoading(true);
    }
  };

  const play = (index: number) => {
    void playTracks(results, index).catch((cause) => setError((cause as Error).message));
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          accessibilityLabel="Search songs and artists"
          style={styles.input}
          placeholder="Songs, artists…"
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={updateQuery}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      {loading && <ActivityIndicator color={colors.accent} style={styles.loader} />}
      {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      <FlatList
        data={results}
        keyExtractor={(track, index) => `${track.id}:${index}`}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            onPress={() => play(index)}
            onLongPress={() => showTrackActions(item, setError)}
          />
        )}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={styles.hint}>
              {query.trim().length < 2 ? 'Type at least two characters to search.' : 'No tracks found.'}
            </Text>
          ) : null
        }
        contentContainerStyle={styles.listContent}
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
  loader: { marginTop: 24 },
  error: { color: colors.error, paddingHorizontal: 16, paddingTop: 8 },
  hint: { color: colors.textDim, textAlign: 'center', marginTop: 48, paddingHorizontal: 32 },
  listContent: { paddingBottom: 120 },
});
