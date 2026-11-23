import React from 'react';
import { Pressable, StyleSheet, type TextStyle } from 'react-native';
import { strings } from '../../localization';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, FocusRingOverlay, createFocusRingController } from '../ui';

interface SpotifyImportToggleProps {
  expanded: boolean;
  onToggle: () => void;
  marginHorizontal?: number;
  labelStyle?: TextStyle;
  onFocus?: () => void;
}

/** Opens and closes the Spotify link import below the search field. */
export function SpotifyImportToggle({
  expanded,
  onToggle,
  marginHorizontal,
  labelStyle,
  onFocus,
}: SpotifyImportToggleProps) {
  const label = expanded ? strings.search.importClose : strings.search.importOpen;
  const focusController = createFocusRingController();
  return (
    <Pressable
      testID="spotify-import-toggle"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      focusable
      android_ripple={{ color: colors.fillStrong, borderless: true }}
      onFocus={() => {
        focusController.setFocused(true);
        onFocus?.();
      }}
      onBlur={() => focusController.setFocused(false)}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.toggle,
        marginHorizontal !== undefined ? { marginHorizontal } : null,
        expanded ? styles.expanded : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <AppIcon
        name={expanded ? 'close' : 'link-variant'}
        color={expanded ? colors.accentSoft : colors.textSecondary}
        size={18}
      />
      <AppText
        variant="label"
        color={expanded ? 'accent' : 'secondary'}
        numberOfLines={1}
        style={labelStyle}
      >
        {label}
      </AppText>
      <FocusRingOverlay controller={focusController} borderRadius={radii.pill} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: {
    minHeight: metrics.minimumTouchTarget,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: layout.pagePadding - spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },
  expanded: { backgroundColor: colors.accentSubtle },
  pressed: { opacity: opacity.pressed },
});
