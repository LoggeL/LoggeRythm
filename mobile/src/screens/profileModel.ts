import type { MeUpdateRequest } from '../api/endpoints';

export const DISPLAY_NAME_MAX_LENGTH = 120;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const SLEEP_PRESETS_MINUTES = [15, 30, 45, 60] as const;

export interface ProfileForm {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface CurrentProfile {
  displayName: string | null;
  email: string;
}

export type ProfileValidationCode =
  | 'display_name_required'
  | 'display_name_too_long'
  | 'email_invalid'
  | 'password_too_short'
  | 'password_too_long'
  | 'password_mismatch';

export class ProfileValidationError extends Error {
  constructor(readonly code: ProfileValidationCode) {
    super(code);
    this.name = 'ProfileValidationError';
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function validEmail(value: string): boolean {
  // Mirrors the user-facing constraints enforced by Pydantic EmailStr: a
  // single non-whitespace @ plus a routable-looking domain.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function initialProfileForm(current: CurrentProfile): ProfileForm {
  return {
    displayName: current.displayName ?? '',
    email: current.email,
    password: '',
    confirmPassword: '',
  };
}

/**
 * Produces only changed fields and applies the backend's exact name/password
 * size limits. A blank replacement name is rejected because the backend keeps
 * the old value; accepting it in the UI would falsely imply that it was erased.
 */
export function buildProfilePatch(
  form: ProfileForm,
  current: CurrentProfile,
): MeUpdateRequest {
  const displayName = form.displayName.trim();
  const currentDisplayName = current.displayName ?? '';
  const email = form.email.trim();
  const patch: MeUpdateRequest = {};

  if (displayName !== currentDisplayName) {
    if (displayName.length === 0) throw new ProfileValidationError('display_name_required');
    if (codePointLength(displayName) > DISPLAY_NAME_MAX_LENGTH) {
      throw new ProfileValidationError('display_name_too_long');
    }
    patch.display_name = displayName;
  }

  if (email !== current.email) {
    if (!validEmail(email)) throw new ProfileValidationError('email_invalid');
    patch.email = email;
  }

  if (form.password.length > 0 || form.confirmPassword.length > 0) {
    const passwordLength = codePointLength(form.password);
    if (passwordLength < PASSWORD_MIN_LENGTH) {
      throw new ProfileValidationError('password_too_short');
    }
    if (passwordLength > PASSWORD_MAX_LENGTH) {
      throw new ProfileValidationError('password_too_long');
    }
    if (form.password !== form.confirmPassword) {
      throw new ProfileValidationError('password_mismatch');
    }
    patch.password = form.password;
  }

  return patch;
}

export function profilePatchHasChanges(patch: MeUpdateRequest): boolean {
  return Object.keys(patch).length > 0;
}

export function profileInitials(displayName: string | null, email: string): string {
  const source = displayName?.trim() || email.split('@')[0]?.trim() || '?';
  const words = source.split(/\s+/).filter(Boolean);
  const selected = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  const initials = selected
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
  return initials || '?';
}

/** Present only the effective host; never echo a path, query, or credential. */
export function profileServerHost(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.username || parsed.password || parsed.host.length === 0) {
    throw new Error('Profile server origin must be a credential-free URL');
  }
  return parsed.host;
}

export function currentTrackRemainingSeconds(position: number, duration: number): number | null {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return null;
  const remaining = Math.ceil(duration - Math.max(0, position));
  return remaining > 0 ? remaining : null;
}

export function formatTimerRemaining(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
