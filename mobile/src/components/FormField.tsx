import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { accountStrings } from '../screens/accountStrings';
import { colors, metrics, opacity, radii, spacing, typography } from '../theme';
import { AppText, IconButton } from './ui';

export interface FormFieldProps extends TextInputProps {
  /** Visible label above the input; also its accessible name unless `labelNativeID` is set. */
  label: string;
  /** Field-level failure: tints the outline and replaces the hint. */
  error?: string | null;
  /** Helper copy below the input. */
  hint?: string;
  /** Links label and input via `accessibilityLabelledBy` instead of `accessibilityLabel`. */
  labelNativeID?: string;
  /** Control rendered inside the input outline (e.g. the password visibility toggle). */
  trailing?: React.ReactNode;
  errorTestID?: string;
}

/**
 * FormField is the labelled text input of the sign-in and profile forms:
 * label, a 48dp outlined input, and one line below it that is either the
 * assertive field error or the hint. `testID` and every other `TextInput`
 * prop land on the native input itself, so on-device QA can type into it.
 */
export function FormField({
  label,
  error,
  hint,
  labelNativeID,
  trailing,
  errorTestID,
  editable,
  style,
  ...input
}: FormFieldProps) {
  return (
    <View style={styles.field}>
      <AppText variant="label" nativeID={labelNativeID}>{label}</AppText>
      <View
        style={[
          styles.outline,
          error ? styles.outlineError : null,
          editable === false ? styles.disabled : null,
        ]}
      >
        <TextInput
          accessibilityLabel={labelNativeID ? undefined : label}
          accessibilityLabelledBy={labelNativeID}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          {...input}
          editable={editable}
          style={[styles.input, style]}
        />
        {trailing}
      </View>
      {error ? (
        <AppText
          testID={errorTestID}
          variant="callout"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color="secondary">{hint}</AppText>
      ) : null}
    </View>
  );
}

export type PasswordFieldProps = Omit<FormFieldProps, 'secureTextEntry' | 'trailing'>;

/**
 * PasswordField is a FormField that starts masked and owns a visibility
 * toggle (`${testID}-visibility`). The toggle state lives here so screens
 * whose hook order is pinned by tests do not gain a `useState`.
 */
export function PasswordField({ testID, editable, ...field }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField
      autoCapitalize="none"
      autoCorrect={false}
      {...field}
      testID={testID}
      editable={editable}
      secureTextEntry={!visible}
      trailing={
        <IconButton
          testID={testID ? `${testID}-visibility` : undefined}
          icon={visible ? 'eye-off-outline' : 'eye-outline'}
          size="sm"
          selected={visible}
          disabled={editable === false}
          accessibilityLabel={visible ? accountStrings.auth.hidePassword : accountStrings.auth.showPassword}
          onPress={() => setVisible((current) => !current)}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  outline: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  outlineError: { borderColor: colors.danger },
  disabled: { opacity: opacity.disabled },
  input: {
    ...typography.body,
    flex: 1,
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
});
