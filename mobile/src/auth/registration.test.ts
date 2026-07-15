import { describe, expect, it } from 'vitest';
import { buildRegisterRequest, type RegistrationFields } from './registration';

const valid: RegistrationFields = {
  displayName: '  Ada Lovelace  ',
  email: '  ada@example.test  ',
  password: 'analytical-engine',
  confirmPassword: 'analytical-engine',
  invite: '  invited-123  ',
};

describe('registration validation', () => {
  it('normalizes email and optional text fields into the exact API body', () => {
    expect(buildRegisterRequest(valid)).toEqual({
      email: 'ada@example.test',
      password: 'analytical-engine',
      display_name: 'Ada Lovelace',
      invite: 'invited-123',
    });
  });

  it('sends blank optional fields as explicit nulls', () => {
    expect(buildRegisterRequest({ ...valid, displayName: '  ', invite: '' })).toMatchObject({
      display_name: null,
      invite: null,
    });
  });

  it.each([
    [{ email: '   ' }, 'Email is required'],
    [{ password: '' }, 'Password is required'],
    [{ confirmPassword: '' }, 'Password confirmation is required'],
  ])('rejects a missing required field', (change, message) => {
    expect(() => buildRegisterRequest({ ...valid, ...change })).toThrow(message);
  });

  it('enforces the backend password length bounds before the request', () => {
    expect(() =>
      buildRegisterRequest({ ...valid, password: '1234567', confirmPassword: '1234567' }),
    ).toThrow('Password must be at least 8 characters');
    expect(() =>
      buildRegisterRequest({ ...valid, password: 'x'.repeat(129), confirmPassword: 'x'.repeat(129) }),
    ).toThrow('Password must be at most 128 characters');
    expect(
      buildRegisterRequest({ ...valid, password: 'x'.repeat(128), confirmPassword: 'x'.repeat(128) })
        .password,
    ).toHaveLength(128);
  });

  it('rejects a mismatched confirmation before the request', () => {
    expect(() => buildRegisterRequest({ ...valid, confirmPassword: 'different-password' })).toThrow(
      'Passwords do not match',
    );
  });
});
