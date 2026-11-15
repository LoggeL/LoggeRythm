import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { strings } from '../../localization';
import {
  SEARCH_SORTS,
  SEARCH_TABS,
  type SearchSort,
  type SearchTab,
} from '../../screens/searchModel';
import { colors, layout, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, FilterChip } from '../ui';

interface SearchTabsProps {
  tab: SearchTab;
  onSelect: (tab: SearchTab) => void;
}

/** Result-type switcher. */
export function SearchTabs({ tab, onSelect }: SearchTabsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.chips}
      accessibilityRole="tablist"
    >
      {SEARCH_TABS.map((candidate) => (
        <FilterChip
          key={candidate}
          testID={`search-tab-${candidate}`}
          accessibilityRole="tab"
          label={strings.search.tabs[candidate]}
          selected={candidate === tab}
          onPress={() => onSelect(candidate)}
        />
      ))}
    </ScrollView>
  );
}

export function searchSortLabel(sort: SearchSort): string {
  switch (sort) {
    case 'relevance':
      return strings.search.sorts.relevance;
    case 'title':
      return strings.search.sorts.title;
    case 'dur-asc':
      return strings.search.sorts.durationAscending;
    case 'dur-desc':
      return strings.search.sorts.durationDescending;
  }
}

interface SearchSortControlsProps {
  sort: SearchSort;
  onSelect: (sort: SearchSort) => void;
}

/** Track ordering; one row, the label scrolls with the chips. */
export function SearchSortControls({ sort, onSelect }: SearchSortControlsProps) {
  return (
    <ScrollView
      testID="search-sort-controls"
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.chips}
    >
      <View style={styles.sortHeading}>
        <AppIcon name="sort" color={colors.textMuted} size={16} />
        <AppText variant="caption" color="muted">{strings.search.sortLabel}</AppText>
      </View>
      {SEARCH_SORTS.map((candidate) => (
        <FilterChip
          key={candidate}
          testID={`search-sort-${candidate}`}
          label={searchSortLabel(candidate)}
          selected={candidate === sort}
          onPress={() => onSelect(candidate)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: layout.pagePadding },
  sortHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
});
