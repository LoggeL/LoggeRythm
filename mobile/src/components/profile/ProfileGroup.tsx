import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, layout, radii, spacing } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import { AppText, Surface } from '../ui';

export interface ProfileGroupProps {
  icon: AppIconName;
  title: string;
  description?: string;
  /** Control aligned with the title row (e.g. a refresh IconButton). */
  trailing?: ReactNode;
  /** danger tints the glyph for destructive groups. */
  tone?: 'default' | 'danger';
  testID?: string;
  children?: ReactNode;
}

/**
 * ProfileGroup is the one container for a profile section: a Surface whose
 * header is a settings row — glyph, label (announced as a header),
 * description and an optional trailing control — followed by the section's
 * content. Every profile section uses it so the screen reads as one list of
 * consistent rows.
 */
export function ProfileGroup({
  icon,
  title,
  description,
  trailing,
  tone = 'default',
  testID,
  children,
}: ProfileGroupProps) {
  const danger = tone === 'danger';
  return (
    <Surface testID={testID} padded style={styles.group}>
      <View style={styles.header}>
        <View accessible={false} style={[styles.glyph, danger ? styles.glyphDanger : null]}>
          <AppIcon name={icon} color={danger ? colors.danger : colors.accentSoft} size={20} />
        </View>
        <View style={styles.copy}>
          <AppText variant="bodyStrong" accessibilityRole="header">{title}</AppText>
          {description ? <AppText variant="callout" color="secondary">{description}</AppText> : null}
        </View>
        {trailing}
      </View>
      {children}
    </Surface>
  );
}

const styles = StyleSheet.create({
  group: { gap: layout.stackGap },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  glyph: {
    width: layout.artwork.xs,
    height: layout.artwork.xs,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  glyphDanger: { backgroundColor: colors.dangerSubtle },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs / 2 },
});
