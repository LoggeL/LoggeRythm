import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Genre } from '../../api/types';
import { colors, layout, radii, spacing } from '../../theme';
import { AppText, Artwork, PressableScale, Skeleton } from '../ui';

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
export function genreTileRows<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += COLUMNS) {
    rows.push(items.slice(start, start + COLUMNS));
  }
  return rows;
}

interface GenreTileProps {
  genre: Genre;
  index: number;
  testID: string;
  accessibilityLabel: string;
  onPress: () => void;
}

/** A tinted browse tile: genre name top-left, its picture tilted into the corner. */
export function GenreTile({ genre, index, testID, accessibilityLabel, onPress }: GenreTileProps) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={[styles.tile, { backgroundColor: genreTileTint(index) }]}
    >
      <AppText variant="bodyStrong" numberOfLines={2} style={styles.tileLabel}>
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
}

/** Two-column grid of genre tiles inside the page gutter. */
export function GenreTileGrid({
  genres,
  testID,
  tileTestID,
  tileAccessibilityLabel,
  onOpenGenre,
}: GenreTileGridProps) {
  return (
    <View testID={testID} style={styles.grid}>
      {genreTileRows(genres).map((row, rowIndex) => (
        <View key={row.map(({ id }) => id).join(':')} style={styles.gridRow}>
          {row.map((genre, column) => (
            <GenreTile
              key={genre.id}
              genre={genre}
              index={rowIndex * COLUMNS + column}
              testID={tileTestID(genre)}
              accessibilityLabel={tileAccessibilityLabel(genre)}
              onPress={() => onOpenGenre(genre)}
            />
          ))}
          {row.length < COLUMNS ? <View style={styles.gridSpacer} /> : null}
        </View>
      ))}
    </View>
  );
}

interface GenreTileGridSkeletonProps {
  testID: string;
  accessibilityLabel: string;
  rows?: number;
}

/** Placeholder with the exact tile geometry, so the grid does not jump in. */
export function GenreTileGridSkeleton({
  testID,
  accessibilityLabel,
  rows = 3,
}: GenreTileGridSkeletonProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={styles.grid}
    >
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} style={styles.gridRow}>
          <Skeleton height={TILE_HEIGHT} radius="card" style={styles.gridSpacer} />
          <Skeleton height={TILE_HEIGHT} radius="card" style={styles.gridSpacer} />
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
