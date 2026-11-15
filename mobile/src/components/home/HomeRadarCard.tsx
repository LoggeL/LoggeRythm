import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { HomeShelf } from '../../api/types';
import { strings } from '../../localization';
import { colors, layout, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, Artwork, PressableScale, Skeleton } from '../ui';
import type { HomeSectionSkeletonProps } from './HomeSection';

const ARTWORK_SIZE = layout.artwork.lg;
const CARD_PADDING = spacing.sm;
const CARD_HEIGHT = ARTWORK_SIZE + CARD_PADDING * 2;

interface HomeRadarCardProps {
  shelf: HomeShelf;
  testID: string;
  /** Localized "3 new" text; shown as a badge and appended to the announcement. */
  statusBadge?: string;
  onPress: () => void;
}

/**
 * The Release Radar entry: one full-width banner instead of a one-card rail.
 * Unseen releases tint the banner and add the accent badge; the banner stays
 * a link into the radar either way.
 */
export function HomeRadarCard({ shelf, testID, statusBadge, onPress }: HomeRadarCardProps) {
  const cover = shelf.cover || shelf.tracks.find((track) => track.cover)?.cover;
  const label = strings.home.openShelf(shelf.title, shelf.tracks.length);
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={statusBadge ? `${label}. ${statusBadge}` : label}
      onPress={onPress}
      scaleTo={0.98}
      style={[styles.card, statusBadge ? styles.cardUnseen : null]}
    >
      <Artwork uri={cover} size={ARTWORK_SIZE} icon="radar" />
      <View style={styles.copy}>
        {statusBadge ? (
          <View style={styles.badge}>
            <AppText testID={`${testID}-status`} variant="micro" color="onAccent">
              {statusBadge}
            </AppText>
          </View>
        ) : null}
        <AppText variant="callout" color="secondary" numberOfLines={2}>
          {shelf.subtitle}
        </AppText>
        <AppText variant="caption" color="muted" numberOfLines={1}>
          {strings.common.trackCount(shelf.tracks.length)}
        </AppText>
      </View>
      <AppIcon name="chevron-right" color={colors.textSecondary} size={24} />
    </PressableScale>
  );
}

/** Loading placeholder with the banner's footprint. */
export function HomeRadarCardSkeleton({ testID, accessibilityLabel }: HomeSectionSkeletonProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={styles.skeleton}
    >
      <Skeleton height={CARD_HEIGHT} radius="panel" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: CARD_HEIGHT,
    marginHorizontal: layout.pagePadding,
    padding: CARD_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  cardUnseen: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs / 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  skeleton: { paddingHorizontal: layout.pagePadding },
});
