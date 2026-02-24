import { createContext, useContext, createSignal, onMount } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ApiClient, getAuthToken } from "../data/api-client";

export interface Auth {
  authenticated: Accessor<boolean>;
  steamId: Accessor<string | null>;
  steamName: Accessor<string | null>;
  steamAvatar: Accessor<string | null>;
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
  const [steamName, setSteamName] = createSignal<string | null>(null);
  const [steamAvatar, setSteamAvatar] = createSignal<string | null>(null);
  const [authError, setAuthError] = createSignal<string | null>(null);
  const api = new ApiClient();

  onMount(async () => {
    // Read query params from Steam callback redirect
    const params = new URLSearchParams(window.location.search);

    const error = params.get("auth_error");
    if (error) {
      setAuthError(AUTH_ERROR_MESSAGES[error] ?? "Authentication failed.");
    }

    api.consumeAuthToken(params);

    // Clean auth params from URL without reloading
    if (params.has("auth_error") || params.has("auth_token")) {
      params.delete("auth_error");
      params.delete("auth_token");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? "?" + qs : ""));
    }

    if (!getAuthToken()) {
      setAuthenticated(false);
      return;
    }
    try {
      const state = await api.getMe();
      setAuthenticated(state.authenticated);
      setSteamId(state.steamId ?? null);
      setSteamName(state.steamName ?? null);
      setSteamAvatar(state.steamAvatar ?? null);
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
      setSteamName(null);
      setSteamAvatar(null);
    }
  };

  return (
    <AuthContext.Provider value={{ authenticated, steamId, steamName, steamAvatar, authError, dismissAuthError, loginWithSteam, logout }}>
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
