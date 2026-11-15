import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountStrings } from '../screens/accountStrings';
import { byTestId, byType, flatStyle } from '../test/render';
import { colors, metrics } from '../theme';
import { FormField, PasswordField } from './FormField';

const mocks = vi.hoisted(() => ({ useState: vi.fn() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState };
});
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));

describe('FormField', () => {
  it('puts the testID and the accessible name on a 48dp native input', () => {
    const onChangeText = vi.fn();
    const tree = FormField({ testID: 'login-email', label: 'Email', value: 'a', onChangeText });
    const input = byTestId(tree, 'login-email');

    expect(input.type).toBe('TextInput');
    expect(input.props.accessibilityLabel).toBe('Email');
    expect(input.props.accessibilityLabelledBy).toBeUndefined();
    expect(flatStyle(input.props.style).minHeight).toBe(metrics.minimumTouchTarget);
    (input.props.onChangeText as (value: string) => void)('b');
    expect(onChangeText).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('links a labelled-by input to its visible label instead of duplicating the name', () => {
    const tree = FormField({ testID: 'profile-email', label: 'Email', labelNativeID: 'profile-email-label' });
    const input = byTestId(tree, 'profile-email');

    expect(input.props.accessibilityLabel).toBeUndefined();
    expect(input.props.accessibilityLabelledBy).toBe('profile-email-label');
    expect(byType(tree, 'Text').some((text) => text.props.nativeID === 'profile-email-label')).toBe(true);
  });

  it('replaces the hint with an assertive field error and tints the outline', () => {
    const hinted = FormField({ label: 'Password', hint: 'Leave blank' });
    expect(byType(hinted, 'Text').map((text) => text.props.children)).toContain('Leave blank');

    const failed = FormField({
      label: 'Password',
      hint: 'Leave blank',
      error: 'Too short',
      errorTestID: 'field-error',
    });
    const error = byTestId(failed, 'field-error');
    expect(error.props.accessibilityRole).toBe('alert');
    expect(error.props.accessibilityLiveRegion).toBe('assertive');
    expect(error.props.children).toBe('Too short');
    expect(byType(failed, 'Text').map((text) => text.props.children)).not.toContain('Leave blank');
    expect(
      byType(failed, 'View').some((view) => flatStyle(view.props.style).borderColor === colors.danger),
    ).toBe(true);
  });
});

describe('PasswordField', () => {
  beforeEach(() => {
    mocks.useState.mockReset();
  });

  it('starts masked and toggles visibility through a labelled 48dp control', () => {
    const setVisible = vi.fn();
    mocks.useState.mockReturnValueOnce([false, setVisible]);
    const tree = PasswordField({ testID: 'login-password', label: 'Password' });
    const toggle = byTestId(tree, 'login-password-visibility');

    expect(byTestId(tree, 'login-password').props.secureTextEntry).toBe(true);
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityLabel).toBe(accountStrings.auth.showPassword);
    expect(flatStyle(toggle.props.style).width).toBe(metrics.minimumTouchTarget);
    (toggle.props.onPress as () => void)();
    const update = setVisible.mock.calls[0][0] as (current: boolean) => boolean;
    expect(update(false)).toBe(true);
  });

  it('reveals the password and offers to hide it again', () => {
    mocks.useState.mockReturnValueOnce([true, vi.fn()]);
    const tree = PasswordField({ testID: 'login-password', label: 'Password' });

    expect(byTestId(tree, 'login-password').props.secureTextEntry).toBe(false);
    expect(byTestId(tree, 'login-password-visibility').props.accessibilityLabel)
      .toBe(accountStrings.auth.hidePassword);
  });

  it('locks the toggle together with a read-only input', () => {
    mocks.useState.mockReturnValueOnce([false, vi.fn()]);
    const tree = PasswordField({ testID: 'login-password', label: 'Password', editable: false });

    expect(byTestId(tree, 'login-password').props.editable).toBe(false);
    expect(byTestId(tree, 'login-password-visibility').props.disabled).toBe(true);
  });
});
