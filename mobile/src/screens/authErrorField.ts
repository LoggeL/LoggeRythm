import { strings } from '../localization';

export type AuthField = 'server' | 'displayName' | 'email' | 'password' | 'confirmPassword';

/**
 * Maps a local sign-in / registration validation message to the form field
 * it is about, so the screen can show it under that input. Returns null for
 * everything else (server responses, the combined "credentials required"
 * message), which stays in the form-level alert.
 */
export function authErrorField(message: string | null): AuthField | null {
  if (message === null) return null;
  const { auth } = strings;
  switch (message) {
    case auth.serverInvalid:
      return 'server';
    case auth.displayNameRequired:
    case auth.displayNameTooLong:
      return 'displayName';
    case auth.emailRequired:
    case auth.emailInvalid:
      return 'email';
    case auth.passwordRequired:
    case auth.passwordTooShort:
    case auth.passwordTooLong:
      return 'password';
    case auth.passwordConfirmationRequired:
    case auth.passwordsDoNotMatch:
      return 'confirmPassword';
    default:
      return null;
  }
}
