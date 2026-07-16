import React from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import type { Track } from '../../api/types';
import {
  artistTrackListItemKey,
  createArtistTrackListSections,
  type ArtistTrackListItem,
} from '../../screens/artistTrackListModel';
import { colors } from '../../theme';

export interface ArtistVirtualizedListProps {
  artistName: string;
  popularTracks: readonly Track[];
  searchTracks: readonly Track[];
  searchActive: boolean;
  refreshing: boolean;
  refreshAccessibilityLabel: string;
  onRefresh: () => void;
  header: React.ReactElement;
  popularHeader: React.ReactElement;
  searchHeader: React.ReactElement;
  footer: React.ReactElement;
  renderTrackItem: (item: ArtistTrackListItem) => React.ReactElement;
}

/** The Artist page's only vertical scroll owner. */
export function ArtistVirtualizedList({
  artistName,
  popularTracks,
  searchTracks,
  searchActive,
  refreshing,
  refreshAccessibilityLabel,
  onRefresh,
  header,
  popularHeader,
  searchHeader,
  footer,
  renderTrackItem,
}: ArtistVirtualizedListProps) {
  const sections = createArtistTrackListSections({
    popularTracks,
    searchTracks,
    searchActive,
  });

  return (
    <SectionList
      testID="artist-scroll"
      accessibilityLabel={artistName}
      sections={sections}
      keyExtractor={artistTrackListItemKey}
      renderItem={({ item }) => renderTrackItem(item)}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          {section.id === 'popular' ? popularHeader : searchHeader}
        </View>
      )}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      refreshControl={
        <RefreshControl
          testID="artist-refresh"
          refreshing={refreshing}
          onRefresh={onRefresh}
          accessibilityLabel={refreshAccessibilityLabel}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.surfaceElevated}
        />
      }
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={9}
      contentContainerStyle={styles.content}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 22, paddingBottom: 144 },
  sectionHeader: { paddingTop: 28 },
});
