import {
  ServerCompatibilityCheckError,
  UnsupportedServerError,
} from '../api/compatibility';

export interface UserFacingError {
  kind: 'compatibility' | 'generic';
  message: string;
}

/**
 * Convert an arbitrary native or transport failure at the UI boundary.
 *
 * Compatibility failures already contain deliberately authored, localized
 * recovery copy. Every other failure is replaced instead of interpolated so
 * request URLs, response bodies, storage keys, and native diagnostics cannot
 * escape into alerts or accessibility announcements.
 */
export function presentError(cause: unknown, fallbackMessage: string): UserFacingError {
  if (
    cause instanceof UnsupportedServerError
    || cause instanceof ServerCompatibilityCheckError
  ) {
    return { kind: 'compatibility', message: cause.message };
  }
  return { kind: 'generic', message: fallbackMessage };
}
