import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type { ResolveResult } from '../../api/types';
import type { TrackOccurrenceTarget } from '../track/StandardTrackRow';
import {
  spotifyImportListRowKey,
  type SpotifyImportListRow,
} from './spotifyImportListModel';

interface SpotifyImportVirtualizedListProps {
  accessibilityLabel: string;
  rows: readonly SpotifyImportListRow[];
  header: React.ReactElement;
  renderRow: (info: { item: SpotifyImportListRow }) => React.ReactElement | null;
}

export function spotifyImportContextId(
  link: string,
  result: Pick<ResolveResult, 'type' | 'name'>,
): string {
  const sourceId = new URL(link).pathname.split('/').filter(Boolean).at(-1) ?? result.name.trim();
  if (sourceId.length === 0) throw new Error('Spotify import context requires a source identity');
  return `spotify:${result.type}:${sourceId}`;
}

/** Keep row state identity exactly aligned with the finite import queue. */
export function spotifyImportTrackOccurrence(
  link: string,
  result: Pick<ResolveResult, 'type' | 'name'>,
  index: number,
): TrackOccurrenceTarget {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Spotify import occurrence index must be non-negative; received ${index}`);
  }
  return {
    queueContext: { type: 'collection', id: spotifyImportContextId(link, result) },
    originalContextOrder: index,
  };
}

/** The sole vertical owner for a resolved external-import workflow. */
export function SpotifyImportVirtualizedList({
  accessibilityLabel,
  rows,
  header,
  renderRow,
}: SpotifyImportVirtualizedListProps) {
  return (
    <FlatList
      testID="spotify-import-results-list"
      accessibilityLabel={accessibilityLabel}
      data={[...rows]}
      keyExtractor={spotifyImportListRowKey}
      renderItem={renderRow}
      ListHeaderComponent={header}
      ListFooterComponent={<View style={styles.footer} />}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={9}
      removeClippedSubviews
      style={styles.list}
      contentContainerStyle={styles.content}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { flexGrow: 1 },
  footer: { height: 24 },
});
