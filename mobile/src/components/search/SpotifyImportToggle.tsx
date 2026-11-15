import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { strings } from '../../localization';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText } from '../ui';

interface SpotifyImportToggleProps {
  expanded: boolean;
  onToggle: () => void;
}

/** Opens and closes the Spotify link import below the search field. */
export function SpotifyImportToggle({ expanded, onToggle }: SpotifyImportToggleProps) {
  const label = expanded ? strings.search.importClose : strings.search.importOpen;
  return (
    <Pressable
      testID="spotify-import-toggle"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.toggle,
        expanded ? styles.expanded : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <AppIcon
        name={expanded ? 'close' : 'link-variant'}
        color={expanded ? colors.accentSoft : colors.textSecondary}
        size={18}
      />
      <AppText variant="label" color={expanded ? 'accent' : 'secondary'} numberOfLines={1}>
        {label}
      </AppText>
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
