import React from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, layout, spacing, typography } from '../theme';

type BrandLockupProps = {
  compact?: boolean;
  horizontal?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  style?: StyleProp<ViewStyle>;
};

/**
 * Native rendering of the production masthead: the shipped equalizer mark,
 * white "Logge", divider, and violet "Rythm" wordmark.
 */
export default function BrandLockup({
  compact = false,
  horizontal = false,
  accessibilityLabel = 'LoggeRythm',
  accessibilityRole = 'image',
  style,
}: BrandLockupProps) {
  const markSize = horizontal ? spacing.xxl : compact ? layout.artwork.xs : layout.artwork.lg;
  return (
    <View
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      style={[styles.container, horizontal && styles.horizontal, style]}
    >
      <Image
        accessible={false}
        source={require('../../assets/android-icon-foreground.png')}
        resizeMode="contain"
        style={{ width: markSize, height: markSize }}
      />
      <View accessible={false} style={styles.wordmark}>
        <Text style={[styles.word, compact && styles.wordCompact]}>Logge</Text>
        <View style={styles.divider} />
        <Text style={[styles.word, styles.rythm, compact && styles.wordCompact]}>Rythm</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.xxs / 2 },
  horizontal: { flexDirection: 'row', gap: spacing.xs },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  word: { ...typography.hero, color: colors.textPrimary },
  wordCompact: { ...typography.section, fontWeight: typography.hero.fontWeight },
  rythm: { color: colors.accent },
  divider: {
    alignSelf: 'stretch',
    width: StyleSheet.hairlineWidth,
    marginVertical: spacing.xxs,
    backgroundColor: colors.textMuted,
  },
});
