import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api/endpoints';
import {
  ApiError,
  clearSession,
  hasSession,
  onSessionInvalidated,
} from '../api/client';
import type { User } from '../api/types';
import { clearPlayerSession } from '../player/setup';

interface AuthState {
  user: User | null;
  bootstrapping: boolean;
  bootstrapError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User>;
  retryBootstrap: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    setBootstrapping(true);
    setBootstrapError(null);
    try {
      if (!(await hasSession())) {
        clearPlayerSession();
        setUser(null);
        return;
      }
      setUser(await api.me());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // apiRequest has authoritatively invalidated and removed this session.
        setUser(null);
      } else {
        setBootstrapError((error as Error).message);
      }
    } finally {
      setBootstrapping(false);
    }
  }, []);

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
      onSessionInvalidated(() => {
        try {
          clearPlayerSession();
        } catch (error) {
          setBootstrapError((error as Error).message);
        }
        setUser(null);
      }),
    [],
  );

  const login = useCallback(async (email: string, password: string) => {
    const authenticated = await api.login(email, password);
    setBootstrapError(null);
    setUser(authenticated);
  }, []);

  const logout = useCallback(async () => {
    const failures: string[] = [];
    try {
      clearPlayerSession();
    } catch (error) {
      failures.push((error as Error).message);
    }
    try {
      await clearSession();
    } catch (error) {
      failures.push((error as Error).message);
    }
    setUser(null);
    if (failures.length > 0) {
      const message = `Logout was incomplete: ${failures.join('; ')}`;
      setBootstrapError(message);
      throw new Error(message);
    }
    setBootstrapError(null);
  }, []);

  const refreshUser = useCallback(async (): Promise<User> => {
    const refreshed = await api.me();
    setUser(refreshed);
    return refreshed;
  }, []);

  const value = useMemo(
    () => ({
      user,
      bootstrapping,
      bootstrapError,
      login,
      logout,
      refreshUser,
      retryBootstrap: bootstrap,
    }),
    [user, bootstrapping, bootstrapError, login, logout, refreshUser, bootstrap],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
