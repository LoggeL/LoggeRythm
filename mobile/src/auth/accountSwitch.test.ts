import { describe, expect, it, vi } from 'vitest';
import { performAccountSwitch } from './accountSwitch';

describe('performAccountSwitch', () => {
  it('removes every departing-account boundary before creating the new session', async () => {
    const order: string[] = [];
    const result = await performAccountSwitch({
      clearPlayerSession: () => { order.push('player'); },
      clearAccountStorage: async () => { order.push('account-storage'); },
      clearLocalSession: async () => { order.push('local-session'); },
      clearQueryState: () => { order.push('query'); },
      authenticate: async () => { order.push('authenticate'); return { id: 2 }; },
    });

    expect(result).toEqual({ id: 2 });
    expect(order).toEqual([
      'player',
      'account-storage',
      'local-session',
      'query',
      'authenticate',
    ]);
  });

  it('attempts every cleanup and never creates a replacement session after a failure', async () => {
    const order: string[] = [];
    const authenticate = vi.fn(async () => ({ id: 2 }));

    await expect(performAccountSwitch({
      clearPlayerSession: () => { order.push('player'); throw new Error('native queue'); },
      clearAccountStorage: async () => { order.push('account-storage'); throw new Error('history'); },
      clearLocalSession: async () => { order.push('local-session'); },
      clearQueryState: () => { order.push('query'); },
      authenticate,
    })).rejects.toThrow(
      'player and Android Auto state: native queue; account-scoped storage: history',
    );

    expect(order).toEqual(['player', 'account-storage', 'local-session', 'query']);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('does not restore the departing account when replacement authentication fails', async () => {
    const order: string[] = [];
    await expect(performAccountSwitch({
      clearPlayerSession: () => { order.push('player'); },
      clearAccountStorage: async () => { order.push('account-storage'); },
      clearLocalSession: async () => { order.push('local-session'); },
      clearQueryState: () => { order.push('query'); },
      authenticate: async () => { order.push('authenticate'); throw new Error('bad credentials'); },
    })).rejects.toThrow('bad credentials');

    expect(order).toEqual([
      'player',
      'account-storage',
      'local-session',
      'query',
      'authenticate',
    ]);
  });

  it('does not create the replacement credential while player cleanup is pending', async () => {
    let finishPlayerCleanup!: () => void;
    const playerCleanup = new Promise<void>((resolve) => {
      finishPlayerCleanup = resolve;
    });
    const authenticate = vi.fn(async () => ({ id: 2 }));

    const switching = performAccountSwitch({
      clearPlayerSession: () => playerCleanup,
      clearAccountStorage: async () => undefined,
      clearLocalSession: async () => undefined,
      clearQueryState: () => undefined,
      authenticate,
    });
    await Promise.resolve();
    expect(authenticate).not.toHaveBeenCalled();

    finishPlayerCleanup();
    await expect(switching).resolves.toEqual({ id: 2 });
    expect(authenticate).toHaveBeenCalledOnce();
  });
});
