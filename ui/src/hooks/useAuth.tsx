import { createContext, useContext, createSignal, createMemo, onMount } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ApiClient, getAuthToken } from "../data/apiClient";

export interface Auth {
  authenticated: Accessor<boolean>;
  role: Accessor<string | null>;
  isAdmin: Accessor<boolean>;
  steamId: Accessor<string | null>;
  steamName: Accessor<string | null>;
  steamAvatar: Accessor<string | null>;
  authError: Accessor<string | null>;
  authMode: Accessor<string>;
  dismissAuthError: () => void;
  loginWithSteam: () => void;
  loginWithPassword: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  steam_error: "Steam login failed. Please try again.",
  not_allowed: "You are not on the allowlist. Contact an admin for access.",
};

const AuthContext = createContext<Auth>();

/**
 * Provider that checks session state on mount and exposes Steam login/logout actions app-wide.
 */
export function AuthProvider(props: { children: JSX.Element }): JSX.Element {
  const [authenticated, setAuthenticated] = createSignal(false);
  const [role, setRole] = createSignal<string | null>(null);
  const isAdmin = createMemo(() => role() === "admin");
  const [steamId, setSteamId] = createSignal<string | null>(null);
  const [steamName, setSteamName] = createSignal<string | null>(null);
  const [steamAvatar, setSteamAvatar] = createSignal<string | null>(null);
  const [authError, setAuthError] = createSignal<string | null>(null);
  const [authMode, setAuthMode] = createSignal<string>("public");
  const api = new ApiClient();

  onMount(async () => {
    // Fetch auth config first
    try {
      const config = await api.getAuthConfig();
      setAuthMode(config.mode);
    } catch {
      // Default to public if endpoint fails
    }

    // Read query params from Steam callback redirect
    const params = new URLSearchParams(window.location.search);

    const error = params.get("auth_error");
    if (error) {
      setAuthError(AUTH_ERROR_MESSAGES[error] ?? "Authentication failed.");
    }

    const hadToken = api.consumeAuthToken(params);

    // Clean auth params from URL and restore pre-login path
    if (params.has("auth_error") || params.has("auth_token")) {
      params.delete("auth_error");
      params.delete("auth_token");
      const returnTo = hadToken ? api.popReturnTo() : null;
      if (returnTo && returnTo !== "/") {
        // replaceState + popstate triggers the SolidJS router to re-evaluate
        window.history.replaceState({}, "", returnTo);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } else {
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? "?" + qs : ""));
      }
    }

    if (!getAuthToken()) {
      setAuthenticated(false);
      return;
    }
    try {
      const state = await api.getMe();
      setAuthenticated(state.authenticated);
      setRole(state.role ?? null);
      setSteamId(state.steamId ?? null);
      setSteamName(state.steamName ?? null);
      setSteamAvatar(state.steamAvatar ?? null);
    } catch {
      setAuthenticated(false);
    }
  });

  const dismissAuthError = () => setAuthError(null);

  const loginWithPassword = async (password: string): Promise<void> => {
    setAuthError(null);
    try {
      await api.passwordLogin(password);
      const state = await api.getMe();
      setAuthenticated(state.authenticated);
      setRole(state.role ?? null);
      setSteamId(state.steamId ?? null);
      setSteamName(state.steamName ?? null);
      setSteamAvatar(state.steamAvatar ?? null);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Login failed");
    }
  };

  const loginWithSteam = () => {
    setAuthError(null);
    window.location.href = api.getSteamLoginUrl(
      window.location.pathname + window.location.search,
    );
  };

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
    } finally {
      setAuthenticated(false);
      setRole(null);
      setSteamId(null);
      setSteamName(null);
      setSteamAvatar(null);
    }
  };

  return (
    <AuthContext.Provider value={{ authenticated, role, isAdmin, steamId, steamName, steamAvatar, authError, authMode, dismissAuthError, loginWithSteam, loginWithPassword, logout }}>
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
