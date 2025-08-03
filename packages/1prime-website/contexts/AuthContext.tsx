'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);

  const checkAuth = async (): Promise<boolean> => {
    try {
      const storedToken = localStorage.getItem('authToken');
      if (!storedToken) {
        setIsAuthenticated(false);
        setToken(null);
        return false;
      }

      // Verify token by making a request to a protected endpoint
      const response = await fetch(
        'https://shortcut-auth.tanweihup.workers.dev/api/random-number',
        {
          headers: {
            Authorization: `Bearer ${storedToken}`,
          },
        },
      );

      if (response.ok) {
        setIsAuthenticated(true);
        setToken(storedToken);
        return true;
      } else {
        // Token is invalid, remove it
        localStorage.removeItem('authToken');
        setIsAuthenticated(false);
        setToken(null);
        return false;
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setIsAuthenticated(false);
      setToken(null);
      return false;
    }
  };

  const login = (newToken: string) => {
    localStorage.setItem('authToken', newToken);
    setToken(newToken);
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setToken(null);
    setIsAuthenticated(false);
  };

  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);
      await checkAuth();
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const value = {
    isAuthenticated,
    isLoading,
    token,
    login,
    logout,
    checkAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
