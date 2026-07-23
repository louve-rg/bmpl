import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { RoleCode } from '@bmpl/shared';
import { clearTokens, getAccessToken, mobileApi } from './api';

export interface MeView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  activeRole: RoleCode | null;
  roles: Array<{ roleCode: RoleCode; label: string; status: string; isSelectable: boolean }>;
}

interface AuthState {
  loading: boolean;
  me: MeView | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeView | null>(null);

  async function refreshMe() {
    try {
      const token = await getAccessToken();
      if (!token) {
        setMe(null);
        return;
      }
      setMe(await mobileApi.get<MeView>('/me'));
    } catch {
      setMe(null);
    }
  }

  useEffect(() => {
    void (async () => {
      await refreshMe();
      setLoading(false);
    })();
  }, []);

  async function signIn(email: string, password: string) {
    await mobileApi.login(email, password);
    await refreshMe();
  }

  async function signOut() {
    try {
      await mobileApi.post('/auth/logout');
    } catch {
      // ignore network errors on logout
    }
    await clearTokens();
    setMe(null);
  }

  return (
    <AuthContext.Provider value={{ loading, me, signIn, signOut, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
