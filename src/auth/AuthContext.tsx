import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, ApiError, setOnUnauthorized, TOKEN_KEY } from '../api/client';
import type { PublicUser } from '../api/types';

const USER_KEY = 'shelfstock_user';

// Cleanup hooks (e.g. push-token unregistration) that must run while the
// JWT is still valid, before logout clears it.
export const logoutHandlers: (() => Promise<void>)[] = [];

interface AuthState {
  user: PublicUser | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Restore a previous session; the 7-day JWT makes this usually valid.
    (async () => {
      try {
        const [token, rawUser] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (token && rawUser) setUser(JSON.parse(rawUser));
      } catch {
        // Corrupted stored session (e.g. malformed JSON) — treat as logged out.
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  const logout = useCallback(async () => {
    for (const handler of logoutHandlers) {
      await handler().catch(() => {}); // cleanup is best-effort
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    // Expired/invalid token on any request boots us back to login.
    setOnUnauthorized(() => {
      void logout();
    });
    return () => setOnUnauthorized(null);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: PublicUser; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res.user.role !== 'admin') {
      throw new ApiError(403, 'This app is for store admins.');
    }
    await SecureStore.setItemAsync(TOKEN_KEY, res.token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, initializing, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
