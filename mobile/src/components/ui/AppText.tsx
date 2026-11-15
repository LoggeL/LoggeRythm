import React from 'react';
import { Text, type TextProps } from 'react-native';
import { colors, typography, type TypographyVariant } from '../../theme';

const textColors = {
  primary: colors.textPrimary,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  accent: colors.accentSoft,
  danger: colors.danger,
  success: colors.success,
  warning: colors.warning,
  onAccent: colors.onAccent,
  onLight: colors.onLight,
} as const;

export type AppTextColor = keyof typeof textColors;

export interface AppTextProps extends TextProps {
  /** Typography token from the theme type scale. Defaults to `body`. */
  variant?: TypographyVariant;
  /** Semantic text colour. Defaults to `primary`. */
  color?: AppTextColor;
  align?: 'left' | 'center' | 'right';
}

/**
 * AppText is the only way screens should render copy: it maps a `variant` to
 * a token of the theme type scale and a `color` to a semantic text colour, so
 * no screen needs a literal fontSize, fontWeight or hex value. Every other
 * `Text` prop (numberOfLines, testID, accessibilityRole, ...) passes through
 * and a `style` override is applied last for layout-only tweaks (flex, margin).
 */
export function AppText({
  variant = 'body',
  color = 'primary',
  align,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[
        typography[variant],
        { color: textColors[color] },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
