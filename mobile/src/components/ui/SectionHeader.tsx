import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { strings } from '../../localization';
import { colors, layout, metrics, opacity, spacing, typography } from '../../theme';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  /** Renders the trailing "Alle anzeigen" / "Show all" link. */
  onShowAll?: () => void;
  /** Overrides the visible link text (default strings.common.showAll). */
  showAllLabel?: string;
  /** Screen-reader name of the link; pass one that names the section. */
  showAllAccessibilityLabel?: string;
  showAllTestID?: string;
  /** Custom trailing node instead of the show-all link. */
  trailing?: React.ReactNode;
  /** Applies the page gutter. Disable inside an already padded container. */
  padded?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * SectionHeader titles one section of a screen (web `.section-heading` +
 * `.section-link`): a `section` heading announced as a header, an optional
 * subtitle, and an optional trailing "show all" link with a 48dp target. It
 * applies the page gutter itself so it lines up above full-bleed rails.
 */
export function SectionHeader({
  title,
  subtitle,
  onShowAll,
  showAllLabel,
  showAllAccessibilityLabel,
  showAllTestID,
  trailing,
  padded = true,
  testID,
  style,
}: SectionHeaderProps) {
  const linkLabel = showAllLabel ?? strings.common.showAll;
  return (
    <View testID={testID} style={[styles.row, padded ? styles.padded : null, style]}>
      <View style={styles.copy}>
        <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</Text>
        {subtitle ? <Text numberOfLines={2} style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ??
        (onShowAll ? (
          <Pressable
            testID={showAllTestID}
            accessibilityRole="button"
            accessibilityLabel={showAllAccessibilityLabel ?? `${linkLabel}: ${title}`}
            onPress={onShowAll}
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}
          >
            <Text style={styles.linkText}>{linkLabel}</Text>
          </Pressable>
        ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  padded: { paddingHorizontal: layout.pagePadding },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs / 2 },
  title: { ...typography.section, color: colors.textPrimary },
  subtitle: { ...typography.callout, color: colors.textSecondary },
  link: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  linkText: { ...typography.label, color: colors.textSecondary },
  pressed: { opacity: opacity.pressed },
});
