import React from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';

export interface ArtworkProps {
  /** Absolute image URL. null/undefined/'' renders the placeholder only. */
  uri: string | null | undefined;
  /** Edge length in dp (use layout.artwork.*), or 'fill' for width 100% + square aspect. */
  size: number | 'fill';
  /** round = artists/avatars, square = everything else. */
  shape?: 'square' | 'round';
  /** Corner radius token for square artwork. Defaults by size (sm below 64dp, card above). */
  radius?: keyof typeof radii;
  /** Placeholder glyph: music-note (default), album, account-music, playlist-music, radio ... */
  icon?: AppIconName;
  /** Only set when the artwork itself conveys information; it is decorative by default. */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Artwork is the single cover/avatar renderer: a themed placeholder tile
 * with a glyph, and the remote image layered on top of it. Because the
 * placeholder is always underneath, a missing, still-loading or failed image
 * shows the glyph without any state or error handling in the caller. It is
 * decorative (hidden from assistive tech) unless an `accessibilityLabel` is
 * given — the surrounding row or card carries the accessible name.
 */
export function Artwork({
  uri,
  size,
  shape = 'square',
  radius,
  icon = 'music-note',
  accessibilityLabel,
  testID,
  style,
}: ArtworkProps) {
  const fill = size === 'fill';
  const edge = fill ? 96 : size;
  const borderRadius =
    shape === 'round' ? radii.pill : radii[radius ?? (edge < 64 ? 'sm' : 'card')];
  const labelled = accessibilityLabel !== undefined;
  return (
    <View
      testID={testID}
      accessible={labelled}
      accessibilityRole={labelled ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={labelled ? 'yes' : 'no-hide-descendants'}
      style={[
        styles.tile,
        fill ? styles.fill : { width: edge, height: edge },
        { borderRadius },
        style,
      ]}
    >
      <AppIcon name={icon} color={colors.textMuted} size={fill ? 40 : Math.round(edge * 0.42)} />
      {uri ? (
        <Image
          accessible={false}
          source={{ uri }}
          resizeMode="cover"
          style={styles.image}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  fill: { width: '100%', aspectRatio: 1 },
  image: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
