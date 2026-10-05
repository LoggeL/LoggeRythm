import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, metrics, radii, spacing, typography } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';

export interface ActionButtonProps {
  label: string;
  onPress: () => void;
  icon?: AppIconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function ActionButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
  busy = false,
  testID,
  style,
  accessibilityLabel,
}: ActionButtonProps) {
  const unavailable = disabled || busy;
  const foreground = variant === 'primary'
    ? colors.onAccent
    : variant === 'danger'
      ? colors.danger
      : colors.textPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: unavailable, busy }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        style,
        pressed && styles.pressed,
        unavailable && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator accessible={false} color={foreground} size="small" />
      ) : icon ? (
        <AppIcon name={icon} color={foreground} size={20} />
      ) : null}
      <Text style={[styles.label, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.accentSolid, borderColor: colors.accentSolid },
  secondary: { backgroundColor: colors.surface, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: colors.dangerSubtle, borderColor: colors.danger },
  label: { ...typography.label, flexShrink: 1, textAlign: 'center' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.55 },
});
