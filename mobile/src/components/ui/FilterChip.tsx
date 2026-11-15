import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, metrics, opacity, radii, spacing, typography } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';

export interface FilterChipProps {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  testID?: string;
  icon?: AppIconName;
  style?: StyleProp<ViewStyle>;
  /** `tab` for view switchers, `radio` for exclusive choices, `button` otherwise. */
  accessibilityRole?: 'button' | 'tab' | 'radio';
  accessibilityLabel?: string;
}

/** Visual pill height; the pressable itself stays 48dp tall. */
const PILL_HEIGHT = 36;

/**
 * FilterChip is the selectable pill used for filters, tabs and exclusive
 * choices (web `.filter-chip`): a translucent pill that turns into a light
 * pill with dark ink when selected. The visible pill is 36dp tall but the
 * touch target keeps the full 48dp. Place chips in a horizontal ScrollView
 * with `gap: spacing.xs`.
 */
export function FilterChip({
  label,
  onPress,
  selected = false,
  disabled = false,
  testID,
  icon,
  style,
  accessibilityRole = 'button',
  accessibilityLabel,
}: FilterChipProps) {
  const foreground = selected ? colors.onLight : colors.textPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={accessibilityRole === 'radio' ? { checked: selected, disabled } : { selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.target,
        style,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <View style={[styles.pill, selected ? styles.pillSelected : null]}>
        {icon ? <AppIcon name={icon} color={foreground} size={16} /> : null}
        <Text numberOfLines={1} style={[styles.label, { color: foreground }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    height: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
  },
  label: { ...typography.label },
  pillSelected: { backgroundColor: colors.textPrimary },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
