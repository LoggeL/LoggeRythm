import type { RegisterRequest } from '../api/endpoints';

export interface RegistrationFields {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
  invite: string;
}

export function buildRegisterRequest(fields: RegistrationFields): RegisterRequest {
  const email = fields.email.trim();
  if (!email) throw new Error('Email is required');
  if (!fields.password) throw new Error('Password is required');
  if (!fields.confirmPassword) throw new Error('Password confirmation is required');

  const passwordLength = Array.from(fields.password).length;
  if (passwordLength < 8) throw new Error('Password must be at least 8 characters');
  if (passwordLength > 128) throw new Error('Password must be at most 128 characters');
  if (fields.password !== fields.confirmPassword) throw new Error('Passwords do not match');

  return {
    email,
    password: fields.password,
    display_name: fields.displayName.trim() || null,
    invite: fields.invite.trim() || null,
  };
}
