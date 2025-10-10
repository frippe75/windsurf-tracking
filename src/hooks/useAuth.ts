import { useState, useEffect, useCallback } from 'react';
import { config } from '@/lib/config';

interface AuthUser {
  id: string;
  email: string;
  username: string;
}

interface AuthConfig {
  auth_required: boolean;
  auth_types: string[];
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthRequired: boolean;
  isLoading: boolean;
  isChecking: boolean;
}

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';

export const useAuth = () => {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthRequired: false,
    isLoading: true,
    isChecking: true,
  });

  // Check backend auth config
  const checkAuthConfig = useCallback(async () => {
    try {
      const backendUrl = config.backendUrl; // Get current backend URL dynamically
      const response = await fetch(`${backendUrl}/auth/config`);
      if (!response.ok) {
        // If endpoint doesn't exist, assume no auth required
        setState(prev => ({ ...prev, isAuthRequired: false, isChecking: false }));
        return;
      }
      
      const authConfig: AuthConfig = await response.json();
      setState(prev => ({ 
        ...prev, 
        isAuthRequired: authConfig.auth_required,
        isChecking: false 
      }));
    } catch (error) {
      console.error('Failed to check auth config:', error);
      setState(prev => ({ ...prev, isAuthRequired: false, isChecking: false }));
    }
  }, []);

  // Load stored auth on mount
  useEffect(() => {
    const loadStoredAuth = async () => {
      // Load backend settings FIRST (synchronously before auth check)
      const backendSettings = localStorage.getItem('backend_settings');
      if (backendSettings) {
        try {
          const settings = JSON.parse(backendSettings);
          if (settings.selected?.url) {
            (window as any).__LOVABLE_BACKEND_URL__ = settings.selected.url;
          }
        } catch {
          // Ignore parsing errors
        }
      }

      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const userStr = localStorage.getItem(AUTH_USER_KEY);
      
      if (token && userStr) {
        try {
          const user = JSON.parse(userStr);
          setState(prev => ({ ...prev, token, user, isLoading: false }));
        } catch {
          localStorage.removeItem(AUTH_TOKEN_KEY);
          localStorage.removeItem(AUTH_USER_KEY);
          setState(prev => ({ ...prev, isLoading: false }));
        }
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }

      await checkAuthConfig();
    };

    loadStoredAuth();
  }, [checkAuthConfig]);

  // Login
  const login = useCallback(async (email: string, password: string) => {
    try {
      const backendUrl = config.backendUrl; // Get current backend URL dynamically
      const response = await fetch(`${backendUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Login failed');
      }

      const data = await response.json();
      const user: AuthUser = {
        id: data.user_id,
        email: data.email,
        username: data.username,
      };

      localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));

      setState(prev => ({ 
        ...prev, 
        token: data.access_token, 
        user 
      }));

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Login failed' 
      };
    }
  }, []);

  // Logout
  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    setState(prev => ({ ...prev, token: null, user: null }));
  }, []);

  // Get auth header
  const getAuthHeader = useCallback(() => {
    return state.token ? { Authorization: `Bearer ${state.token}` } : {};
  }, [state.token]);

  return {
    user: state.user,
    token: state.token,
    isAuthRequired: state.isAuthRequired,
    isAuthenticated: !!state.token,
    isLoading: state.isLoading,
    isChecking: state.isChecking,
    login,
    logout,
    getAuthHeader,
    checkAuthConfig,
  };
};
