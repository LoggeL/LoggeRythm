export interface AccountSwitchOperations<T> {
  clearPlayerSession: () => void | Promise<void>;
  clearAccountStorage: () => Promise<void>;
  clearLocalSession: () => Promise<void>;
  clearQueryState: () => void | Promise<void>;
  authenticate: () => Promise<T>;
}

async function capture(
  failures: string[],
  label: string,
  operation: () => void | Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push(`${label}: ${(error as Error).message}`);
  }
}

/**
 * Tear down the departing account before a replacement credential is created.
 *
 * Login normally runs only from the signed-out gate, but keeping this boundary
 * defensive prevents a future account picker, re-authentication flow, or direct
 * context caller from replacing SecureStore while the old account's queue,
 * notification, searches, Query cache, or Android Auto tree are still resident.
 */
export async function performAccountSwitch<T>(
  operations: AccountSwitchOperations<T>,
): Promise<T> {
  const failures: string[] = [];
  await capture(failures, 'player and Android Auto state', operations.clearPlayerSession);
  await capture(failures, 'account-scoped storage', operations.clearAccountStorage);
  await capture(failures, 'local session', operations.clearLocalSession);
  await capture(failures, 'query cache', operations.clearQueryState);

  if (failures.length > 0) {
    throw new Error(
      `Account switch was stopped because local cleanup was incomplete: ${failures.join('; ')}`,
    );
  }
  return operations.authenticate();
}
