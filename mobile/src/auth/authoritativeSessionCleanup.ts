import {
  pendingInvalidationAuthority,
  retryInvalidatedSessionCleanup,
  runWithSessionInvalidationAuthority,
  type SessionInvalidationAuthority,
} from '../api/client';
import { clearPlayerSession } from '../player/setup';
import { clearOfflineIdentity } from './offlineIdentity';

export type AuthoritativeSessionCleanupBoundary =
  | 'native-player-session'
  | 'offline-identity'
  | 'invalidated-session';

export interface AuthoritativeSessionCleanupOperations {
  clearPlayerSession(): Promise<void>;
  clearOfflineIdentity(): Promise<void>;
  retryInvalidatedSessionCleanup(): Promise<void>;
  runWithSessionInvalidationAuthority(
    authority: SessionInvalidationAuthority,
    operation: () => Promise<void>,
  ): Promise<void>;
}

export class AuthoritativeSessionCleanupError extends Error {
  constructor(
    public readonly failedBoundaries: readonly AuthoritativeSessionCleanupBoundary[],
  ) {
    super('Authoritative session cleanup could not be completed');
    this.name = 'AuthoritativeSessionCleanupError';
  }
}

/**
 * One process-wide, awaitable authority boundary shared by the mounted UI and
 * React-dead Headless JS. It deliberately retains no diagnostic or credential
 * material and attempts every local boundary even when one of them fails.
 */
export class AuthoritativeSessionCleanupCoordinator {
  private genericInFlight: Promise<void> | null = null;
  private readonly authorityInFlight =
    new WeakMap<object, Promise<void>>();

  constructor(private readonly operations: AuthoritativeSessionCleanupOperations) {}

  clear(authority?: SessionInvalidationAuthority): Promise<void> {
    const current = authority === undefined
      ? this.genericInFlight
      : this.authorityInFlight.get(authority) ?? null;
    if (current !== null) return current;
    const attempt = authority === undefined
      ? this.run()
      : this.operations.runWithSessionInvalidationAuthority(
          authority,
          () => this.run(),
        );
    if (authority === undefined) this.genericInFlight = attempt;
    else this.authorityInFlight.set(authority, attempt);
    const release = (): void => {
      if (authority === undefined) {
        if (this.genericInFlight === attempt) this.genericInFlight = null;
      } else if (this.authorityInFlight.get(authority) === attempt) {
        this.authorityInFlight.delete(authority);
      }
    };
    void attempt.then(release, release);
    return attempt;
  }

  private async run(): Promise<void> {
    const failedBoundaries: AuthoritativeSessionCleanupBoundary[] = [];
    const capture = async (
      boundary: AuthoritativeSessionCleanupBoundary,
      operation: () => Promise<void>,
    ): Promise<void> => {
      try {
        await operation();
      } catch {
        failedBoundaries.push(boundary);
      }
    };

    await capture('native-player-session', this.operations.clearPlayerSession);
    await capture('offline-identity', this.operations.clearOfflineIdentity);
    await capture(
      'invalidated-session',
      this.operations.retryInvalidatedSessionCleanup,
    );

    if (failedBoundaries.length > 0) {
      throw new AuthoritativeSessionCleanupError(failedBoundaries);
    }
  }
}

const authoritativeSessionCleanup = new AuthoritativeSessionCleanupCoordinator({
  clearPlayerSession,
  clearOfflineIdentity,
  retryInvalidatedSessionCleanup,
  runWithSessionInvalidationAuthority,
});

export function clearAuthoritativeSessionAuthority(
  authority?: SessionInvalidationAuthority,
): Promise<void> {
  const exactAuthority = authority ?? pendingInvalidationAuthority() ?? undefined;
  return authoritativeSessionCleanup.clear(exactAuthority);
}
