import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { colors } from '../../theme';
import { searchListRowKey, type SearchListRow } from './searchListModel';

interface SearchVirtualizedResultsProps {
  accessibilityLabel: string;
  rows: readonly SearchListRow[];
  header: React.ReactElement | null;
  /** Space below the last row: `useBottomInset()` of the owning screen. */
  bottomInset: number;
  renderRow: (row: SearchListRow) => React.ReactElement | null;
}

/** The sole vertical scroll/virtualization owner for the ordinary search UI. */
export function SearchVirtualizedResults({
  accessibilityLabel,
  rows,
  header,
  bottomInset,
  renderRow,
}: SearchVirtualizedResultsProps) {
  return (
    <FlatList
      testID="search-results-list"
      accessibilityLabel={accessibilityLabel}
      data={[...rows]}
      keyExtractor={searchListRowKey}
      renderItem={({ item }) => renderRow(item)}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={9}
      removeClippedSubviews
      contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomInset }}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
});
