import { describe, expect, it } from 'vitest';
import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ProfileValidationError,
  buildProfilePatch,
  currentTrackRemainingSeconds,
  formatTimerRemaining,
  profileInitials,
  profileServerHost,
  profilePatchHasChanges,
} from './profileModel';

const current = { displayName: 'Ada Lovelace', email: 'ada@example.com' };

describe('buildProfilePatch', () => {
  it('trims changed identity fields and emits only changes', () => {
    expect(buildProfilePatch({
      displayName: '  Ada Byron  ',
      email: '  ada@history.example  ',
      password: '',
      confirmPassword: '',
    }, current)).toEqual({ display_name: 'Ada Byron', email: 'ada@history.example' });
  });

  it('returns an empty patch for an unchanged form', () => {
    const patch = buildProfilePatch({
      displayName: current.displayName,
      email: current.email,
      password: '',
      confirmPassword: '',
    }, current);
    expect(patch).toEqual({});
    expect(profilePatchHasChanges(patch)).toBe(false);
  });

  it('rejects a blank replacement name instead of pretending the backend clears it', () => {
    expect(() => buildProfilePatch({
      displayName: '   ', email: current.email, password: '', confirmPassword: '',
    }, current)).toThrowError(expect.objectContaining({ code: 'display_name_required' }));
  });

  it('accepts a 120-code-point name and rejects 121', () => {
    const accepted = '🎵'.repeat(DISPLAY_NAME_MAX_LENGTH);
    expect(buildProfilePatch({
      displayName: accepted, email: current.email, password: '', confirmPassword: '',
    }, current)).toEqual({ display_name: accepted });
    expect(() => buildProfilePatch({
      displayName: `${accepted}🎵`, email: current.email, password: '', confirmPassword: '',
    }, current)).toThrowError(expect.objectContaining({ code: 'display_name_too_long' }));
  });

  it('rejects malformed changed email addresses', () => {
    expect(() => buildProfilePatch({
      displayName: current.displayName, email: 'not-an-email', password: '', confirmPassword: '',
    }, current)).toThrowError(expect.objectContaining({ code: 'email_invalid' }));
  });

  it('matches the backend password boundaries and requires confirmation', () => {
    const accepted = 'p'.repeat(PASSWORD_MIN_LENGTH);
    expect(buildProfilePatch({
      displayName: current.displayName,
      email: current.email,
      password: accepted,
      confirmPassword: accepted,
    }, current)).toEqual({ password: accepted });

    expect(() => buildProfilePatch({
      displayName: current.displayName, email: current.email,
      password: 'p'.repeat(PASSWORD_MIN_LENGTH - 1), confirmPassword: 'p'.repeat(PASSWORD_MIN_LENGTH - 1),
    }, current)).toThrowError(expect.objectContaining({ code: 'password_too_short' }));
    expect(() => buildProfilePatch({
      displayName: current.displayName, email: current.email,
      password: 'p'.repeat(PASSWORD_MAX_LENGTH + 1), confirmPassword: 'p'.repeat(PASSWORD_MAX_LENGTH + 1),
    }, current)).toThrowError(expect.objectContaining({ code: 'password_too_long' }));
    expect(() => buildProfilePatch({
      displayName: current.displayName, email: current.email,
      password: accepted, confirmPassword: `${accepted}!`,
    }, current)).toThrowError(expect.objectContaining({ code: 'password_mismatch' }));
  });

  it('uses a typed validation error', () => {
    expect(() => buildProfilePatch({
      displayName: current.displayName, email: '', password: '', confirmPassword: '',
    }, current)).toThrow(ProfileValidationError);
  });
});

describe('profile formatting and native timer math', () => {
  it('derives two-character initials with an email fallback', () => {
    expect(profileInitials('Ada King Lovelace', 'ada@example.com')).toBe('AL');
    expect(profileInitials(null, 'grace@example.com')).toBe('G');
  });

  it('shows only the effective server host without leaking URL credentials or paths', () => {
    expect(profileServerHost('https://loggerythm.logge.top')).toBe('loggerythm.logge.top');
    expect(profileServerHost('http://10.0.2.2:8000')).toBe('10.0.2.2:8000');
    expect(() => profileServerHost('https://user:secret@example.test')).toThrow(
      'credential-free',
    );
  });

  it('rounds the current-track remainder up and rejects unavailable progress', () => {
    expect(currentTrackRemainingSeconds(10.2, 20)).toBe(10);
    expect(currentTrackRemainingSeconds(20, 20)).toBeNull();
    expect(currentTrackRemainingSeconds(0, 0)).toBeNull();
    expect(currentTrackRemainingSeconds(Number.NaN, 20)).toBeNull();
  });

  it('formats countdowns without locale ambiguity', () => {
    expect(formatTimerRemaining(61)).toBe('1:01');
    expect(formatTimerRemaining(3661)).toBe('1:01:01');
    expect(formatTimerRemaining(-1)).toBe('0:00');
  });
});
