import type { MeUpdateRequest } from '../api/endpoints';
import type { User } from '../api/types';

export interface ProfileUpdateOperations {
  updateMe: (patch: MeUpdateRequest) => Promise<User>;
  refreshUser: () => Promise<User>;
  invalidatePublicProfile: (userId: number) => Promise<unknown>;
}

/**
 * Persist an account edit while retaining the server's user-id-bound session.
 * The backend does not rotate its cookie for name/email/password changes, so
 * Android refreshes the authenticated identity and rejects any identity drift
 * instead of signing in again or silently moving account-scoped state.
 */
export async function persistProfileUpdate(
  patch: MeUpdateRequest,
  expectedUserId: number,
  operations: ProfileUpdateOperations,
): Promise<User> {
  const updated = await operations.updateMe(patch);
  if (updated.id !== expectedUserId) {
    throw new Error('Profile update returned a different account identity');
  }

  const refreshed = await operations.refreshUser();
  if (refreshed.id !== expectedUserId) {
    throw new Error('Profile refresh returned a different account identity');
  }

  await operations.invalidatePublicProfile(expectedUserId);
  return refreshed;
}
