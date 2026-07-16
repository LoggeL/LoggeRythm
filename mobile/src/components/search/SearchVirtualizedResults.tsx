import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { colors } from '../../theme';
import { searchListRowKey, type SearchListRow } from './searchListModel';

interface SearchVirtualizedResultsProps {
  accessibilityLabel: string;
  rows: readonly SearchListRow[];
  header: React.ReactElement | null;
  renderRow: (row: SearchListRow) => React.ReactElement | null;
}

/** The sole vertical scroll/virtualization owner for the ordinary search UI. */
export function SearchVirtualizedResults({
  accessibilityLabel,
  rows,
  header,
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
      ListFooterComponent={<View style={styles.footer} />}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
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
  list: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1 },
  footer: { height: 132 },
});
