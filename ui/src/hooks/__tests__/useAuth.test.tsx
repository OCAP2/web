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
const mockPopReturnTo = vi.fn().mockReturnValue(null);

vi.mock("../../data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../data/apiClient")>("../../data/apiClient");
  return {
    ...actual,
    ApiClient: class {
      getMe = mockGetMe;
      logout = mockLogout;
      getSteamLoginUrl = mockGetSteamLoginUrl;
      consumeAuthToken = mockConsumeAuthToken;
      popReturnTo = mockPopReturnTo;
    },
  };
});

// ─── Test helpers ───

function TestConsumer(props: { onAuth: (auth: Auth) => void }) {
  const auth = useAuth();
  props.onAuth(auth);
  return <div data-testid="authenticated">{String(auth.authenticated())}</div>;
}

function renderAuth(onAuth: (a: Auth) => void = () => {}) {
  return render(() => (
    <AuthProvider>
      <TestConsumer onAuth={onAuth} />
    </AuthProvider>
  ));
}

// ─── Tests ───

describe("useAuth", () => {
  beforeEach(() => {
    mockGetMe.mockResolvedValue({ authenticated: false });
    mockLogout.mockResolvedValue(undefined);
    mockConsumeAuthToken.mockReturnValue(false);
    mockPopReturnTo.mockReturnValue(null);
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
    const { findByTestId } = renderAuth();

    await findByTestId("authenticated");
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("consumes auth token from URL params on mount", async () => {
    const { findByTestId } = renderAuth();

    await findByTestId("authenticated");
    expect(mockConsumeAuthToken).toHaveBeenCalled();
  });

  it("falls back to unauthenticated when getMe throws", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockRejectedValue(new Error("network error"));

    const { findByText } = renderAuth();

    expect(await findByText("false")).toBeDefined();
  });

  it("checks session on mount via getMe when token exists", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockResolvedValue({ authenticated: true, steamId: "76561198012345678" });

    const { findByText } = renderAuth();

    expect(await findByText("true")).toBeDefined();
    expect(mockGetMe).toHaveBeenCalledOnce();
  });

  it("loginWithSteam redirects to Steam login URL with current path", async () => {
    // Mock window.location with pathname and search
    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      value: {
        ...window.location,
        pathname: "/recording/42/my-mission",
        search: "",
        get href() { return "http://localhost/recording/42/my-mission"; },
        set href(v: string) { hrefSetter(v); },
      },
      writable: true,
      configurable: true,
    });

    let authRef!: Auth;
    renderAuth((a) => { authRef = a; });

    await vi.waitFor(() => {
      expect(authRef).toBeDefined();
    });

    authRef.loginWithSteam();
    expect(hrefSetter).toHaveBeenCalledWith("/api/v1/auth/steam");
    expect(mockGetSteamLoginUrl).toHaveBeenCalledWith("/recording/42/my-mission");
  });

  it("restores saved path after successful auth callback", async () => {
    mockConsumeAuthToken.mockReturnValue(true);
    mockPopReturnTo.mockReturnValue("/recording/42/my-mission");

    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?auth_token=jwt123", href: window.location.origin + "/?auth_token=jwt123", pathname: "/" },
      writable: true,
      configurable: true,
    });

    const { findByTestId } = renderAuth();
    await findByTestId("authenticated");

    expect(mockPopReturnTo).toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledWith({}, "", "/recording/42/my-mission");
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(PopStateEvent));

    replaceStateSpy.mockRestore();
    dispatchEventSpy.mockRestore();
  });

  it("reads auth_error from URL and sets authError signal", async () => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?auth_error=steam_error", href: window.location.origin + "/?auth_error=steam_error", pathname: "/" },
      writable: true,
      configurable: true,
    });

    let authRef!: Auth;
    renderAuth((a) => { authRef = a; });

    await vi.waitFor(() => {
      expect(authRef).toBeDefined();
      expect(authRef.authError()).toBe("Steam login failed. Please try again.");
    });
  });

  it("dismissAuthError clears the error", async () => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?auth_error=steam_error", href: window.location.origin + "/?auth_error=steam_error", pathname: "/" },
      writable: true,
      configurable: true,
    });

    let authRef!: Auth;
    renderAuth((a) => { authRef = a; });

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
    renderAuth((a) => { authRef = a; });

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
    const { findByText } = renderAuth((a) => { authRef = a; });

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

  it("exposes role and isAdmin from getMe", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockResolvedValue({
      authenticated: true,
      role: "admin",
      steamId: "76561198012345678",
    });

    let authRef!: Auth;
    renderAuth((a) => { authRef = a; });

    await vi.waitFor(() => {
      expect(authRef.role()).toBe("admin");
      expect(authRef.isAdmin()).toBe(true);
    });
  });

  it("viewer role sets isAdmin to false", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockResolvedValue({
      authenticated: true,
      role: "viewer",
      steamId: "76561198012345678",
    });

    let authRef!: Auth;
    renderAuth((a) => { authRef = a; });

    await vi.waitFor(() => {
      expect(authRef.role()).toBe("viewer");
      expect(authRef.isAdmin()).toBe(false);
    });
  });

  it("logout clears role", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockResolvedValue({
      authenticated: true,
      role: "admin",
      steamId: "76561198012345678",
    });
    mockLogout.mockResolvedValue(undefined);

    let authRef!: Auth;
    const { findByText } = renderAuth((a) => { authRef = a; });

    await findByText("true");
    expect(authRef.role()).toBe("admin");
    expect(authRef.isAdmin()).toBe(true);

    await authRef.logout();
    expect(authRef.role()).toBeNull();
    expect(authRef.isAdmin()).toBe(false);
  });
});
