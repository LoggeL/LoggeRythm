import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, spacing, typography } from '../../theme';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  titleTestID?: string;
}

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
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  eyebrow: { ...typography.caption, color: colors.accentSoft, fontWeight: '600', letterSpacing: 1 },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  action: { flexShrink: 0 },
});
