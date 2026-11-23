import React from 'react';
import { StyleSheet, TextInput, View, type TextStyle } from 'react-native';
import { strings } from '../../localization';
import { colors, layout, metrics, radii, spacing, typography } from '../../theme';
import AppIcon from '../AppIcon';
import {
  FocusRingOverlay,
  IconButton,
  createFocusRingController,
} from '../ui';

interface SearchBarProps {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  /** Optional TV horizontal margin override. */
  marginHorizontal?: number;
  /** Optional TV minimum height override. */
  minHeight?: number;
  /** Optional 10-foot TV typography override. */
  inputTextStyle?: TextStyle;
  /** Optional TV focus callback for focus memory. */
  onInputFocus?: () => void;
  /** Optional TV preferred focus flag (strictly pass `tv.isTv` gated from screen). */
  hasTVPreferredFocus?: boolean;
  /** Optional ref to focus the underlying TextInput for TV focus return. */
  inputRef?: React.Ref<TextInput>;
}

/** The search field: one prominent pill with a leading glyph and a clear control. */
export function SearchBar({
  value,
  onChangeText,
  onSubmit,
  marginHorizontal,
  minHeight,
  inputTextStyle,
  onInputFocus,
  hasTVPreferredFocus,
  inputRef,
}: SearchBarProps) {
  const focusController = createFocusRingController();
  const barStyle =
    marginHorizontal === undefined && minHeight === undefined
      ? styles.bar
      : [
          styles.bar,
          marginHorizontal !== undefined ? { marginHorizontal } : null,
          minHeight !== undefined ? { minHeight: minHeight + spacing.xs } : null,
        ];
  const inputStyle =
    minHeight === undefined && inputTextStyle === undefined
      ? styles.input
      : [
          styles.input,
          minHeight !== undefined ? { minHeight } : null,
          inputTextStyle,
        ];
  return (
    <View style={barStyle}>
      <AppIcon name="magnify" color={colors.textSecondary} size={24} />
      <TextInput
        {...(inputRef !== undefined ? { ref: inputRef } : {})}
        testID="search-input"
        accessibilityLabel={strings.search.inputLabel}
        style={inputStyle}
        placeholder={strings.search.placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={() => {
          focusController.setFocused(true);
          onInputFocus?.();
        }}
        onBlur={() => focusController.setFocused(false)}
        {...(hasTVPreferredFocus !== undefined ? { hasTVPreferredFocus } : {})}
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
      <FocusRingOverlay controller={focusController} borderRadius={radii.pill} />
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
