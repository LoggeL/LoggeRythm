export interface LogoutOperations {
  revokeServerSession: () => Promise<unknown>;
  clearPlayerSession: () => void | Promise<void>;
  clearAccountStorage: () => Promise<void>;
  clearLocalSession: () => Promise<void>;
  clearQueryState: () => void | Promise<void>;
}

export interface LogoutResult {
  /** The backend cookie-clear endpoint is consistency-only for the native app. */
  serverSessionCleared: boolean;
}

export type LogoutCleanupBoundary =
  | 'player'
  | 'account-storage'
  | 'local-session'
  | 'query-cache';

interface CleanupFailure {
  boundary: LogoutCleanupBoundary;
  detail: string;
}

/**
 * Machine-readable local boundary evidence for QA diagnostics. The UI still
 * receives the generic localized logout error; callers must not render the
 * implementation detail contained in this error.
 */
export class LogoutCleanupError extends Error {
  constructor(
    public readonly failedBoundaries: readonly LogoutCleanupBoundary[],
    message: string,
  ) {
    super(message);
    this.name = 'LogoutCleanupError';
  }
}

async function capture(
  failures: CleanupFailure[],
  boundary: LogoutCleanupBoundary,
  label: string,
  operation: () => void | Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push({ boundary, detail: `${label}: ${(error as Error).message}` });
  }
}

async function captureServerFailure(
  failures: string[],
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push(`server session: ${(error as Error).message}`);
  }
}

/**
 * Clear every local authority before making the consistency-only server call.
 * The backend currently uses stateless JWTs and its logout route only expires a
 * browser cookie, so waiting on the network must never leave native credentials
 * or playback state resident. Server failure does not undo a safe local logout.
 */
export async function performLogout(operations: LogoutOperations): Promise<LogoutResult> {
  const failures: CleanupFailure[] = [];
  await capture(failures, 'player', 'player and Android Auto state', operations.clearPlayerSession);
  await capture(failures, 'account-storage', 'account-scoped storage', operations.clearAccountStorage);
  await capture(failures, 'local-session', 'local session', operations.clearLocalSession);
  await capture(failures, 'query-cache', 'query cache', operations.clearQueryState);
  const serverFailures: string[] = [];
  await captureServerFailure(serverFailures, operations.revokeServerSession);

  if (failures.length > 0) {
    const failedBoundaries = failures.map(({ boundary }) => boundary);
    console.warn(
      `[LoggeRythm] logout local cleanup failed: ${failedBoundaries.join(',')}`,
    );
    throw new LogoutCleanupError(
      failedBoundaries,
      `Logout was incomplete: ${failures.map(({ detail }) => detail).join('; ')}`,
    );
  }
  return { serverSessionCleared: serverFailures.length === 0 };
}
