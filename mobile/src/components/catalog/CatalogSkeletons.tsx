import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, layout, spacing, typography } from '../../theme';
import { DetailHeroSkeleton, Skeleton } from '../ui';

export interface CatalogPageSkeletonProps {
  testID: string;
  /** Localized loading label announced for the whole page. */
  accessibilityLabel: string;
  /** Round hero artwork for artist pages. */
  round?: boolean;
  /** Compact horizontal hero matching GenreScreen. */
  compact?: boolean;
  /** Number of placeholder track rows under the hero. */
  rows?: number;
}

/**
 * The first-load placeholder of a detail page, shaped like the page it
 * replaces (hero artwork, eyebrow, title, meta line, 64dp action row, track
 * rows) so nothing jumps when the data arrives. The group is one polite
 * `progressbar`.
 */
export function CatalogPageSkeleton({
  testID,
  accessibilityLabel,
  round = false,
  compact = false,
  rows = 5,
}: CatalogPageSkeletonProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={styles.page}
    >
      <DetailHeroSkeleton
        testID={`${testID}-hero`}
        round={round}
        compact={compact}
        includeActionRow
      />
      <View>
        {Array.from({ length: rows }, (_, index) => (
          <View key={index} style={styles.row}>
            <Skeleton width={layout.artwork.sm} height={layout.artwork.sm} />
            <View style={styles.rowCopy}>
              <Skeleton
                width={index % 2 === 0 ? '68%' : '52%'}
                height={typography.callout.fontSize}
              />
              <Skeleton
                width={index % 2 === 0 ? '40%' : '46%'}
                height={typography.caption.fontSize}
              />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface CatalogBlockSkeletonProps {
  testID: string;
  accessibilityLabel: string;
  /** text = a paragraph, pill = one button-sized control. */
  shape: 'text' | 'pill';
  padded?: boolean;
}

/** Placeholder for embedded, non-list content: a paragraph or a single control. */
export function CatalogBlockSkeleton({
  testID,
  accessibilityLabel,
  shape,
  padded = true,
}: CatalogBlockSkeletonProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[styles.block, padded ? styles.gutter : null]}
    >
      {shape === 'pill' ? (
        <Skeleton width={PILL_WIDTH} height={layout.artwork.sm} radius="pill" />
      ) : (
        <>
          <Skeleton width="100%" height={typography.callout.fontSize} />
          <Skeleton width="92%" height={typography.callout.fontSize} />
          <Skeleton width="60%" height={typography.callout.fontSize} />
        </>
      )}
    </View>
  );
}

/** About the width of a labelled secondary ActionButton. */
const PILL_WIDTH = layout.artwork.lg + spacing.xl;

const styles = StyleSheet.create({
  page: {
    flex: 1,
    gap: layout.sectionGap,
    paddingTop: spacing.md,
    paddingHorizontal: layout.pagePadding,
    backgroundColor: colors.background,
  },
  row: {
    height: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowCopy: { flex: 1, gap: spacing.xs },
  block: { gap: spacing.xs },
  gutter: { paddingHorizontal: layout.pagePadding },
});
