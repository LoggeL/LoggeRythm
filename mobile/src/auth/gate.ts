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
  // Approval is the content gate for every account. Admin capability does not
  // imply approval; this intentionally matches the production web shell.
  if (!user.is_approved) return 'pending';
  return 'authenticated';
}
