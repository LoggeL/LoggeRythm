import React from 'react';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';
import type { Track } from '../../api/types';
import { colors } from '../../theme';

export interface CatalogTrackOccurrence {
  track: Track;
  index: number;
  key: string;
}

/**
 * Keep duplicate backend rows distinct without changing their ordered playback index.
 * The response position is the only stable identity for repeated occurrences of one track id.
 */
export function catalogTrackOccurrences(
  tracks: readonly Track[],
): CatalogTrackOccurrence[] {
  return tracks.map((track, index) => ({
    track,
    index,
    key: `${String(track.id)}:${index}`,
  }));
}

export function catalogTrackOccurrenceKey(item: CatalogTrackOccurrence): string {
  return item.key;
}

export interface CatalogTrackListProps {
  id: string;
  tracks: readonly Track[];
  header: React.ReactElement;
  footer?: React.ReactElement | null;
  empty?: React.ReactElement | null;
  refreshing: boolean;
  refreshAccessibilityLabel: string;
  onRefresh: () => void;
  renderTrack: (track: Track, index: number) => React.ReactElement;
}

/** The detail page's only vertical scroll owner. */
export function CatalogTrackList({
  id,
  tracks,
  header,
  footer = null,
  empty = null,
  refreshing,
  refreshAccessibilityLabel,
  onRefresh,
  renderTrack,
}: CatalogTrackListProps) {
  return (
    <FlatList
      testID={`${id}-scroll`}
      data={catalogTrackOccurrences(tracks)}
      keyExtractor={catalogTrackOccurrenceKey}
      renderItem={({ item }) => renderTrack(item.track, item.index)}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={empty}
      refreshControl={
        <RefreshControl
          testID={`${id}-refresh`}
          refreshing={refreshing}
          onRefresh={onRefresh}
          accessibilityLabel={refreshAccessibilityLabel}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.surfaceElevated}
        />
      }
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={9}
      removeClippedSubviews
      contentContainerStyle={styles.content}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingBottom: 144 },
});
