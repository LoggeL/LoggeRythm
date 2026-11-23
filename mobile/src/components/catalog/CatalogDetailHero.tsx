import React from 'react';
import { StyleSheet, View } from 'react-native';
import { layout, spacing } from '../../theme';
import { AppText, IconButton, PlayButton } from '../ui';

export interface CatalogHeroPlayAction {
  testID: string;
  accessibilityLabel: string;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  onPress: () => void;
}

interface CatalogDetailHeroProps {
  /** The cover: `CatalogHeroArtwork` or an `Artwork`. */
  artwork: React.ReactNode;
  /**
   * With `title`: supporting copy under it (byline, meta line).
   * Without `title` (legacy row layout): the whole identity block.
   */
  children?: React.ReactNode;
  /** Secondary actions. In the stacked layout they sit left of the play/shuffle controls. */
  actions?: React.ReactNode;
  /** Uppercase type label above the title ("ALBUM"). */
  eyebrow?: string;
  eyebrowTestID?: string;
  /** Setting a title switches to the stacked hero: large cover, then identity, then actions. */
  title?: string;
  titleTestID?: string;
  /** Optional shuffle control rendered directly beside PlayButton (web album/artist parity). */
  shuffle?: CatalogHeroPlayAction;
  /** The one loud control of the page. */
  play?: CatalogHeroPlayAction;
  /** Centre the identity under the cover (artists). Stacked layout only. */
  centered?: boolean;
}

/**
 * The shared hero of every catalog detail page. The stacked layout (pass
 * `title`) is the standard: one large cover as the page's hero element, an
 * eyebrow, the title, supporting copy and a single action row that ends in
 * optional Shuffle + the PlayButton. Without `title` it keeps the legacy
 * compact row (cover beside caller-supplied copy) for callers that have not
 * migrated yet.
 */
export function CatalogDetailHero({
  artwork,
  children,
  actions,
  eyebrow,
  eyebrowTestID,
  title,
  titleTestID,
  shuffle,
  play,
  centered = false,
}: CatalogDetailHeroProps) {
  if (title === undefined) {
    return (
      <View style={styles.hero}>
        <View style={styles.identityRow}>
          <View style={styles.rowArtwork}>{artwork}</View>
          <View style={styles.rowCopy}>{children}</View>
        </View>
        {actions ? <View style={styles.legacyActions}>{actions}</View> : null}
      </View>
    );
  }
  const align = centered ? 'center' : undefined;
  return (
    <View style={styles.hero}>
      <View style={styles.stackedArtwork}>{artwork}</View>
      <View style={[styles.copy, centered ? styles.copyCentered : null]}>
        {eyebrow === undefined ? null : (
          <AppText testID={eyebrowTestID} variant="overline" color="accent" align={align}>
            {eyebrow}
          </AppText>
        )}
        <AppText
          testID={titleTestID}
          accessibilityRole="header"
          variant="hero"
          align={align}
          numberOfLines={3}
        >
          {title}
        </AppText>
        {children}
      </View>
      {actions || shuffle || play ? (
        <View style={styles.actionRow}>
          <View style={styles.secondaryActions}>{actions}</View>
          {shuffle ? (
            <IconButton
              testID={shuffle.testID}
              icon="shuffle-variant"
              variant="tonal"
              accessibilityLabel={shuffle.accessibilityLabel}
              disabled={shuffle.disabled}
              onPress={shuffle.onPress}
            />
          ) : null}
          {play ? (
            <PlayButton
              testID={play.testID}
              size="lg"
              accessibilityLabel={play.accessibilityLabel}
              disabled={play.disabled}
              hasTVPreferredFocus={play.hasTVPreferredFocus}
              onPress={play.onPress}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: layout.stackGap, paddingHorizontal: layout.pagePadding },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowArtwork: { flexShrink: 0 },
  rowCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  legacyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stackedArtwork: { alignItems: 'center' },
  copy: { gap: spacing.xxs },
  copyCentered: { alignItems: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  secondaryActions: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
