import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { layout } from '../../theme';

interface HorizontalShelfProps<T> {
  id: string;
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactElement;
  /** Optional TV horizontal edge padding override (defaults to `layout.pagePadding`). */
  paddingHorizontal?: number;
  /** Optional TV card gap override (defaults to `layout.railGap`). */
  gap?: number;
}

/** The full-bleed horizontal card rail of a Home section. */
export function HorizontalShelf<T>({
  id,
  data,
  keyExtractor,
  renderItem,
  paddingHorizontal,
  gap,
}: HorizontalShelfProps<T>) {
  const containerStyle =
    paddingHorizontal === undefined && gap === undefined
      ? styles.rail
      : [
          styles.rail,
          paddingHorizontal !== undefined ? { paddingHorizontal } : null,
          gap !== undefined ? { gap } : null,
        ];
  return (
    <FlatList
      testID={`home-shelf-${id}`}
      horizontal
      data={data}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => renderItem(item, index)}
      showsHorizontalScrollIndicator={false}
      initialNumToRender={4}
      maxToRenderPerBatch={6}
      windowSize={5}
      removeClippedSubviews={false}
      contentContainerStyle={containerStyle}
    />
  );
}

const styles = StyleSheet.create({
  rail: { gap: layout.railGap, paddingHorizontal: layout.pagePadding },
});
