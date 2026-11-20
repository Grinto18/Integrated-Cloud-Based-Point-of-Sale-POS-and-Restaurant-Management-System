import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Role } from '../types.ts';
import { api, getAuthToken, setAuthToken, removeAuthToken, setSessionRestoring } from '../services/api.ts';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isLocked: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  pinLogin: (pin: string) => Promise<void>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  logout: () => void;
  lockTerminal: () => void;
  hasRole: (roles: Role[]) => boolean;
  isAdmin: boolean;
  isManager: boolean;
  isCashier: boolean;
  isKitchen: boolean;
  isInventory: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setSessionRestoring(false);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setSessionRestoring(true);
    api.getMe()
      .then((res) => {
        if (!cancelled) {
          setUser(res.user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          removeAuthToken();
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSessionRestoring(false);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      removeAuthToken();
      setUser(null);
      setIsLocked(false);
    };
    window.addEventListener('pos:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('pos:unauthorized', handleUnauthorized);
  }, []);

  const login = async (identifier: string, pass: string) => {
    const res = await api.login(identifier, pass);
    setAuthToken(res.token);
    setUser(res.user);
    setIsLocked(false);
  };

  const pinLogin = async (pin: string) => {
    const res = await api.pinLogin(pin);
    setAuthToken(res.token);
    setUser(res.user);
    setIsLocked(false);
  };

  const unlockWithPin = async (pin: string): Promise<boolean> => {
    try {
      const res = await api.pinLogin(pin);
      if (res.user) {
        if (res.token) {
          setAuthToken(res.token);
        }
        setUser(res.user);
        setIsLocked(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const logout = () => {
    const token = getAuthToken();
    if (token) {
      api.logout(token).catch(() => {});
    }
    removeAuthToken();
    setUser(null);
    setIsLocked(false);
  };

  const lockTerminal = () => {
    setIsLocked(true);
  };

  const hasRole = (roles: Role[]) => {
    if (!user) return false;
    if (user.role === 'ADMIN' || user.role === 'OWNER') return true;
    return roles.includes(user.role);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isLocked,
        login,
        pinLogin,
        unlockWithPin,
        logout,
        lockTerminal,
        hasRole,
        isAdmin: user?.role === 'ADMIN' || user?.role === 'OWNER',
        isManager: user?.role === 'MANAGER' || user?.role === 'ADMIN' || user?.role === 'OWNER',
        isCashier: user?.role === 'CASHIER' || user?.role === 'ADMIN' || user?.role === 'OWNER' || user?.role === 'MANAGER',
        isKitchen: user?.role === 'KITCHEN' || user?.role === 'ADMIN' || user?.role === 'OWNER',
        isInventory: user?.role === 'INVENTORY' || user?.role === 'ADMIN' || user?.role === 'OWNER' || user?.role === 'MANAGER',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
