import { describe, expect, it } from 'vitest';
import {
  buildRegisterRequest,
  RegistrationValidationError,
  type RegistrationFields,
} from './registration';

const valid: RegistrationFields = {
  displayName: '  Ada Lovelace  ',
  email: '  ada@example.test  ',
  password: 'analytical-engine',
  confirmPassword: 'analytical-engine',
  invite: '  invited-123  ',
};

describe('registration validation', () => {
  it('normalizes the required identity and optional invite into the exact API body', () => {
    expect(buildRegisterRequest(valid)).toEqual({
      email: 'ada@example.test',
      password: 'analytical-engine',
      display_name: 'Ada Lovelace',
      invite: 'invited-123',
    });
  });

  it('sends a blank optional invite as explicit null', () => {
    expect(buildRegisterRequest({ ...valid, invite: '' })).toMatchObject({ invite: null });
  });

  it.each([
    [{ displayName: '   ' }, 'Ein Anzeigename ist erforderlich.'],
    [{ email: '   ' }, 'Eine E-Mail-Adresse ist erforderlich.'],
    [{ password: '' }, 'Ein Passwort ist erforderlich.'],
    [{ confirmPassword: '' }, 'Bitte bestätige das Passwort.'],
  ])('rejects a missing required field', (change, message) => {
    expect(() => buildRegisterRequest({ ...valid, ...change })).toThrow(message);
  });

  it('enforces the backend password length bounds before the request', () => {
    expect(() =>
      buildRegisterRequest({ ...valid, password: '1234567', confirmPassword: '1234567' }),
    ).toThrow('Das Passwort muss mindestens 8 Zeichen lang sein.');
    expect(() =>
      buildRegisterRequest({ ...valid, password: 'x'.repeat(129), confirmPassword: 'x'.repeat(129) }),
    ).toThrow('Das Passwort darf höchstens 128 Zeichen lang sein.');
    expect(
      buildRegisterRequest({ ...valid, password: 'x'.repeat(128), confirmPassword: 'x'.repeat(128) })
        .password,
    ).toHaveLength(128);
  });

  it('rejects a mismatched confirmation before the request', () => {
    expect(() => buildRegisterRequest({ ...valid, confirmPassword: 'different-password' })).toThrow(
      'Die Passwörter stimmen nicht überein.',
    );
  });

  it('matches the web form identity and email constraints', () => {
    expect(() => buildRegisterRequest({ ...valid, displayName: 'x'.repeat(121) })).toThrow(
      'Der Anzeigename darf höchstens 120 Zeichen lang sein.',
    );
    expect(() => buildRegisterRequest({ ...valid, email: 'not-an-email' })).toThrow(
      'Bitte gib eine gültige E-Mail-Adresse ein.',
    );
  });

  it('marks only local validation copy as safe to present verbatim', () => {
    expect(() => buildRegisterRequest({ ...valid, email: 'not-an-email' }))
      .toThrow(RegistrationValidationError);
  });
});
