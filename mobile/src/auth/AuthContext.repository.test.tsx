import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { ApiError } from '../api/client';
import { AuthProvider } from './AuthContext';
import type { AuthRepository, RegisterRequest } from './repository';

const mocks = vi.hoisted(() => ({
  clearSession: vi.fn(async () => undefined),
  hasSession: vi.fn(async () => true),
  onSessionInvalidated: vi.fn(() => () => undefined),
  retryInvalidatedSessionCleanup: vi.fn(async () => undefined),
  clearAccountQueryState: vi.fn(),
  clearAccountQueryStateBoundary: vi.fn(async () => undefined),
  clearAccountScopedStorage: vi.fn(async () => undefined),
  clearPlayerSession: vi.fn(async () => undefined),
  clearOfflineDownloads: vi.fn(async () => undefined),
  clearOfflineIdentity: vi.fn(async () => undefined),
  persistOfflineIdentity: vi.fn(async () => undefined),
  readOfflineIdentity: vi.fn(async (): Promise<User | null> => null),
  getApiBase: vi.fn(async () => 'https://loggerythm.logge.top'),
  useEffect: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useCallback: <T,>(callback: T): T => callback,
    useEffect: mocks.useEffect,
    useMemo: <T,>(factory: () => T): T => factory(),
    useRef: <T,>(value: T): { current: T } => ({ current: value }),
    useState: <T,>(value: T | (() => T)): [T, ReturnType<typeof vi.fn>] => [
      typeof value === 'function' ? (value as () => T)() : value,
      vi.fn(),
    ],
  };
});

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getAllKeys: vi.fn(), removeItem: vi.fn() },
}));
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  clearSession: mocks.clearSession,
  hasSession: mocks.hasSession,
  onSessionInvalidated: mocks.onSessionInvalidated,
  retryInvalidatedSessionCleanup: mocks.retryInvalidatedSessionCleanup,
}));
vi.mock('../config', () => ({ getApiBase: mocks.getApiBase }));
vi.mock('../data', () => ({
  clearAccountQueryState: mocks.clearAccountQueryState,
  clearAccountQueryStateBoundary: mocks.clearAccountQueryStateBoundary,
  clearAccountScopedStorage: mocks.clearAccountScopedStorage,
  musicCacheScope: (_origin: string, userId: number) => `account:${userId}`,
}));
vi.mock('../player/setup', () => ({ clearPlayerSession: mocks.clearPlayerSession }));
vi.mock('../offline/runtime', () => ({
  clearOfflineDownloads: mocks.clearOfflineDownloads,
}));
vi.mock('./offlineIdentity', () => ({
  clearOfflineIdentity: mocks.clearOfflineIdentity,
  persistOfflineIdentity: mocks.persistOfflineIdentity,
  readOfflineIdentity: mocks.readOfflineIdentity,
}));

const user: User = {
  id: 17,
  email: 'person@example.test',
  display_name: 'Person',
  is_admin: false,
  is_approved: true,
  avatar_url: null,
};

const registration: RegisterRequest = {
  email: 'new@example.test',
  password: 'password123',
  display_name: 'New Person',
  invite: null,
};

interface AuthValue {
  login(email: string, password: string): Promise<void>;
  register(request: RegisterRequest): Promise<void>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
  refreshUser(): Promise<User>;
  retryBootstrap(): Promise<void>;
}

function injectedRepository(): AuthRepository & {
  me: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  deleteMe: ReturnType<typeof vi.fn>;
} {
  return {
    me: vi.fn(async () => user),
    login: vi.fn(async () => user),
    register: vi.fn(async () => user),
    logout: vi.fn(async () => ({ ok: true })),
    deleteMe: vi.fn(async () => undefined),
  };
}

function renderProvider(repository?: AuthRepository): AuthValue {
  const element = AuthProvider({ children: null, repository }) as unknown as React.ReactElement<{
    value: AuthValue;
  }>;
  return element.props.value;
}

describe('AuthProvider repository injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasSession.mockResolvedValue(true);
    mocks.getApiBase.mockResolvedValue('https://loggerythm.logge.top');
    mocks.readOfflineIdentity.mockResolvedValue(null);
  });

  it('preserves the public no-repository provider usage', () => {
    expect(() => renderProvider()).not.toThrow();
  });

  it('routes login and registration through the injected repository', async () => {
    const loginRepository = injectedRepository();
    await renderProvider(loginRepository).login('person@example.test', 'password123');
    expect(loginRepository.login).toHaveBeenCalledExactlyOnceWith(
      'person@example.test',
      'password123',
    );

    const registerRepository = injectedRepository();
    await renderProvider(registerRepository).register(registration);
    expect(registerRepository.register).toHaveBeenCalledExactlyOnceWith(registration);
  });

  it('uses injected me for both bootstrap retry and approval refresh', async () => {
    const repository = injectedRepository();
    const auth = renderProvider(repository);

    await auth.retryBootstrap();
    await expect(auth.refreshUser()).resolves.toBe(user);

    expect(repository.me).toHaveBeenCalledTimes(2);
    expect(mocks.persistOfflineIdentity).toHaveBeenCalledTimes(2);
    expect(mocks.persistOfflineIdentity).toHaveBeenCalledWith(
      user,
      'https://loggerythm.logge.top',
    );
  });

  it('falls back to the encrypted approved identity only after a transient bootstrap failure', async () => {
    const repository = injectedRepository();
    repository.me.mockRejectedValueOnce(new ApiError(500, '', 'transient server failure'));
    mocks.readOfflineIdentity.mockResolvedValueOnce(user);

    await renderProvider(repository).retryBootstrap();

    expect(mocks.readOfflineIdentity).toHaveBeenCalledExactlyOnceWith(
      'https://loggerythm.logge.top',
    );
    expect(mocks.persistOfflineIdentity).not.toHaveBeenCalled();
  });

  it('routes logout and remote account deletion through distinct repository methods', async () => {
    const logoutRepository = injectedRepository();
    await renderProvider(logoutRepository).logout();
    expect(logoutRepository.logout).toHaveBeenCalledOnce();
    expect(logoutRepository.deleteMe).not.toHaveBeenCalled();
    expect(mocks.clearOfflineIdentity).toHaveBeenCalledOnce();
    expect(mocks.clearOfflineDownloads).toHaveBeenCalledOnce();

    const deletionRepository = injectedRepository();
    await renderProvider(deletionRepository).deleteAccount();
    expect(deletionRepository.deleteMe).toHaveBeenCalledOnce();
    expect(deletionRepository.logout).not.toHaveBeenCalled();
  });

  it('fails account cleanup closed when native offline audio cannot be erased', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.clearOfflineDownloads.mockRejectedValueOnce(new Error('native erase failed'));
    const repository = injectedRepository();

    await expect(renderProvider(repository).logout()).rejects.toThrow('offline audio');
    expect(mocks.clearOfflineIdentity).toHaveBeenCalledOnce();
    expect(mocks.clearAccountScopedStorage).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      '[LoggeRythm] account storage cleanup failed: offline-audio',
    );
    warning.mockRestore();
  });

  it('cannot commit a late approval refresh after logout completed', async () => {
    let resolveRefresh!: (value: User) => void;
    const refreshResult = new Promise<User>((resolve) => { resolveRefresh = resolve; });
    const repository = injectedRepository();
    repository.me.mockImplementationOnce(() => refreshResult);
    const auth = renderProvider(repository);

    const refresh = auth.refreshUser();
    await vi.waitFor(() => expect(repository.me).toHaveBeenCalledOnce());
    await auth.logout();
    resolveRefresh(user);

    await expect(refresh).rejects.toThrow(
      'Authentication result was invalidated by account cleanup',
    );
    expect(mocks.persistOfflineIdentity).not.toHaveBeenCalled();
  });

  it('requires a failed query boundary to succeed before replacement authentication', async () => {
    mocks.clearAccountQueryStateBoundary.mockRejectedValueOnce(
      new Error('mutation boundary still active'),
    );
    const repository = injectedRepository();
    const auth = renderProvider(repository);

    await expect(auth.logout()).rejects.toThrow('mutation boundary still active');
    expect(repository.login).not.toHaveBeenCalled();

    await expect(auth.login('person@example.test', 'password123')).resolves.toBeUndefined();
    expect(mocks.clearAccountQueryStateBoundary).toHaveBeenCalledTimes(2);
    expect(repository.login).toHaveBeenCalledExactlyOnceWith(
      'person@example.test',
      'password123',
    );
  });
});
