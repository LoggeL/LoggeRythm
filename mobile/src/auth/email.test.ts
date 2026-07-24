import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail } from './email';

describe('email identity', () => {
  it('normalizes whitespace and casing before authentication', () => {
    expect(normalizeEmail('  Mixed.Case@Example.COM  ')).toBe('mixed.case@example.com');
  });

  it('validates the normalized address', () => {
    expect(isValidEmail(normalizeEmail('  Person@Example.COM '))).toBe(true);
  });
});
