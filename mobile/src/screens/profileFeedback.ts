import type { ProfileValidationCode } from './profileModel';
import type { SleepTimerOperationErrorCode } from './profileSleepTimer';

interface ProfileFeedbackCopy {
  saveFailed: string;
  sleepSetFailed: string;
  deleteFailed: string;
  noActiveTrack: string;
  noRemainingTime: string;
  validation: {
    displayNameRequired: string;
    displayNameTooLong: string;
    emailInvalid: string;
    passwordTooShort: string;
    passwordTooLong: string;
    passwordMismatch: string;
  };
}

function errorCode(value: unknown, expectedName: string): unknown {
  if (typeof value !== 'object' || value === null) return null;
  if (!('name' in value) || value.name !== expectedName) return null;
  return 'code' in value ? value.code : null;
}

function profileValidationCode(value: unknown): ProfileValidationCode | null {
  const code = errorCode(value, 'ProfileValidationError');
  switch (code) {
    case 'display_name_required':
    case 'display_name_too_long':
    case 'email_invalid':
    case 'password_too_short':
    case 'password_too_long':
    case 'password_mismatch':
      return code;
    default:
      return null;
  }
}

function sleepTimerOperationCode(value: unknown): SleepTimerOperationErrorCode | null {
  const code = errorCode(value, 'SleepTimerOperationError');
  return code === 'no_active_track' || code === 'no_remaining_time' ? code : null;
}

function validationMessage(code: ProfileValidationCode, copy: ProfileFeedbackCopy): string {
  switch (code) {
    case 'display_name_required': return copy.validation.displayNameRequired;
    case 'display_name_too_long': return copy.validation.displayNameTooLong;
    case 'email_invalid': return copy.validation.emailInvalid;
    case 'password_too_short': return copy.validation.passwordTooShort;
    case 'password_too_long': return copy.validation.passwordTooLong;
    case 'password_mismatch': return copy.validation.passwordMismatch;
  }
}

/**
 * Local validation errors are safe and actionable. Everything crossing the
 * server boundary is deliberately collapsed to product copy so response
 * bodies, identifiers, and transport diagnostics never enter the UI.
 */
export function profileSaveFailureMessage(
  failure: unknown,
  copy: ProfileFeedbackCopy,
): string {
  const code = profileValidationCode(failure);
  return code === null ? copy.saveFailed : validationMessage(code, copy);
}

/** Preserve only the two expected local precondition failures from Media3. */
export function profileSleepTimerFailureMessage(
  failure: unknown,
  copy: ProfileFeedbackCopy,
): string {
  const code = sleepTimerOperationCode(failure);
  if (code === 'no_active_track') return copy.noActiveTrack;
  if (code === 'no_remaining_time') return copy.noRemainingTime;
  return copy.sleepSetFailed;
}

/** Account-deletion failures may originate from policy, auth, or cleanup. */
export function profileDeleteFailureMessage(
  _failure: unknown,
  copy: ProfileFeedbackCopy,
): string {
  return copy.deleteFailed;
}
