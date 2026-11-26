import React from 'react';
import { StyleSheet, View } from 'react-native';
import { strings } from '../../localization';
import { accountStrings } from '../../screens/accountStrings';
import { colors, layout, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, ScreenHeader } from '../ui';

export interface RadioHeroProps {
  /** The radio queue that is currently loaded, if any. `label` may be unknown. */
  onAir: { label: string | null; playing: boolean } | null;
}

const GLYPH = layout.artwork.md;
const HALO = layout.artwork.hero;

/**
 * RadioHero is the single hero of the radio screen: a tinted panel with an
 * accent halo (plain Views), the screen title, and — while a radio queue is
 * loaded — a live "on air" line naming the station.
 */
export function RadioHero({ onAir }: RadioHeroProps) {
  return (
    <View testID="radio-hero" style={styles.hero}>
      <View accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.halo} />
      <View accessible={false} style={styles.glyph}>
        <AppIcon name="radio" color={colors.onAccent} size={30} />
      </View>
      <ScreenHeader title={strings.radio.title} />
      {onAir !== null ? (
        <View
          testID="radio-on-air"
          accessibilityLiveRegion="polite"
          style={[styles.onAir, !onAir.playing ? styles.onAirPaused : null]}
        >
          <AppIcon
            name={onAir.playing ? 'equalizer' : 'pause'}
            color={onAir.playing ? colors.success : colors.textSecondary}
            size={18}
          />
          <AppText
            variant="label"
            color={onAir.playing ? 'success' : 'secondary'}
            numberOfLines={1}
            style={styles.onAirText}
          >
            {onAir.label === null
              ? accountStrings.radio.onAirUnnamed
              : onAir.playing
                ? accountStrings.radio.onAirStation(onAir.label)
                : `${strings.trackPresentation.paused}: ${onAir.label}`}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.sheet,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.accentSubtle,
    overflow: 'hidden',
  },
  halo: {
    position: 'absolute',
    top: -HALO / 2,
    right: -HALO / 3,
    width: HALO,
    height: HALO,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSolid,
    opacity: 0.28,
  },
  glyph: {
    width: GLYPH,
    height: GLYPH,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  onAir: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.successSubtle,
  },
  onAirPaused: {
    backgroundColor: colors.fill,
  },
  onAirText: { flexShrink: 1 },
});
