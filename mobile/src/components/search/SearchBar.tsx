import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { strings } from '../../localization';
import { colors, layout, metrics, radii, spacing, typography } from '../../theme';
import AppIcon from '../AppIcon';
import { IconButton } from '../ui';

interface SearchBarProps {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
}

/** The search field: one prominent pill with a leading glyph and a clear control. */
export function SearchBar({ value, onChangeText, onSubmit }: SearchBarProps) {
  return (
    <View style={styles.bar}>
      <AppIcon name="magnify" color={colors.textSecondary} size={24} />
      <TextInput
        testID="search-input"
        accessibilityLabel={strings.search.inputLabel}
        style={styles.input}
        placeholder={strings.search.placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 ? (
        <IconButton
          testID="search-clear"
          icon="close-circle"
          size="sm"
          accessibilityLabel={strings.search.clear}
          onPress={() => onChangeText('')}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: metrics.minimumTouchTarget + spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: layout.pagePadding,
    paddingLeft: spacing.md,
    paddingRight: spacing.xxs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceElevated,
  },
  input: {
    ...typography.body,
    flex: 1,
    minHeight: metrics.minimumTouchTarget,
    paddingVertical: spacing.xs,
    color: colors.textPrimary,
  },
});
