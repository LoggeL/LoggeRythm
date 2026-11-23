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
  paddingHorizontal?: number;
  onChipFocus?: (focusKey: string) => void;
}

/** Result-type switcher. */
export function SearchTabs({
  tab,
  onSelect,
  paddingHorizontal,
  onChipFocus,
}: SearchTabsProps) {
  const containerStyle =
    paddingHorizontal === undefined
      ? styles.chips
      : [styles.chips, { paddingHorizontal }];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={containerStyle}
      accessibilityRole="tablist"
    >
      {SEARCH_TABS.map((candidate) => {
        const chipTestId = `search-tab-${candidate}`;
        return (
          <FilterChip
            key={candidate}
            testID={chipTestId}
            accessibilityRole="tab"
            label={strings.search.tabs[candidate]}
            selected={candidate === tab}
            onFocus={onChipFocus ? () => onChipFocus(chipTestId) : undefined}
            onPress={() => onSelect(candidate)}
          />
        );
      })}
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
  paddingHorizontal?: number;
  onChipFocus?: (focusKey: string) => void;
}

/** Track ordering; one row, the label scrolls with the chips. */
export function SearchSortControls({
  sort,
  onSelect,
  paddingHorizontal,
  onChipFocus,
}: SearchSortControlsProps) {
  const containerStyle =
    paddingHorizontal === undefined
      ? styles.chips
      : [styles.chips, { paddingHorizontal }];
  return (
    <ScrollView
      testID="search-sort-controls"
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={containerStyle}
    >
      <View style={styles.sortHeading}>
        <AppIcon name="sort" color={colors.textMuted} size={16} />
        <AppText variant="caption" color="muted">{strings.search.sortLabel}</AppText>
      </View>
      {SEARCH_SORTS.map((candidate) => {
        const chipTestId = `search-sort-${candidate}`;
        return (
          <FilterChip
            key={candidate}
            testID={chipTestId}
            label={searchSortLabel(candidate)}
            selected={candidate === sort}
            onFocus={onChipFocus ? () => onChipFocus(chipTestId) : undefined}
            onPress={() => onSelect(candidate)}
          />
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: layout.pagePadding },
  sortHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
});
