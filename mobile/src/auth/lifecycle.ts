export interface SessionBootstrapOperations<T> {
  hasStoredSession: () => Promise<boolean>;
  readCurrentUser: () => Promise<T>;
  enterSignedOutState: () => Promise<void>;
  enterAuthenticatedState: (user: T) => Promise<void>;
  enterOfflineAuthenticatedState?: (user: T) => Promise<void>;
  isUnauthorized: (error: unknown) => boolean;
  isOfflineEligible?: (error: unknown) => boolean;
  readOfflineUser?: (error: unknown) => Promise<T | null>;
}

export type SessionBootstrapResult =
  | { kind: 'signed-out' }
  | { kind: 'authenticated' }
  | { kind: 'offline-authenticated' }
  | { kind: 'invalidated' }
  | { kind: 'error'; cause: unknown };

/**
 * Restore the native session without coupling the decision boundary to React.
 *
 * Only an authoritative 401 is allowed to turn a stored credential into a
 * signed-out state. A 403 can represent a still-valid pending/unauthorized
 * account and transient failures must remain retryable with the credential
 * intact.
 */
export async function restoreSession<T>(
  operations: SessionBootstrapOperations<T>,
): Promise<SessionBootstrapResult> {
  try {
    if (!(await operations.hasStoredSession())) {
      await operations.enterSignedOutState();
      return { kind: 'signed-out' };
    }
    const user = await operations.readCurrentUser();
    await operations.enterAuthenticatedState(user);
    return { kind: 'authenticated' };
  } catch (error) {
    if (!operations.isUnauthorized(error)) {
      if (operations.isOfflineEligible?.(error) && operations.readOfflineUser !== undefined) {
        try {
          const offlineUser = await operations.readOfflineUser(error);
          if (offlineUser !== null) {
            await (
              operations.enterOfflineAuthenticatedState
              ?? operations.enterAuthenticatedState
            )(offlineUser);
            return { kind: 'offline-authenticated' };
          }
        } catch (offlineError) {
          return { kind: 'error', cause: offlineError };
        }
      }
      return { kind: 'error', cause: error };
    }
    try {
      await operations.enterSignedOutState();
      return { kind: 'invalidated' };
    } catch (cleanupError) {
      return { kind: 'error', cause: cleanupError };
    }
  }
}

export interface RefreshUserOperations<T> {
  readCurrentUser: () => Promise<T>;
  enterAuthenticatedState: (user: T) => Promise<void>;
}

/** Re-read `/me` and commit its exact approval/account state atomically. */
export async function refreshAuthenticatedUser<T>(
  operations: RefreshUserOperations<T>,
): Promise<T> {
  const user = await operations.readCurrentUser();
  await operations.enterAuthenticatedState(user);
  return user;
}
