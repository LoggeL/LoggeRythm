import { describe, expect, it, vi } from 'vitest';
import { ProfileValidationError } from './profileModel';
import { SleepTimerOperationError } from './profileSleepTimer';
import {
  profileDeleteFailureMessage,
  profileSaveFailureMessage,
  profileSleepTimerFailureMessage,
} from './profileFeedback';

vi.mock('@rntp/player', () => ({ default: {} }));

const copy = {
  saveFailed: 'Changes could not be saved.',
  sleepSetFailed: 'The sleep timer could not be changed.',
  deleteFailed: 'The account could not be deleted.',
  noActiveTrack: 'Start a track first.',
  noRemainingTime: 'No remaining time is available.',
  validation: {
    displayNameRequired: 'Enter a display name.',
    displayNameTooLong: 'Use a shorter display name.',
    emailInvalid: 'Enter a valid email.',
    passwordTooShort: 'Use a longer password.',
    passwordTooLong: 'Use a shorter password.',
    passwordMismatch: 'The passwords do not match.',
  },
};

describe('safe Profile feedback', () => {
  it('keeps every local profile-validation outcome actionable', () => {
    const cases = [
      ['display_name_required', copy.validation.displayNameRequired],
      ['display_name_too_long', copy.validation.displayNameTooLong],
      ['email_invalid', copy.validation.emailInvalid],
      ['password_too_short', copy.validation.passwordTooShort],
      ['password_too_long', copy.validation.passwordTooLong],
      ['password_mismatch', copy.validation.passwordMismatch],
    ] as const;

    for (const [code, expected] of cases) {
      expect(profileSaveFailureMessage(new ProfileValidationError(code), copy)).toBe(expected);
    }
  });

  it('keeps expected local sleep-timer preconditions actionable', () => {
    expect(profileSleepTimerFailureMessage(new SleepTimerOperationError('no_active_track'), copy))
      .toBe(copy.noActiveTrack);
    expect(profileSleepTimerFailureMessage(new SleepTimerOperationError('no_remaining_time'), copy))
      .toBe(copy.noRemainingTime);
  });

  it('never exposes server, native, or cleanup diagnostics', () => {
    const diagnostic = 'SQLSTATE 23505; user=7; native controller disconnected';

    expect(profileSaveFailureMessage(new Error(diagnostic), copy)).toBe(copy.saveFailed);
    expect(profileSleepTimerFailureMessage(new Error(diagnostic), copy)).toBe(copy.sleepSetFailed);
    expect(profileDeleteFailureMessage(new Error(diagnostic), copy)).toBe(copy.deleteFailed);
    expect([
      profileSaveFailureMessage({ message: diagnostic }, copy),
      profileSleepTimerFailureMessage(diagnostic, copy),
      profileDeleteFailureMessage({ detail: diagnostic }, copy),
    ].join(' ')).not.toContain(diagnostic);
  });

  it('rejects lookalike local errors with unknown codes', () => {
    expect(profileSaveFailureMessage({
      name: 'ProfileValidationError',
      code: 'server_stack',
      message: 'private detail',
    }, copy)).toBe(copy.saveFailed);
    expect(profileSleepTimerFailureMessage({
      name: 'SleepTimerOperationError',
      code: 'native_stack',
      message: 'private detail',
    }, copy)).toBe(copy.sleepSetFailed);
  });
});
