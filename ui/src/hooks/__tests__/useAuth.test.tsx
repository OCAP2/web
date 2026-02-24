import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { AuthProvider, useAuth } from "../useAuth";
import type { Auth } from "../useAuth";
import { setAuthToken } from "../../data/api-client";

// ─── Mock ApiClient ───

const mockGetMe = vi.fn();
const mockLogout = vi.fn();
const mockGetSteamLoginUrl = vi.fn().mockReturnValue("/api/v1/auth/steam");
const mockConsumeAuthCookie = vi.fn().mockReturnValue(false);

vi.mock("../../data/api-client", async () => {
  const actual = await vi.importActual<typeof import("../../data/api-client")>("../../data/api-client");
  return {
    ...actual,
    ApiClient: class {
      getMe = mockGetMe;
      logout = mockLogout;
      getSteamLoginUrl = mockGetSteamLoginUrl;
      consumeAuthCookie = mockConsumeAuthCookie;
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
    mockConsumeAuthCookie.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
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

  it("consumes auth cookie on mount", async () => {
    const { findByTestId } = render(() => (
      <AuthProvider>
        <TestConsumer onAuth={() => {}} />
      </AuthProvider>
    ));

    await findByTestId("authenticated");
    expect(mockConsumeAuthCookie).toHaveBeenCalled();
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

  it("logout sets authenticated to false", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockResolvedValue({ authenticated: true });
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

    await authRef.logout();
    expect(authRef.authenticated()).toBe(false);
    expect(mockLogout).toHaveBeenCalledOnce();
  });
});
