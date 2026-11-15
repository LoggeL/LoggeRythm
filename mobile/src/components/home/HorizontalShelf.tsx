import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { layout } from '../../theme';

interface HorizontalShelfProps<T> {
  id: string;
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactElement;
}

/** The full-bleed horizontal card rail of a Home section. */
export function HorizontalShelf<T>({ id, data, keyExtractor, renderItem }: HorizontalShelfProps<T>) {
  return (
    <FlatList
      testID={`home-shelf-${id}`}
      horizontal
      data={[...data]}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => renderItem(item, index)}
      showsHorizontalScrollIndicator={false}
      initialNumToRender={4}
      contentContainerStyle={styles.rail}
    />
  );
}

const styles = StyleSheet.create({
  rail: { gap: layout.railGap, paddingHorizontal: layout.pagePadding },
});
