import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, spacing, typography } from '../../theme';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Small uppercase line above the title. */
  eyebrow?: string;
  /** Trailing actions: one node, usually IconButton(s) in a row fragment. */
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  titleTestID?: string;
}

/**
 * ScreenHeader is the large in-content title block at the top of a root
 * screen: optional overline eyebrow, hero title (announced as a header),
 * optional subtitle and trailing actions aligned to the title baseline. It
 * has no horizontal padding of its own — the screen's content container
 * supplies `layout.pagePadding`.
 */
export function ScreenHeader({ title, subtitle, eyebrow, action, style, testID, titleTestID }: ScreenHeaderProps) {
  return (
    <View testID={testID} style={[styles.header, style]}>
      <View style={styles.copy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text testID={titleTestID} accessibilityRole="header" style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  eyebrow: { ...typography.overline, color: colors.accentSoft },
  title: { ...typography.hero, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  action: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
});
