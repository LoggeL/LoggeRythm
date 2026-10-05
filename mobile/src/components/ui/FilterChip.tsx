import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, metrics, radii, spacing, typography } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';

export interface FilterChipProps {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  testID?: string;
  icon?: AppIconName;
  style?: StyleProp<ViewStyle>;
  accessibilityRole?: 'button' | 'tab' | 'radio';
  accessibilityLabel?: string;
}

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
  const foreground = selected ? colors.accentSoft : colors.textSecondary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={accessibilityRole === 'radio' ? { checked: selected, disabled } : { selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        style,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon ? <AppIcon name={icon} color={foreground} size={18} /> : null}
      <Text style={[styles.label, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  selected: { backgroundColor: colors.accentSubtle, borderColor: colors.accent },
  label: { ...typography.label },
  pressed: { backgroundColor: colors.surfacePressed },
  disabled: { opacity: 0.55 },
});
