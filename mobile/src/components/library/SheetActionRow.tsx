import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import { AppText } from '../ui';

const GLYPH_TILE = 40;

export interface SheetActionRowProps {
  icon: AppIconName;
  label: string;
  description?: string;
  /** `danger` tints a destructive action. */
  tone?: 'default' | 'danger';
  /** Omit for a static row whose `trailing` control (e.g. a Switch) is the interaction. */
  onPress?: () => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
  testID?: string;
}

/**
 * One action of a bottom-sheet menu: a tinted glyph tile, a label with an
 * optional explanation, and a trailing control. With `onPress` the whole row
 * is one button; without it the row only labels its trailing control.
 */
export function SheetActionRow({
  icon,
  label,
  description,
  tone = 'default',
  onPress,
  disabled = false,
  trailing,
  testID,
}: SheetActionRowProps) {
  const danger = tone === 'danger';
  const content = (
    <>
      <View style={[styles.glyph, danger ? styles.glyphDanger : null]}>
        <AppIcon name={icon} color={danger ? colors.danger : colors.textPrimary} size={22} />
      </View>
      <View style={styles.copy}>
        <AppText variant="bodyStrong" color={danger ? 'danger' : 'primary'} numberOfLines={2}>
          {label}
        </AppText>
        {description === undefined ? null : (
          <AppText variant="callout" color="secondary" numberOfLines={2}>{description}</AppText>
        )}
      </View>
      {trailing}
    </>
  );

  if (onPress === undefined) {
    return (
      <View testID={testID} style={[styles.row, disabled ? styles.disabled : null]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: metrics.minimumTouchTarget + spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  glyph: {
    width: GLYPH_TILE,
    height: GLYPH_TILE,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.fill,
  },
  glyphDanger: { backgroundColor: colors.dangerSubtle },
  copy: { flex: 1, minWidth: 0 },
  pressed: { opacity: opacity.pressed, backgroundColor: colors.fill },
  disabled: { opacity: opacity.disabled },
});
