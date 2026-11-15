import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { TrackPresentationState } from '../../player/trackPresentation';
import { colors, metrics, radii, spacing, typography } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, Artwork } from '../ui';

export interface TrackArtworkOverlayProps {
  cover: string | null | undefined;
  /** Artwork edge in dp (layout.artwork.*). */
  size: number;
  presentation: Pick<TrackPresentationState, 'active' | 'playback'>;
  /** 1-based position or chart rank, shown as a corner badge. */
  badge?: number;
  badgeTestID?: string;
  /** Accent badge for chart ranks; neutral for list positions. */
  badgeTone?: 'neutral' | 'accent';
}

/**
 * The cover of a track row or shelf card plus its playback affordance. An
 * idle track shows a small play badge (the artwork is the play target); the
 * active track is dimmed and shows its live transport state instead. Purely
 * decorative: the surrounding Pressable carries role, label and state.
 */
export function TrackArtworkOverlay({
  cover,
  size,
  presentation,
  badge,
  badgeTestID,
  badgeTone = 'neutral',
}: TrackArtworkOverlayProps) {
  const buffering = presentation.playback === 'buffering';
  const large = size > metrics.minimumTouchTarget;
  const glyph = large ? typography.title.fontSize : typography.section.fontSize;
  const badgeGlyph = large ? typography.section.fontSize : typography.caption.fontSize;
  const badgeEdge = large ? metrics.minimumTouchTarget - spacing.sm : typography.section.fontSize;
  return (
    <>
      <Artwork uri={cover} size={size} />
      {presentation.active ? (
        <View
          accessible={false}
          style={[styles.activeScrim, { borderRadius: large ? radii.card : radii.sm }]}
        >
          {buffering ? (
            <ActivityIndicator accessible={false} color={colors.accentSoft} size="small" />
          ) : (
            <AppIcon
              name={presentation.playback === 'playing' ? 'pause' : 'play'}
              color={colors.accentSoft}
              size={glyph}
            />
          )}
        </View>
      ) : (
        <View
          accessible={false}
          style={[
            styles.playBadge,
            large ? styles.playBadgeLarge : null,
            { width: badgeEdge, height: badgeEdge },
          ]}
        >
          <AppIcon name="play" color={colors.textPrimary} size={badgeGlyph} />
        </View>
      )}
      {badge === undefined ? null : (
        <AppText
          testID={badgeTestID}
          accessible={false}
          variant="micro"
          color={badgeTone === 'accent' ? 'onAccent' : 'primary'}
          align="center"
          style={[
            styles.badge,
            large ? styles.badgeLarge : null,
            badgeTone === 'accent' ? styles.badgeAccent : null,
          ]}
        >
          {badge}
        </AppText>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  activeScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
  playBadge: {
    position: 'absolute',
    right: spacing.xxs / 2,
    bottom: spacing.xxs / 2,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
  playBadgeLarge: { right: spacing.xs, bottom: spacing.xs },
  badge: {
    position: 'absolute',
    top: spacing.xxs / 2,
    left: spacing.xxs / 2,
    minWidth: typography.section.fontSize,
    paddingHorizontal: spacing.xxs,
    borderRadius: radii.xs,
    overflow: 'hidden',
    backgroundColor: colors.scrim,
  },
  badgeLarge: {
    top: spacing.xs,
    left: spacing.xs,
    minWidth: typography.title.fontSize,
    paddingVertical: spacing.xxs / 2,
    borderRadius: radii.pill,
  },
  badgeAccent: { backgroundColor: colors.accent },
});
