import { describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { appGate } from './gate';
import { refreshAuthenticatedUser, restoreSession } from './lifecycle';

const pendingUser: User = {
  id: 7,
  email: 'pending@example.test',
  display_name: 'Pending',
  is_admin: false,
  is_approved: false,
  avatar_url: null,
};

function statusError(status: number): Error & { status: number } {
  return Object.assign(new Error(`request returned ${status}`), { status });
}

function operations(readCurrentUser: () => Promise<User>) {
  return {
    hasStoredSession: vi.fn(async () => true),
    readCurrentUser: vi.fn(readCurrentUser),
    enterSignedOutState: vi.fn(async () => undefined),
    enterAuthenticatedState: vi.fn(async () => undefined),
    isUnauthorized: (error: unknown) =>
      typeof error === 'object'
      && error !== null
      && 'status' in error
      && error.status === 401,
  };
}

describe('auth lifecycle', () => {
  it('restores a stored session on both initial bootstrap and process restart', async () => {
    const first = operations(async () => pendingUser);
    const restarted = operations(async () => pendingUser);

    await expect(restoreSession(first)).resolves.toEqual({ kind: 'authenticated' });
    await expect(restoreSession(restarted)).resolves.toEqual({ kind: 'authenticated' });

    expect(first.enterAuthenticatedState).toHaveBeenCalledExactlyOnceWith(pendingUser);
    expect(restarted.enterAuthenticatedState).toHaveBeenCalledExactlyOnceWith(pendingUser);
    expect(first.enterSignedOutState).not.toHaveBeenCalled();
    expect(restarted.enterSignedOutState).not.toHaveBeenCalled();
  });

  it('keeps a transient bootstrap failure retryable and succeeds on Retry', async () => {
    const transientFailure = new Error('network unavailable');
    const readCurrentUser = vi.fn<() => Promise<User>>()
      .mockRejectedValueOnce(transientFailure)
      .mockResolvedValueOnce(pendingUser);
    const lifecycle = operations(readCurrentUser);

    await expect(restoreSession(lifecycle)).resolves.toEqual({
      kind: 'error',
      cause: transientFailure,
    });
    expect(lifecycle.enterSignedOutState).not.toHaveBeenCalled();

    await expect(restoreSession(lifecycle)).resolves.toEqual({ kind: 'authenticated' });
    expect(lifecycle.enterAuthenticatedState).toHaveBeenCalledExactlyOnceWith(pendingUser);
    expect(lifecycle.hasStoredSession).toHaveBeenCalledTimes(2);
  });

  it('enters the approved offline identity only for an explicitly eligible transport failure', async () => {
    const transientFailure = statusError(0);
    const lifecycle = {
      ...operations(async () => { throw transientFailure; }),
      isOfflineEligible: (error: unknown) => error === transientFailure,
      readOfflineUser: vi.fn(async () => pendingUser),
      enterOfflineAuthenticatedState: vi.fn(async () => undefined),
    };

    await expect(restoreSession(lifecycle)).resolves.toEqual({
      kind: 'offline-authenticated',
    });
    expect(lifecycle.readOfflineUser).toHaveBeenCalledExactlyOnceWith(transientFailure);
    expect(lifecycle.enterOfflineAuthenticatedState).toHaveBeenCalledExactlyOnceWith(pendingUser);
    expect(lifecycle.enterAuthenticatedState).not.toHaveBeenCalled();
    expect(lifecycle.enterSignedOutState).not.toHaveBeenCalled();
  });

  it('does not use an offline snapshot for 401, 403, or an incompatible server', async () => {
    for (const failure of [statusError(401), statusError(403), statusError(404)]) {
      const lifecycle = {
        ...operations(async () => { throw failure; }),
        isOfflineEligible: () => false,
        readOfflineUser: vi.fn(async () => pendingUser),
      };
      const result = await restoreSession(lifecycle);
      expect(result.kind).not.toBe('offline-authenticated');
      expect(lifecycle.readOfflineUser).not.toHaveBeenCalled();
    }
  });

  it('signs out only after an authoritative 401', async () => {
    const lifecycle = operations(async () => {
      throw statusError(401);
    });

    await expect(restoreSession(lifecycle)).resolves.toEqual({ kind: 'invalidated' });
    expect(lifecycle.enterSignedOutState).toHaveBeenCalledOnce();
    expect(lifecycle.enterAuthenticatedState).not.toHaveBeenCalled();
  });

  it('preserves a valid stored session after 403', async () => {
    const forbidden = statusError(403);
    const lifecycle = operations(async () => {
      throw forbidden;
    });

    await expect(restoreSession(lifecycle)).resolves.toEqual({
      kind: 'error',
      cause: forbidden,
    });
    expect(lifecycle.enterSignedOutState).not.toHaveBeenCalled();
    expect(lifecycle.enterAuthenticatedState).not.toHaveBeenCalled();
  });

  it('moves a manually approved account from pending gate to authenticated gate', async () => {
    let current = pendingUser;
    expect(appGate(current, false, null)).toBe('pending');
    const approved = { ...pendingUser, is_approved: true };

    await expect(refreshAuthenticatedUser({
      readCurrentUser: async () => approved,
      enterAuthenticatedState: async (user) => { current = user; },
    })).resolves.toEqual(approved);

    expect(appGate(current, false, null)).toBe('authenticated');
  });
});
