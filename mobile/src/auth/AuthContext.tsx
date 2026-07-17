import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ApiError,
  clearSession,
  hasSession,
  onSessionInvalidated,
  pendingInvalidationAuthority,
  type SessionInvalidationAuthority,
} from '../api/client';
import {
  ServerCompatibilityCheckError,
  UnsupportedServerError,
} from '../api/compatibility';
import type { User } from '../api/types';
import { getApiBase, getCurrentApiBase } from '../config';
import {
  clearAccountQueryState,
  clearAccountQueryStateBoundary,
  clearAccountScopedStorage,
  musicCacheScope,
} from '../data';
import { clearPlayerSession } from '../player/setup';
import { clearOfflineDownloads } from '../offline/runtime';
import { performAccountSwitch } from './accountSwitch';
import { AccountCleanupBarrier, AuthCommitBarrier } from './cleanupBarrier';
import { clearAuthoritativeSessionAuthority } from './authoritativeSessionCleanup';
import { performLogout } from './logout';
import { DeletedAccountCleanupError, performAccountDeletion } from './deleteAccount';
import { refreshAuthenticatedUser, restoreSession } from './lifecycle';
import { presentError, type UserFacingError } from './presentationError';
import {
  clearOfflineIdentity,
  persistOfflineIdentity,
  readOfflineIdentity,
} from './offlineIdentity';
import {
  defaultAuthRepository,
  type AuthRepository,
  type RegisterRequest,
} from './repository';
import { strings } from '../localization';

interface AuthState {
  user: User | null;
  /** True only when a recent approved identity was restored after a transport failure. */
  offlineMode: boolean;
  bootstrapping: boolean;
  bootstrapError: UserFacingError | null;
  login: (email: string, password: string, apiBase: string) => Promise<void>;
  register: (request: RegisterRequest, apiBase: string) => Promise<void>;
  logout: () => Promise<void>;
  forgetSession: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshUser: () => Promise<User>;
  retryBootstrap: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export interface AuthProviderProps {
  children: React.ReactNode;
  repository?: AuthRepository;
}

export function AuthProvider({
  children,
  repository = defaultAuthRepository,
}: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<UserFacingError | null>(null);
  const cacheScope = useRef<string | null>(null);
  const cleanupBarrier = useRef(new AccountCleanupBarrier()).current;
  const authCommitBarrier = useRef(new AuthCommitBarrier()).current;

  const clearAccountStorageBoundary = useCallback(async (
    scope: string | null,
    includeOfflineIdentity = true,
  ) => {
    const failures: string[] = [];
    const failedBoundaries: string[] = [];
    try {
      await clearOfflineDownloads(scope);
    } catch (error) {
      failedBoundaries.push('offline-audio');
      failures.push(`offline audio: ${(error as Error).message}`);
    }
    if (includeOfflineIdentity) {
      try {
        await clearOfflineIdentity();
      } catch (error) {
        failedBoundaries.push('offline-identity');
        failures.push(`offline identity: ${(error as Error).message}`);
      }
    }
    try {
      await clearAccountScopedStorage(AsyncStorage, scope);
    } catch (error) {
      failedBoundaries.push('async-storage');
      failures.push(`account storage: ${(error as Error).message}`);
    }
    if (failures.length > 0) {
      console.warn(
        `[LoggeRythm] account storage cleanup failed: ${failedBoundaries.join(',')}`,
      );
      throw new Error(failures.join('; '));
    }
  }, []);

  const persistValidatedIdentity = useCallback(async (
    authenticated: User,
    expectedRevision: number,
  ): Promise<User> => {
    authCommitBarrier.assertCurrent(expectedRevision);
    const apiBase = await getApiBase();
    authCommitBarrier.assertCurrent(expectedRevision);
    await persistOfflineIdentity(authenticated, apiBase);
    authCommitBarrier.assertCurrent(expectedRevision);
    return authenticated;
  }, [authCommitBarrier]);

  const enterSignedOutState = useCallback(async (
    invalidationAuthority?: SessionInvalidationAuthority,
  ): Promise<void> => {
    authCommitBarrier.invalidate();
    const cleanupScope = cacheScope.current ?? cleanupBarrier.accountScope;
    cleanupBarrier.require(cleanupScope);
    // Remove account-owned screens synchronously, before the first native or
    // storage await. This prevents an authoritative 401 from leaving stale UI
    // mounted while its account boundary is being erased.
    setUser(null);
    setOfflineMode(false);
    const failures: string[] = [];
    try {
      await clearAuthoritativeSessionAuthority(invalidationAuthority);
    } catch (error) {
      failures.push((error as Error).message);
    }
    try {
      // The shared authority boundary already erased the offline identity.
      await clearAccountStorageBoundary(cleanupScope, false);
    } catch (error) {
      failures.push((error as Error).message);
    }
    try {
      await clearAccountQueryStateBoundary(queryClient);
    } catch (error) {
      failures.push((error as Error).message);
    }
    cacheScope.current = null;
    if (failures.length > 0) throw new Error(failures.join('; '));
    cleanupBarrier.complete();
  }, [authCommitBarrier, cleanupBarrier, clearAccountStorageBoundary, queryClient]);

  const enterAuthenticatedState = useCallback(
    async (authenticated: User, expectedRevision: number): Promise<void> => {
      const nextScope = musicCacheScope(await getApiBase(), authenticated.id);
      authCommitBarrier.assertCurrent(expectedRevision);
      if (cacheScope.current !== null && cacheScope.current !== nextScope) {
        // A /me response must never silently change identity while account data
        // is mounted. Explicit login/register switches are cleaned before their
        // replacement credential is created below; an unexpected identity drift
        // is safer to reject and sign out completely.
        const cleanupFailures: string[] = [];
        try {
          await clearSession();
        } catch (error) {
          cleanupFailures.push((error as Error).message);
        }
        try {
          await enterSignedOutState();
        } catch (error) {
          cleanupFailures.push((error as Error).message);
        }
        const cleanupDetail = cleanupFailures.length > 0
          ? ` Local cleanup also failed: ${cleanupFailures.join('; ')}`
          : '';
        throw new Error(
          `The authenticated account changed unexpectedly; sign in again.${cleanupDetail}`,
        );
      }
      authCommitBarrier.assertCurrent(expectedRevision);
      if (cacheScope.current !== nextScope) clearAccountQueryState(queryClient);
      cacheScope.current = nextScope;
      setUser(authenticated);
      setOfflineMode(false);
    },
    [authCommitBarrier, enterSignedOutState, queryClient],
  );

  const enterOfflineAuthenticatedState = useCallback(async (
    authenticated: User,
    expectedRevision: number,
  ): Promise<void> => {
    await enterAuthenticatedState(authenticated, expectedRevision);
    authCommitBarrier.assertCurrent(expectedRevision);
    setOfflineMode(true);
  }, [authCommitBarrier, enterAuthenticatedState]);

  const authenticateReplacingAccount = useCallback(
    async (authenticate: () => Promise<User>): Promise<User> => {
      const pendingInvalidation = pendingInvalidationAuthority();
      if (pendingInvalidation !== null) {
        // A failed or still-running authoritative cleanup owns the session
        // commit gate. Retry/join that exact opaque boundary before a login
        // response can reach SecureStore.
        await clearAuthoritativeSessionAuthority(pendingInvalidation);
      }
      const departingScope = cacheScope.current ?? cleanupBarrier.accountScope;
      if (cacheScope.current === null && !cleanupBarrier.needsCleanup) return authenticate();

      // Unmount account-owned screens before the first asynchronous cleanup
      // boundary so their local errors/forms cannot survive the switch.
      setUser(null);
      setBootstrapError(null);
      setBootstrapping(true);
      authCommitBarrier.invalidate();
      cleanupBarrier.require(departingScope);
      cacheScope.current = null;
      try {
        return await performAccountSwitch({
          clearPlayerSession,
          clearAccountStorage: () => clearAccountStorageBoundary(departingScope),
          clearLocalSession: clearSession,
          clearQueryState: () => clearAccountQueryStateBoundary(queryClient),
          authenticate: () => {
            // performAccountSwitch reaches this callback only after every local
            // boundary, including native cache eviction, has succeeded.
            cleanupBarrier.complete();
            return authenticate();
          },
        });
      } catch (error) {
        setBootstrapError(presentError(error, strings.auth.accountChangeFailed));
        setBootstrapping(false);
        throw error;
      }
    },
    [authCommitBarrier, cleanupBarrier, clearAccountStorageBoundary, queryClient],
  );

  const bootstrap = useCallback(async () => {
    setBootstrapping(true);
    setBootstrapError(null);
    let identityRevision = authCommitBarrier.capture();
    try {
      const result = await restoreSession({
        hasStoredSession: async () => !cleanupBarrier.needsCleanup && await hasSession(),
        readCurrentUser: async () => {
          identityRevision = authCommitBarrier.capture();
          return persistValidatedIdentity(await repository.me(), identityRevision);
        },
        enterSignedOutState,
        enterAuthenticatedState: (authenticated) =>
          enterAuthenticatedState(authenticated, identityRevision),
        enterOfflineAuthenticatedState: (authenticated) =>
          enterOfflineAuthenticatedState(authenticated, identityRevision),
        isUnauthorized: (error) => error instanceof ApiError && error.status === 401,
        isOfflineEligible: (error) => {
          if (error instanceof UnsupportedServerError) return false;
          if (error instanceof ServerCompatibilityCheckError) return true;
          return error instanceof ApiError
            && (error.status === 0
              || error.status === 408
              || error.status === 425
              || error.status === 429
              || error.status >= 500);
        },
        readOfflineUser: async () => {
          identityRevision = authCommitBarrier.capture();
          const authenticated = await readOfflineIdentity(await getApiBase());
          authCommitBarrier.assertCurrent(identityRevision);
          return authenticated;
        },
      });
      if (result.kind === 'error') {
        setBootstrapError(presentError(result.cause, strings.auth.restoreFailedMessage));
      }
    } finally {
      setBootstrapping(false);
    }
  }, [
    cleanupBarrier,
    authCommitBarrier,
    enterAuthenticatedState,
    enterOfflineAuthenticatedState,
    enterSignedOutState,
    persistValidatedIdentity,
    repository,
  ]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void bootstrap();
    });
    return () => {
      active = false;
    };
  }, [bootstrap]);

  useEffect(
    () =>
      onSessionInvalidated((invalidationAuthority) => {
        // Keep the login/register gate closed until the authoritative-401
        // cleanup finishes. A fast replacement credential must not race a
        // still-running player, storage, mutation, or session boundary.
        setBootstrapping(true);
        void enterSignedOutState(invalidationAuthority).then(
          () => {
            setBootstrapError(null);
            setBootstrapping(false);
          },
          (error) => {
            setBootstrapError(presentError(error, strings.auth.accountCleanupFailed));
            setBootstrapping(false);
          },
        );
      }),
    [enterSignedOutState],
  );

  const login = useCallback(async (email: string, password: string, apiBase: string) => {
    let identityRevision = authCommitBarrier.capture();
    try {
      const authenticated = await authenticateReplacingAccount(
        () => {
          identityRevision = authCommitBarrier.capture();
          return repository.login(email, password, apiBase);
        },
      );
      setBootstrapError(null);
      await enterAuthenticatedState(
        await persistValidatedIdentity(authenticated, identityRevision),
        identityRevision,
      );
    } finally {
      setBootstrapping(false);
    }
  }, [authCommitBarrier, authenticateReplacingAccount, enterAuthenticatedState, persistValidatedIdentity, repository]);

  const register = useCallback(async (request: RegisterRequest, apiBase: string) => {
    let identityRevision = authCommitBarrier.capture();
    try {
      const authenticated = await authenticateReplacingAccount(() => {
        identityRevision = authCommitBarrier.capture();
        return repository.register(request, apiBase);
      });
      setBootstrapError(null);
      // Gate derives pending/authenticated directly from this returned User.
      await enterAuthenticatedState(
        await persistValidatedIdentity(authenticated, identityRevision),
        identityRevision,
      );
    } finally {
      setBootstrapping(false);
    }
  }, [authCommitBarrier, authenticateReplacingAccount, enterAuthenticatedState, persistValidatedIdentity, repository]);

  const leaveSession = useCallback(async (revokeServerSession: boolean) => {
    authCommitBarrier.invalidate();
    const departingScope = cacheScope.current ?? cleanupBarrier.accountScope;
    const departingApiBase = getCurrentApiBase();
    setUser(null);
    setOfflineMode(false);
    setBootstrapError(null);
    // Keep the login form gated until all local/session cleanup and the bounded
    // server consistency call finish. Otherwise a fast re-login can install a
    // new credential while the departing logout is still deleting SecureStore.
    setBootstrapping(true);
    cleanupBarrier.require(departingScope);
    let failure: Error | null = null;
    try {
      await performLogout({
        revokeServerSession: revokeServerSession
          ? () => repository.logout(departingApiBase)
          : async () => undefined,
        clearPlayerSession,
        clearAccountStorage: () => clearAccountStorageBoundary(departingScope),
        clearLocalSession: clearSession,
        clearQueryState: () => clearAccountQueryStateBoundary(queryClient),
      });
    } catch (error) {
      failure = error as Error;
    }
    cacheScope.current = null;
    if (failure !== null) {
      setBootstrapError(presentError(
        failure,
        revokeServerSession
          ? strings.auth.logoutFailedMessage
          : strings.auth.forgetSessionFailed,
      ));
      setBootstrapping(false);
      throw failure;
    }
    cleanupBarrier.complete();
    setBootstrapError(null);
    setBootstrapping(false);
  }, [authCommitBarrier, cleanupBarrier, clearAccountStorageBoundary, queryClient, repository]);

  const logout = useCallback(
    () => leaveSession(true),
    [leaveSession],
  );

  const forgetSession = useCallback(
    () => leaveSession(false),
    [leaveSession],
  );

  const deleteAccount = useCallback(async () => {
    const departingScope = cacheScope.current ?? cleanupBarrier.accountScope;
    try {
      await performAccountDeletion({
        deleteServerAccount: async () => {
          await repository.deleteMe();
          authCommitBarrier.invalidate();
          // Only commit the barrier after remote deletion succeeds. A rejected
          // deletion leaves the still-valid authenticated account untouched.
          cleanupBarrier.require(departingScope);
          setUser(null);
          setOfflineMode(false);
        },
        clearPlayerSession,
        clearAccountStorage: () => clearAccountStorageBoundary(departingScope),
        clearLocalSession: clearSession,
        clearQueryState: () => clearAccountQueryStateBoundary(queryClient),
      });
      cacheScope.current = null;
      cleanupBarrier.complete();
      setUser(null);
      setOfflineMode(false);
      setBootstrapError(null);
    } catch (error) {
      if (error instanceof DeletedAccountCleanupError) {
        cacheScope.current = null;
        setUser(null);
        setOfflineMode(false);
        setBootstrapError(presentError(error, strings.auth.accountCleanupFailed));
      }
      throw error;
    }
  }, [authCommitBarrier, cleanupBarrier, clearAccountStorageBoundary, queryClient, repository]);

  const refreshUser = useCallback(async (): Promise<User> => {
    const identityRevision = authCommitBarrier.capture();
    return refreshAuthenticatedUser({
      readCurrentUser: async () =>
        persistValidatedIdentity(await repository.me(), identityRevision),
      enterAuthenticatedState: (authenticated) =>
        enterAuthenticatedState(authenticated, identityRevision),
    });
  }, [authCommitBarrier, enterAuthenticatedState, persistValidatedIdentity, repository]);

  const value = useMemo(
    () => ({
      user,
      offlineMode,
      bootstrapping,
      bootstrapError,
      login,
      register,
      logout,
      forgetSession,
      deleteAccount,
      refreshUser,
      retryBootstrap: bootstrap,
    }),
    [user, offlineMode, bootstrapping, bootstrapError, login, register, logout, forgetSession, deleteAccount, refreshUser, bootstrap],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
