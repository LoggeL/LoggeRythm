import { useAuth } from '../auth/AuthContext';
import { getCurrentApiBase } from '../config';
import { musicCacheScope } from '../data';

/** Cache/persistence scope of the signed-in account. Throws outside the approved gate. */
export function useApprovedAccountScope(): string {
  const { user } = useAuth();
  if (user === null || !user.is_approved) {
    throw new Error('Authenticated navigation requires an approved account');
  }
  return musicCacheScope(getCurrentApiBase(), user.id);
}
