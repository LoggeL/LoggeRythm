import { describe, expect, it } from 'vitest';
import type { User } from '../api/types';
import { appGate } from './gate';

const approved: User = {
  id: 1,
  email: 'qa@example.test',
  display_name: 'QA',
  is_admin: false,
  is_approved: true,
  avatar_url: null,
};

describe('post-login app gate', () => {
  it('transitions an approved login directly to authenticated navigation', () => {
    expect(appGate(approved, false, null)).toBe('authenticated');
  });

  it('keeps an unapproved non-admin out of authenticated navigation', () => {
    expect(appGate({ ...approved, is_approved: false }, false, null)).toBe('pending');
  });

  it('keeps an unapproved admin behind the same production approval gate', () => {
    expect(appGate({ ...approved, is_approved: false, is_admin: true }, false, null)).toBe(
      'pending',
    );
  });
});
