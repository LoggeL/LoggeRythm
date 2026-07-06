import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api/endpoints';
import { clearSession, getSessionToken } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  /** True while we're checking a persisted session on launch. */
  bootstrapping: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await getSessionToken();
        if (token) {
          setUser(await api.me());
        }
      } catch {
        // Stored session is invalid/expired — drop it and show the login screen.
        await clearSession();
        setUser(null);
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await api.login(email, password);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      await clearSession();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, bootstrapping, login, logout }),
    [user, bootstrapping, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
