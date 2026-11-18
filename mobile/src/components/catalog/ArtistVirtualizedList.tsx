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
  type ArtistLikedTrackCollection,
  type ArtistTrackListItem,
  type ArtistTrackSectionId,
} from '../../screens/artistTrackListModel';
import { useBottomInset } from '../../hooks/useBottomInset';
import { colors, layout, spacing } from '../../theme';

export interface ArtistVirtualizedListProps {
  artistName: string;
  /** The user's liked tracks by this artist, or null while the page has no such block. */
  liked: ArtistLikedTrackCollection | null;
  popularTracks: readonly Track[];
  searchTracks: readonly Track[];
  searchActive: boolean;
  refreshing: boolean;
  refreshAccessibilityLabel: string;
  onRefresh: () => void;
  header: React.ReactElement;
  /** Heading and remote state of the liked block. Only rendered while `liked` is not null. */
  likedHeader: React.ReactElement;
  popularHeader: React.ReactElement;
  searchHeader: React.ReactElement;
  footer: React.ReactElement;
  renderTrackItem: (item: ArtistTrackListItem) => React.ReactElement;
}

/** The Artist page's only vertical scroll owner. Its content clears the mini player. */
export function ArtistVirtualizedList({
  artistName,
  liked,
  popularTracks,
  searchTracks,
  searchActive,
  refreshing,
  refreshAccessibilityLabel,
  onRefresh,
  header,
  likedHeader,
  popularHeader,
  searchHeader,
  footer,
  renderTrackItem,
}: ArtistVirtualizedListProps) {
  const bottom = useBottomInset();
  const sectionHeaders: Record<ArtistTrackSectionId, React.ReactElement> = {
    liked: likedHeader,
    popular: popularHeader,
    search: searchHeader,
  };
  const sections = createArtistTrackListSections({
    liked,
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
          {sectionHeaders[section.id]}
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
      contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md },
  sectionHeader: { paddingTop: layout.sectionGap, paddingBottom: spacing.xs },
});
