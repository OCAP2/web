import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { AuthProvider, useAuth } from "../useAuth";
import type { Auth } from "../useAuth";
import { setAuthToken } from "../../data/api-client";

// ─── Mock ApiClient ───

const mockGetMe = vi.fn();
const mockLogin = vi.fn();
const mockLogout = vi.fn();

vi.mock("../../data/api-client", async () => {
  const actual = await vi.importActual<typeof import("../../data/api-client")>("../../data/api-client");
  return {
    ...actual,
    ApiClient: class {
      getMe = mockGetMe;
      login = mockLogin;
      logout = mockLogout;
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
    mockLogin.mockResolvedValue({ authenticated: true });
    mockLogout.mockResolvedValue(undefined);
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

  it("checks session on mount via getMe when token exists", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockResolvedValue({ authenticated: true });

    const { findByText } = render(() => (
      <AuthProvider>
        <TestConsumer onAuth={() => {}} />
      </AuthProvider>
    ));

    expect(await findByText("true")).toBeDefined();
    expect(mockGetMe).toHaveBeenCalledOnce();
  });

  it("sets authenticated to true when getMe returns authenticated", async () => {
    setAuthToken("stored-jwt");
    mockGetMe.mockResolvedValue({ authenticated: true });

    const { findByText } = render(() => (
      <AuthProvider>
        <TestConsumer onAuth={() => {}} />
      </AuthProvider>
    ));

    expect(await findByText("true")).toBeDefined();
  });

  it("login sets authenticated to true on success", async () => {
    mockGetMe.mockResolvedValue({ authenticated: false });
    mockLogin.mockResolvedValue({ authenticated: true });

    let authRef!: Auth;
    render(() => (
      <AuthProvider>
        <TestConsumer onAuth={(a) => { authRef = a; }} />
      </AuthProvider>
    ));

    // Wait for mount to settle
    await vi.waitFor(() => {
      expect(authRef).toBeDefined();
    });

    const result = await authRef.login("correct-secret");
    expect(result).toBe(true);
    expect(authRef.authenticated()).toBe(true);
    expect(mockLogin).toHaveBeenCalledWith("correct-secret");
  });

  it("login returns false on failure", async () => {
    mockGetMe.mockResolvedValue({ authenticated: false });
    mockLogin.mockRejectedValue(new Error("401 Unauthorized"));

    let authRef!: Auth;
    render(() => (
      <AuthProvider>
        <TestConsumer onAuth={(a) => { authRef = a; }} />
      </AuthProvider>
    ));

    await vi.waitFor(() => {
      expect(authRef).toBeDefined();
    });

    const result = await authRef.login("wrong-secret");
    expect(result).toBe(false);
    expect(authRef.authenticated()).toBe(false);
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
