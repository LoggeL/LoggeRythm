import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { libraryStrings } from '../../screens/libraryStrings';
import { layout, spacing } from '../../theme';
import { FilterChip } from '../ui';
import { LIBRARY_FILTER_ORDER, type LibraryFilter } from './LibraryVirtualizedList';

export interface LibraryFilterBarProps {
  filter: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
}

/** Chip labels are read at render time so they follow a locale switch. */
export function libraryFilterLabel(filter: LibraryFilter): string {
  switch (filter) {
    case 'all':
      return libraryStrings.library.filterAll;
    case 'playlists':
      return libraryStrings.library.playlists;
    case 'liked':
      return libraryStrings.library.likedTracks;
    case 'recent':
      return libraryStrings.library.recentlyHeard;
    case 'downloads':
      return libraryStrings.library.downloads;
    case 'following':
      return libraryStrings.library.artists;
  }
}

/** Full-bleed section switcher: "All" is the overview, every other chip focuses one section. */
export function LibraryFilterBar({ filter, onChange }: LibraryFilterBarProps) {
  return (
    <ScrollView
      testID="library-filters"
      horizontal
      accessibilityRole="tablist"
      accessibilityLabel={libraryStrings.library.filters}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      {LIBRARY_FILTER_ORDER.map((id) => (
        <FilterChip
          key={id}
          testID={`library-filter-${id}`}
          label={libraryFilterLabel(id)}
          accessibilityRole="tab"
          selected={filter === id}
          onPress={() => onChange(id)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xs, paddingHorizontal: layout.pagePadding },
});
