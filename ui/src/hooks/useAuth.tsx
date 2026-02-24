import { createContext, useContext, createSignal, onMount } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ApiClient, getAuthToken } from "../data/api-client";

export interface Auth {
  authenticated: Accessor<boolean>;
  steamId: Accessor<string | null>;
  authError: Accessor<string | null>;
  dismissAuthError: () => void;
  loginWithSteam: () => void;
  logout: () => Promise<void>;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  steam_denied: "Your Steam account is not authorized for admin access.",
  steam_error: "Steam login failed. Please try again.",
};

const AuthContext = createContext<Auth>();

/**
 * Provider that checks session state on mount and exposes Steam login/logout actions app-wide.
 */
export function AuthProvider(props: { children: JSX.Element }): JSX.Element {
  const [authenticated, setAuthenticated] = createSignal(false);
  const [steamId, setSteamId] = createSignal<string | null>(null);
  const [authError, setAuthError] = createSignal<string | null>(null);
  const api = new ApiClient();

  onMount(async () => {
    // Check for auth error from Steam callback redirect
    const params = new URLSearchParams(window.location.search);
    const error = params.get("auth_error");
    if (error) {
      setAuthError(AUTH_ERROR_MESSAGES[error] ?? "Authentication failed.");
      // Clean URL without reloading
      const url = new URL(window.location.href);
      url.searchParams.delete("auth_error");
      window.history.replaceState({}, "", url.pathname + url.search);
    }

    // Check for token cookie from Steam callback redirect
    api.consumeAuthCookie();

    if (!getAuthToken()) {
      setAuthenticated(false);
      return;
    }
    try {
      const state = await api.getMe();
      setAuthenticated(state.authenticated);
      setSteamId(state.steamId ?? null);
    } catch {
      setAuthenticated(false);
    }
  });

  const dismissAuthError = () => setAuthError(null);

  const loginWithSteam = () => {
    setAuthError(null);
    window.location.href = api.getSteamLoginUrl();
  };

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
    } finally {
      setAuthenticated(false);
      setSteamId(null);
    }
  };

  return (
    <AuthContext.Provider value={{ authenticated, steamId, authError, dismissAuthError, loginWithSteam, logout }}>
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
