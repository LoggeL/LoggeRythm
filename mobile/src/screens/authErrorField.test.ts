import { afterEach, describe, expect, it } from 'vitest';
import { activateLocale, strings } from '../localization';
import { authErrorField } from './authErrorField';

afterEach(() => {
  activateLocale('de');
});

describe('authErrorField', () => {
  it.each(['de', 'en'] as const)('assigns local validation copy to its field in %s', (locale) => {
    activateLocale(locale);
    expect(authErrorField(strings.auth.serverInvalid)).toBe('server');
    expect(authErrorField(strings.auth.displayNameRequired)).toBe('displayName');
    expect(authErrorField(strings.auth.displayNameTooLong)).toBe('displayName');
    expect(authErrorField(strings.auth.emailRequired)).toBe('email');
    expect(authErrorField(strings.auth.emailInvalid)).toBe('email');
    expect(authErrorField(strings.auth.passwordRequired)).toBe('password');
    expect(authErrorField(strings.auth.passwordTooShort)).toBe('password');
    expect(authErrorField(strings.auth.passwordTooLong)).toBe('password');
    expect(authErrorField(strings.auth.passwordConfirmationRequired)).toBe('confirmPassword');
    expect(authErrorField(strings.auth.passwordsDoNotMatch)).toBe('confirmPassword');
  });

  it('keeps request failures and multi-field messages at form level', () => {
    expect(authErrorField(null)).toBeNull();
    expect(authErrorField(strings.auth.signInFailed)).toBeNull();
    expect(authErrorField(strings.auth.createAccountFailed)).toBeNull();
    expect(authErrorField(strings.auth.credentialsRequired)).toBeNull();
  });
});
