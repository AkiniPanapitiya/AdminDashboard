import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setUnauthorizedHandler, type User } from './lib/api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api<{ user: User }>('/auth/me')
      .then((result) => setUser(result.user))
      .catch((error: unknown) => {
        if (!(error instanceof ApiError) || error.status !== 401) setUser(null);
      })
      .finally(() => setLoading(false));
    return () => setUnauthorizedHandler(undefined);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } });
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
