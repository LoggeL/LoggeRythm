import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { strings } from '../../localization';
import { accountStrings } from '../../screens/accountStrings';
import { colors, elevation, layout, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, Artwork, PressableScale } from '../ui';
import { RADIO_PLAY_DISC, RADIO_TILE_WIDTH, RADIO_WIDE_HEIGHT, RADIO_WIDE_WIDTH } from './radioLayout';

export interface RadioStationCardProps {
  testID: string;
  title: string;
  subtitle: string;
  cover: string;
  /** personal / genre render a square tile, mood a wide horizontal card. */
  variant: 'personal' | 'mood' | 'genre';
  /** This station is being started. */
  busy: boolean;
  /** Another station is being started. */
  blocked: boolean;
  /** This station is the source of the current queue. */
  onAir?: boolean;
  onPress: () => void;
}

function PlayDisc({ busy, onAir }: { busy: boolean; onAir: boolean }) {
  return (
    <View style={[styles.disc, onAir ? styles.discOnAir : null]}>
      {busy ? (
        <ActivityIndicator accessible={false} color={colors.onAccent} size="small" />
      ) : (
        <AppIcon name={onAir ? 'equalizer' : 'play'} color={colors.onAccent} size={22} />
      )}
    </View>
  );
}

/**
 * RadioStationCard is one startable station: artwork, the RADIO eyebrow,
 * title, subtitle and a play disc that turns into a spinner while the
 * station starts and into an equalizer while it is on air. The whole card is
 * a single button named "start <title>"; the disc is decoration.
 */
export function RadioStationCard({
  testID,
  title,
  subtitle,
  cover,
  variant,
  busy,
  blocked,
  onAir = false,
  onPress,
}: RadioStationCardProps) {
  const wide = variant === 'mood';
  const badge = (
    <AppText variant="overline" color={onAir ? 'success' : 'accent'} numberOfLines={1}>
      {onAir ? accountStrings.radio.onAir : strings.radio.badge}
    </AppText>
  );
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strings.radio.startStation(title)}
      accessibilityHint={onAir ? accountStrings.radio.stationOnAir(title) : undefined}
      accessibilityState={{ disabled: blocked || busy, busy, selected: onAir }}
      disabled={blocked}
      onPress={busy ? undefined : onPress}
      style={[wide ? styles.wide : styles.tile, onAir ? styles.onAir : null]}
    >
      {wide ? (
        <>
          <Artwork uri={cover} size={layout.artwork.lg} icon="radio" />
          <View style={styles.wideCopy}>
            {badge}
            <AppText variant="bodyStrong" numberOfLines={2}>{title}</AppText>
            <AppText variant="callout" color="secondary" numberOfLines={2}>{subtitle}</AppText>
          </View>
          <PlayDisc busy={busy} onAir={onAir} />
        </>
      ) : (
        <>
          <View>
            <Artwork uri={cover} size={RADIO_TILE_WIDTH} icon={variant === 'genre' ? 'radio-tower' : 'radio'} />
            <View style={styles.tileDisc}>
              <PlayDisc busy={busy} onAir={onAir} />
            </View>
          </View>
          <View style={styles.tileCopy}>
            {badge}
            <AppText variant="bodyStrong" numberOfLines={1}>{title}</AppText>
            <AppText variant="callout" color="secondary" numberOfLines={1}>{subtitle}</AppText>
          </View>
        </>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: { width: RADIO_TILE_WIDTH, gap: spacing.xs },
  tileDisc: { position: 'absolute', right: spacing.xs, bottom: spacing.xs },
  tileCopy: { gap: spacing.xxs / 2 },
  wide: {
    width: RADIO_WIDE_WIDTH,
    minHeight: RADIO_WIDE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  wideCopy: { flex: 1, minWidth: 0, gap: spacing.xxs / 2 },
  onAir: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  disc: {
    width: RADIO_PLAY_DISC,
    height: RADIO_PLAY_DISC,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    ...elevation.card,
  },
  discOnAir: { backgroundColor: colors.success },
});
