const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Canonical form shared by sign-in and registration before any request starts. */
export function normalizeEmail(value: string): string {
  return value.trim();
}

/** Match the browser form's required, syntactically valid email boundary locally. */
export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}
