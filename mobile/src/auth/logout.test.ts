import { describe, expect, it, vi } from 'vitest';
import { LogoutCleanupError, performLogout } from './logout';

describe('performLogout', () => {
  it('clears every local boundary before the consistency-only server call', async () => {
    const order: string[] = [];
    const result = await performLogout({
      revokeServerSession: async () => { order.push('server'); },
      clearPlayerSession: () => { order.push('player'); },
      clearAccountStorage: async () => { order.push('account-storage'); },
      clearLocalSession: async () => { order.push('local'); },
      clearQueryState: () => { order.push('query'); },
    });
    expect(order).toEqual(['player', 'account-storage', 'local', 'query', 'server']);
    expect(result).toEqual({ serverSessionCleared: true });
  });

  it('explicit Forget stays locally signed out when the consistency-only server call fails', async () => {
    const player = vi.fn();
    const accountStorage = vi.fn(async () => undefined);
    const local = vi.fn(async () => undefined);
    const query = vi.fn();

    const result = await performLogout({
      revokeServerSession: async () => { throw new Error('offline'); },
      clearPlayerSession: player,
      clearAccountStorage: accountStorage,
      clearLocalSession: local,
      clearQueryState: query,
    });
    expect(result).toEqual({ serverSessionCleared: false });
    expect(player).toHaveBeenCalledOnce();
    expect(accountStorage).toHaveBeenCalledOnce();
    expect(local).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });

  it('attempts every boundary and reports local cleanup failures', async () => {
    const order: string[] = [];
    const cleanup = performLogout({
      revokeServerSession: async () => { order.push('server'); },
      clearPlayerSession: () => { order.push('player'); throw new Error('native'); },
      clearAccountStorage: async () => { order.push('account-storage'); },
      clearLocalSession: async () => { order.push('local'); },
      clearQueryState: () => { order.push('query'); },
    });
    await expect(cleanup).rejects.toMatchObject({
      name: 'LogoutCleanupError',
      failedBoundaries: ['player'],
      message: expect.stringContaining('player and Android Auto state: native'),
    } satisfies Partial<LogoutCleanupError>);
    expect(order).toEqual(['player', 'account-storage', 'local', 'query', 'server']);
  });

  it('reports every failed local boundary without including server consistency failure', async () => {
    const cleanup = performLogout({
      revokeServerSession: async () => { throw new Error('offline'); },
      clearPlayerSession: () => { throw new Error('native'); },
      clearAccountStorage: async () => { throw new Error('disk'); },
      clearLocalSession: async () => undefined,
      clearQueryState: () => { throw new Error('mutation'); },
    });

    await expect(cleanup).rejects.toMatchObject({
      failedBoundaries: ['player', 'account-storage', 'query-cache'],
    } satisfies Partial<LogoutCleanupError>);
  });
});
