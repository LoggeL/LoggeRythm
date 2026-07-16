import type { RegisterRequest } from '../api/endpoints';
import { strings } from '../localization';

export interface RegistrationFields {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
  invite: string;
}

/** A deliberately user-readable failure produced before any request starts. */
export class RegistrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationValidationError';
  }
}

export function buildRegisterRequest(fields: RegistrationFields): RegisterRequest {
  const displayName = fields.displayName.trim();
  const email = fields.email.trim();
  if (!displayName) throw new RegistrationValidationError(strings.auth.displayNameRequired);
  if (Array.from(displayName).length > 120) {
    throw new RegistrationValidationError(strings.auth.displayNameTooLong);
  }
  if (!email) throw new RegistrationValidationError(strings.auth.emailRequired);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new RegistrationValidationError(strings.auth.emailInvalid);
  }
  if (!fields.password) throw new RegistrationValidationError(strings.auth.passwordRequired);
  if (!fields.confirmPassword) {
    throw new RegistrationValidationError(strings.auth.passwordConfirmationRequired);
  }

  const passwordLength = Array.from(fields.password).length;
  if (passwordLength < 8) throw new RegistrationValidationError(strings.auth.passwordTooShort);
  if (passwordLength > 128) throw new RegistrationValidationError(strings.auth.passwordTooLong);
  if (fields.password !== fields.confirmPassword) {
    throw new RegistrationValidationError(strings.auth.passwordsDoNotMatch);
  }

  return {
    email,
    password: fields.password,
    display_name: displayName,
    invite: fields.invite.trim() || null,
  };
}
