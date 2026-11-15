import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, layout, radii } from '../theme';

/** Diameters of the three concentric glow discs, derived from the hero artwork edge. */
const OUTER = layout.artwork.hero * 2.6;
const MIDDLE = layout.artwork.hero * 1.8;
const INNER = layout.artwork.hero * 1.1;

/**
 * AuthBackdrop is the ambient accent glow behind the signed-out surfaces
 * (splash, sign-in, pending approval, session restore). It is three
 * concentric translucent discs built from plain Views — no gradient or blur
 * dependency — clipped at the top edge of the screen. Purely decorative:
 * hidden from assistive tech and never intercepts touches. Render it as the
 * first child of a `flex: 1` container.
 */
export default function AuthBackdrop() {
  return (
    <View
      testID="auth-backdrop"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.root}
    >
      <View style={[styles.disc, styles.outer]} />
      <View style={[styles.disc, styles.middle]} />
      <View style={[styles.disc, styles.inner]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    overflow: 'hidden',
  },
  disc: { position: 'absolute', borderRadius: radii.pill, backgroundColor: colors.accentSubtle },
  outer: { width: OUTER, height: OUTER, top: -OUTER / 2, opacity: 0.28 },
  middle: { width: MIDDLE, height: MIDDLE, top: -MIDDLE / 2, opacity: 0.45 },
  inner: { width: INNER, height: INNER, top: -INNER / 2, opacity: 0.7 },
});
