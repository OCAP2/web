import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { AuthProvider, useAuth } from "../useAuth";
import type { Auth } from "../useAuth";
import { setAuthToken } from "../../data/apiClient";

// ─── Mock ApiClient ───

const mockGetMe = vi.fn();
const mockLogout = vi.fn();
const mockGetSteamLoginUrl = vi.fn().mockReturnValue("/api/v1/auth/steam");
const mockConsumeAuthToken = vi.fn().mockReturnValue(false);

vi.mock("../../data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../data/apiClient")>("../../data/apiClient");
  return {
    ...actual,
    ApiClient: class {
      getMe = mockGetMe;
      logout = mockLogout;
      getSteamLoginUrl = mockGetSteamLoginUrl;
      consumeAuthToken = mockConsumeAuthToken;
    },
  };
});

// ─── Test consumer component ───

function TestConsumer(props: { onAuth: (auth: Auth) => void }) {
  const auth = useAuth();
  props.onAuth(auth);
  return <div data-testid="authenticated">{String(auth.authenticated())}</div>;
}

// ─── Tests ───

describe("useAuth", () => {
  beforeEach(() => {
    mockGetMe.mockResolvedValue({ authenticated: false });
    mockLogout.mockResolvedValue(undefined);
    mockConsumeAuthToken.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    setAuthToken(null);
  });

  it("throws when used outside AuthProvider", () => {
    expect(() => {
      render(() => {
        useAuth();
        return <div />;
      });
    }).toThrow("useAuth must be used within an AuthProvider");
  });

  it("skips getMe when no token is stored", async () => {
    const { findByTestId } = render(() => (
      <AuthProvider>
        <TestConsumer onAuth={() => {}} />
      </AuthProvider>
    ));

    await findByTestId("authenticated");
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("consumes auth token from URL params on mount", async () => {
    const { findByTestId } = render(() => (
      <AuthProvider>
        <TestConsumer onAuth={() => {}} />
      </AuthProvider>
    ));

    await findByTestId("authenticated");
    expect(mockConsumeAuthToken).toHaveBeenCalled();
  });

  it("falls back to unauthenticated when getMe throws", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockRejectedValue(new Error("network error"));

    const { findByText } = render(() => (
      <AuthProvider>
        <TestConsumer onAuth={() => {}} />
      </AuthProvider>
    ));

    expect(await findByText("false")).toBeDefined();
  });

  it("checks session on mount via getMe when token exists", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockResolvedValue({ authenticated: true, steamId: "76561198012345678" });

    const { findByText } = render(() => (
      <AuthProvider>
        <TestConsumer onAuth={() => {}} />
      </AuthProvider>
    ));

    expect(await findByText("true")).toBeDefined();
    expect(mockGetMe).toHaveBeenCalledOnce();
  });

  it("loginWithSteam redirects to Steam login URL", async () => {
    const originalLocation = window.location.href;
    // Mock window.location.href setter
    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, get href() { return originalLocation; }, set href(v: string) { hrefSetter(v); } },
      writable: true,
      configurable: true,
    });

    let authRef!: Auth;
    render(() => (
      <AuthProvider>
        <TestConsumer onAuth={(a) => { authRef = a; }} />
      </AuthProvider>
    ));

    await vi.waitFor(() => {
      expect(authRef).toBeDefined();
    });

    authRef.loginWithSteam();
    expect(hrefSetter).toHaveBeenCalledWith("/api/v1/auth/steam");
  });

  it("reads auth_error from URL and sets authError signal", async () => {
    // jsdom supports setting location via navigation
    const origSearch = window.location.search;
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?auth_error=steam_denied", href: window.location.origin + "/?auth_error=steam_denied", pathname: "/" },
      writable: true,
      configurable: true,
    });

    let authRef!: Auth;
    render(() => (
      <AuthProvider>
        <TestConsumer onAuth={(a) => { authRef = a; }} />
      </AuthProvider>
    ));

    await vi.waitFor(() => {
      expect(authRef).toBeDefined();
      expect(authRef.authError()).toBe("Your Steam account is not authorized for admin access.");
    });
  });

  it("dismissAuthError clears the error", async () => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?auth_error=steam_error", href: window.location.origin + "/?auth_error=steam_error", pathname: "/" },
      writable: true,
      configurable: true,
    });

    let authRef!: Auth;
    render(() => (
      <AuthProvider>
        <TestConsumer onAuth={(a) => { authRef = a; }} />
      </AuthProvider>
    ));

    await vi.waitFor(() => {
      expect(authRef.authError()).toBe("Steam login failed. Please try again.");
    });

    authRef.dismissAuthError();
    expect(authRef.authError()).toBeNull();
  });

  it("populates steamName and steamAvatar from getMe", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockResolvedValue({
      authenticated: true,
      steamId: "76561198012345678",
      steamName: "TestPlayer",
      steamAvatar: "https://avatars.steamstatic.com/abc.jpg",
    });

    let authRef!: Auth;
    render(() => (
      <AuthProvider>
        <TestConsumer onAuth={(a) => { authRef = a; }} />
      </AuthProvider>
    ));

    await vi.waitFor(() => {
      expect(authRef.steamName()).toBe("TestPlayer");
      expect(authRef.steamAvatar()).toBe("https://avatars.steamstatic.com/abc.jpg");
    });
  });

  it("logout clears steamName and steamAvatar", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockResolvedValue({
      authenticated: true,
      steamId: "76561198012345678",
      steamName: "TestPlayer",
      steamAvatar: "https://avatars.steamstatic.com/abc.jpg",
    });
    mockLogout.mockResolvedValue(undefined);

    let authRef!: Auth;
    const { findByText } = render(() => (
      <AuthProvider>
        <TestConsumer onAuth={(a) => { authRef = a; }} />
      </AuthProvider>
    ));

    // Wait until authenticated is true from getMe
    await findByText("true");
    expect(authRef.authenticated()).toBe(true);
    expect(authRef.steamName()).toBe("TestPlayer");
    expect(authRef.steamAvatar()).toBe("https://avatars.steamstatic.com/abc.jpg");

    await authRef.logout();
    expect(authRef.authenticated()).toBe(false);
    expect(authRef.steamName()).toBeNull();
    expect(authRef.steamAvatar()).toBeNull();
    expect(mockLogout).toHaveBeenCalledOnce();
  });
});
