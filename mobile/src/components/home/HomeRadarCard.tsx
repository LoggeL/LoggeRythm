import React from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import type { HomeShelf } from '../../api/types';
import { strings } from '../../localization';
import { colors, layout, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, Artwork, PressableScale, Skeleton, type TvFocusProps } from '../ui';
import type { HomeSectionSkeletonProps } from './HomeSection';

const ARTWORK_SIZE = layout.artwork.lg;
const CARD_PADDING = spacing.sm;
const CARD_HEIGHT = ARTWORK_SIZE + CARD_PADDING * 2;

interface HomeRadarCardProps extends TvFocusProps {
  shelf: HomeShelf;
  testID: string;
  /** Localized "3 new" text; shown as a badge and appended to the announcement. */
  statusBadge?: string;
  onPress: () => void;
  /** Optional TV horizontal gutter override. */
  marginHorizontal?: number;
  subtitleStyle?: TextStyle;
  countStyle?: TextStyle;
}

/**
 * The Release Radar entry: one full-width banner instead of a one-card rail.
 * Unseen releases tint the banner and add the accent badge; the banner stays
 * a link into the radar either way.
 */
export function HomeRadarCard({
  shelf,
  testID,
  statusBadge,
  onPress,
  marginHorizontal,
  subtitleStyle,
  countStyle,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused,
  focusedStyle,
}: HomeRadarCardProps) {
  const cover = shelf.cover || shelf.tracks.find((track) => track.cover)?.cover;
  const label = strings.home.openShelf(shelf.title, shelf.tracks.length);
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={statusBadge ? `${label}. ${statusBadge}` : label}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      focused={focused}
      focusedStyle={focusedStyle}
      onPress={onPress}
      scaleTo={0.98}
      style={[
        styles.card,
        marginHorizontal !== undefined ? { marginHorizontal } : null,
        statusBadge ? styles.cardUnseen : null,
      ]}
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
        <AppText variant="callout" color="secondary" numberOfLines={2} style={subtitleStyle}>
          {shelf.subtitle}
        </AppText>
        <AppText variant="caption" color="muted" numberOfLines={1} style={countStyle}>
          {strings.common.trackCount(shelf.tracks.length)}
        </AppText>
      </View>
      <AppIcon name="chevron-right" color={colors.textSecondary} size={24} />
    </PressableScale>
  );
}

export const MemoHomeRadarCard = React.memo(HomeRadarCard);

/** Loading placeholder with the banner's footprint. */
export function HomeRadarCardSkeleton({
  testID,
  accessibilityLabel,
  paddingHorizontal,
}: HomeSectionSkeletonProps & { paddingHorizontal?: number }) {
  return (
    <View
      testID={testID}
      focusable={false}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={
        paddingHorizontal === undefined
          ? styles.skeleton
          : [styles.skeleton, { paddingHorizontal }]
      }
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
