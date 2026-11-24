import React from 'react';
import { ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, metrics, radii, spacing, typography } from '../../theme';
import type { AppIconName } from '../AppIcon';
import { ActionButton, AppText, BottomSheet } from '../ui';
import { SheetActionRow } from './SheetActionRow';
import { useKeyboardInset } from './useKeyboardInset';

const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 500;
const DESCRIPTION_MIN_HEIGHT = 96;

export interface PlaylistFormSheetProps {
  visible: boolean;
  /** `library-create` or `playlist-edit`: prefixes every testID of the form. */
  testIDPrefix: string;
  title: string;
  name: string;
  description: string;
  /** Localized validation or failure copy; null hides the alert. */
  error: string | null;
  busy: boolean;
  submitLabel: string;
  busyLabel: string;
  submitIcon: AppIconName;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  /** Optional collaborative switch shown when creating a playlist. */
  collaborative?: {
    value: boolean;
    onChange: (value: boolean) => void;
  };
  onClose: () => void;
  onSubmit: () => void;
}

/**
 * The playlist name/description form shared by "create" and "edit". It is a
 * bottom sheet whose content scrolls and which pads itself by the keyboard
 * height, so neither the fields nor the buttons are ever covered on a small
 * screen or with a large font scale.
 */
export function PlaylistFormSheet({
  visible,
  testIDPrefix,
  title,
  name,
  description,
  error,
  busy,
  submitLabel,
  busyLabel,
  submitIcon,
  onNameChange,
  onDescriptionChange,
  collaborative,
  onClose,
  onSubmit,
}: PlaylistFormSheetProps) {
  const keyboardInset = useKeyboardInset();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel={libraryStrings.common.dismiss}
      title={title}
      testID={`${testIDPrefix}-modal`}
      contentStyle={styles.sheet}
    >
      <ScrollView
        testID={`${testIDPrefix}-form-scroll`}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.form}
      >
        <View style={styles.field}>
          <AppText variant="label" color="secondary">{libraryStrings.library.name}</AppText>
          <TextInput
            testID={`${testIDPrefix}-name`}
            accessibilityLabel={libraryStrings.library.name}
            placeholder={libraryStrings.library.name}
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={onNameChange}
            editable={!busy}
            autoFocus
            returnKeyType="next"
            maxLength={NAME_MAX_LENGTH}
            style={styles.input}
          />
        </View>
        <View style={styles.field}>
          <AppText variant="label" color="secondary">
            {libraryStrings.library.description}
          </AppText>
          <TextInput
            testID={`${testIDPrefix}-description`}
            accessibilityLabel={libraryStrings.library.description}
            placeholder={libraryStrings.library.description}
            placeholderTextColor={colors.textMuted}
            value={description}
            onChangeText={onDescriptionChange}
            editable={!busy}
            multiline
            maxLength={DESCRIPTION_MAX_LENGTH}
            style={[styles.input, styles.descriptionInput]}
          />
        </View>
        {collaborative === undefined ? null : (
          <SheetActionRow
            icon="account-multiple-outline"
            label={libraryStrings.library.collaborativeCreateLabel}
            description={libraryStrings.library.collaborativeCreateHint}
            disabled={busy}
            trailing={
              <Switch
                testID={`${testIDPrefix}-collaborative`}
                accessibilityLabel={libraryStrings.library.collaborativeCreateLabel}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                value={collaborative.value}
                onValueChange={collaborative.onChange}
                trackColor={{ false: colors.border, true: colors.accentSolid }}
                thumbColor={collaborative.value ? colors.accentSoft : colors.textSecondary}
              />
            }
          />
        )}
        {error === null ? null : (
          <AppText
            testID={`${testIDPrefix}-error`}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            variant="callout"
            color="danger"
          >
            {error}
          </AppText>
        )}
        <View style={styles.actions}>
          <ActionButton
            testID={`${testIDPrefix}-cancel`}
            label={libraryStrings.common.cancel}
            variant="ghost"
            disabled={busy}
            onPress={onClose}
            style={styles.action}
          />
          <ActionButton
            testID={`${testIDPrefix}-submit`}
            label={busy ? busyLabel : submitLabel}
            busy={busy}
            icon={submitIcon}
            onPress={onSubmit}
            style={styles.action}
          />
        </View>
        <View testID={`${testIDPrefix}-keyboard-spacer`} style={{ height: keyboardInset }} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: spacing.lg },
  form: { gap: spacing.md, paddingTop: spacing.xs },
  field: { gap: spacing.xs },
  input: {
    ...typography.body,
    minHeight: metrics.minimumTouchTarget,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  descriptionInput: { minHeight: DESCRIPTION_MIN_HEIGHT, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingTop: spacing.xs },
  action: { flexGrow: 1, flexBasis: 120 },
});
