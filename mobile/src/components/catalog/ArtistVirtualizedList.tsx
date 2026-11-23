import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
  type ArtistTrackListSection,
  type ArtistTrackSectionId,
} from '../../screens/artistTrackListModel';
import { useBottomInset } from '../../hooks/useBottomInset';
import { useReducedMotion } from '../../hooks/useReducedMotion';
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
  header: React.ReactElement | null;
  /** Heading and remote state of the liked block. Only rendered while `liked` is not null. */
  likedHeader: React.ReactElement;
  popularHeader: React.ReactElement;
  searchHeader: React.ReactElement;
  footer: React.ReactElement;
  renderTrackItem: (item: ArtistTrackListItem) => React.ReactElement;
  /** Optional bottom padding override (e.g. TV overscan inset). */
  contentPaddingBottom?: number;
  /** Optional imperative jump callback registered with reduced-motion support. */
  onRegisterJumpToSection?: (jump: (sectionId: ArtistTrackSectionId) => void) => void;
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
  contentPaddingBottom,
  onRegisterJumpToSection,
}: ArtistVirtualizedListProps) {
  const bottom = useBottomInset();
  const reducedMotion = useReducedMotion();
  const listRef = useRef<SectionList<ArtistTrackListItem, ArtistTrackListSection>>(null);
  const sectionHeaders = useMemo<Record<ArtistTrackSectionId, React.ReactElement>>(
    () => ({
      liked: likedHeader,
      popular: popularHeader,
      search: searchHeader,
    }),
    [likedHeader, popularHeader, searchHeader],
  );
  const likedTracks = liked?.tracks ?? null;
  const likedExpanded = liked?.expanded ?? false;
  const sections = useMemo(
    () =>
      createArtistTrackListSections({
        liked: likedTracks === null ? null : { tracks: likedTracks, expanded: likedExpanded },
        popularTracks,
        searchTracks,
        searchActive,
      }),
    [likedTracks, likedExpanded, popularTracks, searchTracks, searchActive],
  );

  const jumpToSection = useCallback(
    (sectionId: ArtistTrackSectionId) => {
      const sectionIndex = sections.findIndex((section) => section.id === sectionId);
      if (sectionIndex < 0) return;
      listRef.current?.scrollToLocation({
        sectionIndex,
        itemIndex: 0,
        animated: !reducedMotion,
      });
    },
    [reducedMotion, sections],
  );
  useEffect(() => {
    onRegisterJumpToSection?.(jumpToSection);
  }, [jumpToSection, onRegisterJumpToSection]);

  const renderItem = useCallback(
    ({ item }: { item: ArtistTrackListItem }) => renderTrackItem(item),
    [renderTrackItem],
  );
  const renderSectionHeader = useCallback(
    ({ section }: { section: ArtistTrackListSection }) => (
      <View style={styles.sectionHeader}>{sectionHeaders[section.id]}</View>
    ),
    [sectionHeaders],
  );
  const paddingBottom = contentPaddingBottom ?? bottom;
  const contentContainerStyle = useMemo(
    () => [styles.content, { paddingBottom }],
    [paddingBottom],
  );

  return (
    <SectionList
      ref={listRef}
      testID="artist-scroll"
      accessibilityLabel={artistName}
      sections={sections}
      keyExtractor={artistTrackListItemKey}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
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
      removeClippedSubviews={false}
      contentContainerStyle={contentContainerStyle}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md },
  sectionHeader: { paddingTop: layout.sectionGap, paddingBottom: spacing.xs },
});
