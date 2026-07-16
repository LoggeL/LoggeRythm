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
import { colors } from '../theme';

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
  const markSize = horizontal ? 32 : compact ? 42 : 72;
  return (
    <View
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      style={[styles.container, horizontal && styles.horizontal, style]}
    >
      <Image
        accessible={false}
        source={require('../../assets/icon.png')}
        resizeMode="contain"
        style={{ width: markSize, height: markSize }}
      />
      <View accessible={false} style={styles.wordmark}>
        <Text style={[styles.word, compact && styles.wordCompact]}>Logge</Text>
        <View style={[styles.divider, compact && styles.dividerCompact]} />
        <Text style={[styles.word, styles.rythm, compact && styles.wordCompact]}>Rythm</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 2 },
  horizontal: { flexDirection: 'row', gap: 7 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  wordCompact: { fontSize: 21 },
  rythm: { color: colors.accent },
  divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: '#ffffff59' },
  dividerCompact: { height: 21 },
});
