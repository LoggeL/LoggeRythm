export interface DeleteAccountOperations {
  deleteServerAccount: () => Promise<void>;
  clearPlayerSession: () => void | Promise<void>;
  clearAccountStorage: () => Promise<void>;
  clearLocalSession: () => Promise<void>;
  clearQueryState: () => void | Promise<void>;
}

export class DeletedAccountCleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeletedAccountCleanupError';
  }
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
 * The remote deletion must succeed before local state is discarded. Once it
 * succeeds, every local account boundary is attempted and server logout is
 * deliberately absent because the remote account/session no longer exists.
 */
export async function performAccountDeletion(operations: DeleteAccountOperations): Promise<void> {
  await operations.deleteServerAccount();

  const failures: string[] = [];
  await capture(failures, 'player and Android Auto state', operations.clearPlayerSession);
  await capture(failures, 'account-scoped storage', operations.clearAccountStorage);
  await capture(failures, 'local session', operations.clearLocalSession);
  await capture(failures, 'query cache', operations.clearQueryState);
  if (failures.length > 0) {
    throw new DeletedAccountCleanupError(
      `Account was deleted remotely, but local cleanup was incomplete: ${failures.join('; ')}`,
    );
  }
}
