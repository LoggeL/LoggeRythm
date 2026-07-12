import type { User } from '../api/types';

export type AppGate = 'loading' | 'bootstrap-error' | 'login' | 'pending' | 'authenticated';

export function appGate(
  user: User | null,
  bootstrapping: boolean,
  bootstrapError: string | null,
): AppGate {
  if (bootstrapping) return 'loading';
  if (bootstrapError !== null) return 'bootstrap-error';
  if (user === null) return 'login';
  if (!user.is_approved && !user.is_admin) return 'pending';
  return 'authenticated';
}
