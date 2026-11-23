import React, { useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';
import type { Track } from '../../api/types';
import { useBottomInset } from '../../hooks/useBottomInset';
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
  header: React.ReactElement | null;
  footer?: React.ReactElement | null;
  empty?: React.ReactElement | null;
  refreshing: boolean;
  refreshAccessibilityLabel: string;
  onRefresh: () => void;
  renderTrack: (track: Track, index: number) => React.ReactElement;
  /** Optional bottom padding override (e.g. TV overscan inset). */
  contentPaddingBottom?: number;
}

/** The detail page's only vertical scroll owner. Its content clears the mini player. */
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
  contentPaddingBottom,
}: CatalogTrackListProps) {
  const bottom = useBottomInset();
  const occurrences = useMemo(() => catalogTrackOccurrences(tracks), [tracks]);
  const renderListItem = useCallback(
    ({ item }: { item: CatalogTrackOccurrence }) => renderTrack(item.track, item.index),
    [renderTrack],
  );
  const paddingBottom = contentPaddingBottom ?? bottom;
  const contentContainerStyle = useMemo(
    () => ({ paddingBottom }),
    [paddingBottom],
  );
  return (
    <FlatList
      testID={`${id}-scroll`}
      data={occurrences}
      keyExtractor={catalogTrackOccurrenceKey}
      renderItem={renderListItem}
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
      // Keep false on RN 0.86 Fabric: clipping detaches updated/active track cells into blank gaps.
      removeClippedSubviews={false}
      contentContainerStyle={contentContainerStyle}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
});
