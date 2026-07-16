import { describe, expect, it, vi } from 'vitest';
import { DeletedAccountCleanupError, performAccountDeletion } from './deleteAccount';

describe('performAccountDeletion', () => {
  it('does not clear local state when remote deletion fails', async () => {
    const player = vi.fn();
    const accountStorage = vi.fn(async () => undefined);
    const local = vi.fn(async () => undefined);
    const query = vi.fn();
    await expect(
      performAccountDeletion({
        deleteServerAccount: async () => { throw new Error('rejected'); },
        clearPlayerSession: player,
        clearAccountStorage: accountStorage,
        clearLocalSession: local,
        clearQueryState: query,
      }),
    ).rejects.toThrow('rejected');
    expect(player).not.toHaveBeenCalled();
    expect(accountStorage).not.toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('completes every local boundary only after the server has deleted the account', async () => {
    const order: string[] = [];
    await expect(
      performAccountDeletion({
        deleteServerAccount: async () => { order.push('delete'); },
        clearPlayerSession: async () => { order.push('player'); },
        clearAccountStorage: async () => { order.push('account-storage'); },
        clearLocalSession: async () => { order.push('local-session'); },
        clearQueryState: () => { order.push('query'); },
      }),
    ).resolves.toBeUndefined();

    expect(order).toEqual([
      'delete',
      'player',
      'account-storage',
      'local-session',
      'query',
    ]);
  });

  it('attempts every cleanup after deletion and reports every incomplete boundary', async () => {
    const order: string[] = [];
    const deletion = performAccountDeletion({
      deleteServerAccount: async () => { order.push('delete'); },
      clearPlayerSession: () => { order.push('player'); throw new Error('native'); },
      clearAccountStorage: async () => {
        order.push('account-storage');
        throw new Error('persisted values');
      },
      clearLocalSession: async () => { order.push('local'); },
      clearQueryState: () => { order.push('query'); throw new Error('queries'); },
    });
    await expect(deletion).rejects.toBeInstanceOf(DeletedAccountCleanupError);
    await expect(deletion).rejects.toThrow(
      'player and Android Auto state: native; account-scoped storage: persisted values; query cache: queries',
    );
    expect(order).toEqual(['delete', 'player', 'account-storage', 'local', 'query']);
  });

});
