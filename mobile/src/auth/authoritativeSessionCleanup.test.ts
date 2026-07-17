import { describe, expect, it, vi } from 'vitest';
import {
  AuthoritativeSessionCleanupCoordinator,
  AuthoritativeSessionCleanupError,
  type AuthoritativeSessionCleanupOperations,
} from './authoritativeSessionCleanup';

vi.mock('../api/client', () => ({
  pendingInvalidationAuthority: vi.fn(() => null),
  retryInvalidatedSessionCleanup: vi.fn(async () => undefined),
  runWithSessionInvalidationAuthority: vi.fn(
    async (_authority: unknown, operation: () => Promise<void>) => operation(),
  ),
}));
vi.mock('../player/setup', () => ({
  clearPlayerSession: vi.fn(async () => undefined),
}));
vi.mock('./offlineIdentity', () => ({
  clearOfflineIdentity: vi.fn(async () => undefined),
}));

function operations(
  overrides: Partial<AuthoritativeSessionCleanupOperations> = {},
): AuthoritativeSessionCleanupOperations {
  return {
    clearPlayerSession: vi.fn(async () => undefined),
    clearOfflineIdentity: vi.fn(async () => undefined),
    retryInvalidatedSessionCleanup: vi.fn(async () => undefined),
    runWithSessionInvalidationAuthority: vi.fn(
      async (_authority, operation) => operation(),
    ),
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('authoritative session cleanup', () => {
  it('coalesces the mounted UI listener and headless 401 into one awaitable cleanup', async () => {
    const nativeCleanup = deferred();
    const boundaries = operations({
      clearPlayerSession: vi.fn(() => nativeCleanup.promise),
    });
    const coordinator = new AuthoritativeSessionCleanupCoordinator(boundaries);

    const uiListener = coordinator.clear();
    const headlessDrainer = coordinator.clear();
    expect(headlessDrainer).toBe(uiListener);
    expect(boundaries.clearPlayerSession).toHaveBeenCalledOnce();

    nativeCleanup.resolve();
    await expect(Promise.all([uiListener, headlessDrainer])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(boundaries.clearOfflineIdentity).toHaveBeenCalledOnce();
    expect(boundaries.retryInvalidatedSessionCleanup).toHaveBeenCalledOnce();
  });

  it('attempts every boundary and exposes only bounded boundary names on failure', async () => {
    const boundaries = operations({
      clearPlayerSession: vi.fn(async () => {
        throw new Error('private player diagnostic');
      }),
      clearOfflineIdentity: vi.fn(async () => {
        throw new Error('private identity diagnostic');
      }),
    });
    const coordinator = new AuthoritativeSessionCleanupCoordinator(boundaries);

    await expect(coordinator.clear()).rejects.toEqual(
      new AuthoritativeSessionCleanupError([
        'native-player-session',
        'offline-identity',
      ]),
    );
    expect(boundaries.retryInvalidatedSessionCleanup).toHaveBeenCalledOnce();
  });

  it('coalesces only callers that hold the same invalidation authority', async () => {
    const nativeCleanup = deferred();
    const boundaries = operations({
      clearPlayerSession: vi.fn(() => nativeCleanup.promise),
    });
    const coordinator = new AuthoritativeSessionCleanupCoordinator(boundaries);
    const firstAuthority = Object.freeze({}) as never;
    const secondAuthority = Object.freeze({}) as never;

    const ui = coordinator.clear(firstAuthority);
    const headless = coordinator.clear(firstAuthority);
    const unrelated = coordinator.clear(secondAuthority);

    expect(headless).toBe(ui);
    expect(unrelated).not.toBe(ui);
    expect(boundaries.runWithSessionInvalidationAuthority).toHaveBeenCalledTimes(2);

    nativeCleanup.resolve();
    await Promise.all([ui, headless, unrelated]);
  });
});
