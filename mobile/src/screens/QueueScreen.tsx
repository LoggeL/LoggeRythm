import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TrackPlayer, { Event, type MediaItem } from '@rntp/player';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Track } from '../api/types';
import {
  getQueueSnapshot,
  moveQueueItem,
  removeQueueItem,
  skipToQueueItem,
} from '../player/controller';
import { clearPlayerError, reportPlayerError, usePlayerError } from '../player/errors';
import { mediaItemToTrack } from '../player/mediaItem';
import type { RootStackParams } from '../navigation';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParams, 'Queue'>;

interface QueueRow {
  item: MediaItem;
  mediaId: string;
  track: Track;
}

interface QueueState {
  rows: QueueRow[];
  activeIndex: number | null;
}

export default function QueueScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const playerError = usePlayerError();
  const [queue, setQueue] = useState<QueueState>({ rows: [], activeIndex: null });
  const [loaded, setLoaded] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const mutationLock = useRef(false);
  const expectedMediaIds = useMemo(
    () => queue.rows.map((candidate) => candidate.mediaId),
    [queue.rows],
  );

  const refreshQueue = useCallback(() => {
    try {
      const snapshot = getQueueSnapshot();
      const rows = snapshot.items.map((item, index) => {
        if (typeof item.mediaId !== 'string' || item.mediaId.length === 0) {
          throw new Error(`Queue item ${index} has no mediaId`);
        }
        const track = mediaItemToTrack(item);
        if (track === null) throw new Error(`Queue item ${index} has no Track metadata`);
        return { item, mediaId: item.mediaId, track };
      });
      setQueue({ rows, activeIndex: snapshot.activeIndex });
      setLoaded(true);
    } catch (cause) {
      setLoaded(true);
      reportPlayerError('Loading queue failed', cause);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = setTimeout(refreshQueue, 0);
    const queueSubscription = TrackPlayer.addEventListener(Event.QueueChanged, refreshQueue);
    const transitionSubscription = TrackPlayer.addEventListener(
      Event.MediaItemTransition,
      refreshQueue,
    );
    return () => {
      clearTimeout(initialRefresh);
      queueSubscription.remove();
      transitionSubscription.remove();
    };
  }, [refreshQueue]);

  const runMutation = async (context: string, action: () => Promise<void>) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setMutationPending(true);
    clearPlayerError();
    try {
      await action();
      refreshQueue();
    } catch (cause) {
      refreshQueue();
      reportPlayerError(context, cause);
    } finally {
      mutationLock.current = false;
      setMutationPending(false);
    }
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12) },
      ]}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Queue</Text>
          <Text style={styles.count}>
            {queue.rows.length} {queue.rows.length === 1 ? 'track' : 'tracks'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close queue"
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>Done</Text>
        </Pressable>
      </View>

      {playerError && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss player error"
          onPress={clearPlayerError}
          style={styles.errorBanner}
        >
          <Text style={styles.errorText}>{playerError}</Text>
        </Pressable>
      )}

      {!loaded ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.emptyDetail}>Loading the native queue…</Text>
        </View>
      ) : (
        <FlatList
          data={queue.rows}
          keyExtractor={(row, index) => row.item.mediaId ?? `queue-item-${index}`}
          contentContainerStyle={queue.rows.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>Your queue is empty.</Text>
              <Text style={styles.emptyDetail}>Add a track from Search or Library.</Text>
            </View>
          }
          renderItem={({ item: row, index }) => {
            const active = index === queue.activeIndex;
            const first = index === 0;
            const last = index === queue.rows.length - 1;
            const canMoveUp = !active && !first && index - 1 !== queue.activeIndex;
            const canMoveDown = !active && !last && index + 1 !== queue.activeIndex;
            return (
              <View style={[styles.row, active && styles.activeRow]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${row.track.title} by ${row.track.artist}${active ? ', currently playing' : ''}`}
                  accessibilityHint={active ? undefined : 'Skip to this track'}
                  accessibilityState={{ selected: active, disabled: mutationPending }}
                  disabled={mutationPending}
                  style={styles.trackButton}
                  onPress={() =>
                    void runMutation(`Skipping to ${row.track.title} failed`, () =>
                      skipToQueueItem(index, expectedMediaIds),
                    )
                  }
                >
                  {row.track.cover ? (
                    <Image source={{ uri: row.track.cover }} style={styles.artwork} />
                  ) : (
                    <View style={[styles.artwork, styles.artworkPlaceholder]} />
                  )}
                  <View style={styles.metadata}>
                    <Text style={[styles.title, active && styles.activeText]} numberOfLines={1}>
                      {row.track.title}
                    </Text>
                    <Text style={styles.artist} numberOfLines={1}>
                      {row.track.artist}
                    </Text>
                    {active && <Text style={styles.playing}>PLAYING</Text>}
                  </View>
                </Pressable>

                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${row.track.title} up`}
                    accessibilityState={{ disabled: mutationPending || !canMoveUp }}
                    disabled={mutationPending || !canMoveUp}
                    hitSlop={6}
                    style={[
                      styles.actionButton,
                      (mutationPending || !canMoveUp) && styles.disabled,
                    ]}
                    onPress={() =>
                      void runMutation(`Moving ${row.track.title} up failed`, () =>
                        moveQueueItem(index, index - 1, expectedMediaIds),
                      )
                    }
                  >
                    <Text style={styles.actionText}>↑</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${row.track.title} down`}
                    accessibilityState={{ disabled: mutationPending || !canMoveDown }}
                    disabled={mutationPending || !canMoveDown}
                    hitSlop={6}
                    style={[
                      styles.actionButton,
                      (mutationPending || !canMoveDown) && styles.disabled,
                    ]}
                    onPress={() =>
                      void runMutation(`Moving ${row.track.title} down failed`, () =>
                        moveQueueItem(index, index + 1, expectedMediaIds),
                      )
                    }
                  >
                    <Text style={styles.actionText}>↓</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      active
                        ? `Cannot remove currently playing track ${row.track.title}`
                        : `Remove ${row.track.title} from queue`
                    }
                    accessibilityState={{ disabled: mutationPending || active }}
                    disabled={mutationPending || active}
                    hitSlop={6}
                    style={[styles.actionButton, (mutationPending || active) && styles.disabled]}
                    onPress={() =>
                      void runMutation(`Removing ${row.track.title} failed`, () =>
                        removeQueueItem(index, expectedMediaIds),
                      )
                    }
                  >
                    <Text style={styles.removeText}>×</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  heading: { color: colors.text, fontSize: 28, fontWeight: '800' },
  count: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  closeButton: { paddingVertical: 10, paddingLeft: 16 },
  closeText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surfaceAlt,
  },
  errorText: { color: colors.error, fontSize: 12, lineHeight: 17 },
  list: { paddingHorizontal: 12, paddingBottom: 16 },
  emptyList: { flexGrow: 1, paddingHorizontal: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyDetail: { color: colors.textDim, fontSize: 14, textAlign: 'center' },
  row: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  activeRow: { backgroundColor: colors.surface },
  trackButton: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  artwork: { width: 52, height: 52, borderRadius: 5, backgroundColor: colors.surfaceAlt },
  artworkPlaceholder: { borderWidth: 1, borderColor: colors.border },
  metadata: { flex: 1, minWidth: 0, marginLeft: 11 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  activeText: { color: colors.accent },
  artist: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  playing: { color: colors.accent, fontSize: 9, fontWeight: '800', marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', marginLeft: 4 },
  actionButton: { width: 31, height: 42, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: colors.textDim, fontSize: 18, fontWeight: '700' },
  removeText: { color: colors.error, fontSize: 23 },
  disabled: { opacity: 0.24 },
});
