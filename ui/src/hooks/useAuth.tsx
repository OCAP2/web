import { createContext, useContext, createSignal, onMount } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ApiClient, getAuthToken } from "../data/api-client";

export interface Auth {
  authenticated: Accessor<boolean>;
  login: (secret: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<Auth>();

/**
 * Provider that checks session state on mount and exposes login/logout actions app-wide.
 */
export function AuthProvider(props: { children: JSX.Element }): JSX.Element {
  const [authenticated, setAuthenticated] = createSignal(false);
  const api = new ApiClient();

  onMount(async () => {
    if (!getAuthToken()) {
      setAuthenticated(false);
      return;
    }
    try {
      const state = await api.getMe();
      setAuthenticated(state.authenticated);
    } catch {
      setAuthenticated(false);
    }
  });

  const login = async (secret: string): Promise<boolean> => {
    try {
      const state = await api.login(secret);
      setAuthenticated(state.authenticated);
      return state.authenticated;
    } catch {
      setAuthenticated(false);
      return false;
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
    } finally {
      setAuthenticated(false);
    }
  };

  return (
    <AuthContext.Provider value={{ authenticated, login, logout }}>
      {props.children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth state and actions from any component within the AuthProvider.
 */
export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
