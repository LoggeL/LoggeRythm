import React from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import type { Genre } from '../../api/types';
import { colors, layout, radii, spacing } from '../../theme';
import { AppText, Artwork, PressableScale, Skeleton, type TvFocusProps } from '../ui';

/** Tile tints, cycled by position so neighbours never share a colour. */
const TILE_TINTS = [
  colors.accentSubtle,
  colors.successSubtle,
  colors.warningSubtle,
  colors.dangerSubtle,
  colors.surfaceElevated,
] as const;

const TILE_HEIGHT = layout.artwork.lg;
const TILE_ARTWORK = layout.artwork.md + spacing.md;
const COLUMNS = 2;

export function genreTileTint(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Genre tile index must be a non-negative integer; received ${index}`);
  }
  return TILE_TINTS[index % TILE_TINTS.length];
}

/** Split a list into grid rows; the last row may be shorter. */
export function genreTileRows<T>(items: readonly T[], columns = COLUMNS): T[][] {
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error(`Genre tile columns must be a positive integer; received ${columns}`);
  }
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += columns) {
    rows.push(items.slice(start, start + columns));
  }
  return rows;
}

interface GenreTileProps extends TvFocusProps {
  genre: Genre;
  index: number;
  testID: string;
  accessibilityLabel: string;
  onPress: () => void;
  tileHeight?: number;
  titleStyle?: TextStyle;
}

/** A tinted browse tile: genre name top-left, its picture tilted into the corner. */
export function GenreTile({
  genre,
  index,
  testID,
  accessibilityLabel,
  onPress,
  tileHeight = TILE_HEIGHT,
  titleStyle,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused,
  focusedStyle,
}: GenreTileProps) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      focused={focused}
      focusedStyle={focusedStyle}
      onPress={onPress}
      style={[
        styles.tile,
        tileHeight !== TILE_HEIGHT ? { minHeight: tileHeight } : null,
        { backgroundColor: genreTileTint(index) },
      ]}
    >
      <AppText variant="bodyStrong" numberOfLines={2} style={[styles.tileLabel, titleStyle]}>
        {genre.name}
      </AppText>
      <Artwork uri={genre.picture} size={TILE_ARTWORK} radius="sm" style={styles.tileArtwork} />
    </PressableScale>
  );
}

interface GenreTileGridProps {
  genres: readonly Genre[];
  testID?: string;
  tileTestID: (genre: Genre) => string;
  tileAccessibilityLabel: (genre: Genre) => string;
  onOpenGenre: (genre: Genre) => void;
  /** Column count (2 on phone, 3–4 on 16:9 Android TV). */
  columns?: number;
  tileHeight?: number;
  paddingHorizontal?: number;
  gap?: number;
  titleStyle?: TextStyle;
  onTileFocus?: (focusKey: string) => void;
}

/** Multi-column grid of genre tiles inside the page gutter. */
export function GenreTileGrid({
  genres,
  testID,
  tileTestID,
  tileAccessibilityLabel,
  onOpenGenre,
  columns = COLUMNS,
  tileHeight = TILE_HEIGHT,
  paddingHorizontal,
  gap,
  titleStyle,
  onTileFocus,
}: GenreTileGridProps) {
  const gridStyle =
    paddingHorizontal === undefined && gap === undefined
      ? styles.grid
      : [
          styles.grid,
          paddingHorizontal !== undefined ? { paddingHorizontal } : null,
          gap !== undefined ? { gap } : null,
        ];
  const rowStyle = gap === undefined ? styles.gridRow : [styles.gridRow, { gap }];
  return (
    <View testID={testID} style={gridStyle}>
      {genreTileRows(genres, columns).map((row, rowIndex) => (
        <View key={row.map(({ id }) => id).join(':')} style={rowStyle}>
          {row.map((genre, column) => {
            const tileId = tileTestID(genre);
            return (
              <GenreTile
                key={genre.id}
                genre={genre}
                index={rowIndex * columns + column}
                testID={tileId}
                accessibilityLabel={tileAccessibilityLabel(genre)}
                tileHeight={tileHeight}
                titleStyle={titleStyle}
                onFocus={onTileFocus ? () => onTileFocus(tileId) : undefined}
                onPress={() => onOpenGenre(genre)}
              />
            );
          })}
          {Array.from({ length: columns - row.length }, (_, filler) => (
            <View key={`spacer-${filler}`} style={styles.gridSpacer} />
          ))}
        </View>
      ))}
    </View>
  );
}

interface GenreTileGridSkeletonProps {
  testID: string;
  accessibilityLabel: string;
  rows?: number;
  columns?: number;
  tileHeight?: number;
  paddingHorizontal?: number;
  gap?: number;
}

/** Placeholder with the exact tile geometry, so the grid does not jump in. */
export function GenreTileGridSkeleton({
  testID,
  accessibilityLabel,
  rows = 3,
  columns = COLUMNS,
  tileHeight = TILE_HEIGHT,
  paddingHorizontal,
  gap,
}: GenreTileGridSkeletonProps) {
  const gridStyle =
    paddingHorizontal === undefined && gap === undefined
      ? styles.grid
      : [
          styles.grid,
          paddingHorizontal !== undefined ? { paddingHorizontal } : null,
          gap !== undefined ? { gap } : null,
        ];
  const rowStyle = gap === undefined ? styles.gridRow : [styles.gridRow, { gap }];
  return (
    <View
      testID={testID}
      focusable={false}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={gridStyle}
    >
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} style={rowStyle}>
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} height={tileHeight} radius="card" style={styles.gridSpacer} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: layout.railGap, paddingHorizontal: layout.pagePadding },
  gridRow: { flexDirection: 'row', gap: layout.railGap },
  gridSpacer: { flex: 1 },
  tile: {
    flex: 1,
    minHeight: TILE_HEIGHT,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  tileLabel: { paddingRight: TILE_ARTWORK / 2 },
  tileArtwork: {
    position: 'absolute',
    right: -spacing.sm,
    bottom: -spacing.sm,
    transform: [{ rotate: '18deg' }],
  },
});
