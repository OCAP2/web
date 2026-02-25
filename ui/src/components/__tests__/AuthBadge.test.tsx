import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { AuthBadge } from "../AuthBadge";

// ─── Mock useAuth ───

const mockLoginWithSteam = vi.fn();
const mockLogout = vi.fn();

const authState = {
  authenticated: vi.fn(() => false),
  steamName: vi.fn(() => null as string | null),
  steamId: vi.fn(() => null as string | null),
  steamAvatar: vi.fn(() => null as string | null),
  authError: vi.fn(() => null),
  dismissAuthError: vi.fn(),
  loginWithSteam: mockLoginWithSteam,
  logout: mockLogout,
};

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => authState,
}));

// ─── Tests ───

describe("AuthBadge", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    authState.authenticated.mockReturnValue(false);
    authState.steamName.mockReturnValue(null);
    authState.steamId.mockReturnValue(null);
    authState.steamAvatar.mockReturnValue(null);
  });

  it("shows sign-in button when not authenticated", () => {
    const { getByText } = render(() => <AuthBadge />);
    expect(getByText("Sign in")).toBeDefined();
  });

  it("calls loginWithSteam on sign-in click", async () => {
    const { getByText } = render(() => <AuthBadge />);
    fireEvent.click(getByText("Sign in"));
    expect(mockLoginWithSteam).toHaveBeenCalledOnce();
  });

  it("shows admin badge when authenticated", () => {
    authState.authenticated.mockReturnValue(true);
    authState.steamName.mockReturnValue("TestPlayer");

    const { getByText, queryByText } = render(() => <AuthBadge />);
    expect(getByText("TestPlayer")).toBeDefined();
    expect(getByText("ADMIN")).toBeDefined();
    expect(queryByText("Sign in")).toBeNull();
  });

  it("shows steamId when steamName is not available", () => {
    authState.authenticated.mockReturnValue(true);
    authState.steamId.mockReturnValue("76561198012345678");

    const { getByText } = render(() => <AuthBadge />);
    expect(getByText("76561198012345678")).toBeDefined();
  });

  it("shows fallback 'Admin' when no name or id", () => {
    authState.authenticated.mockReturnValue(true);

    const { getByText } = render(() => <AuthBadge />);
    expect(getByText("Admin")).toBeDefined();
  });

  it("shows avatar image when steamAvatar is set", () => {
    authState.authenticated.mockReturnValue(true);
    authState.steamAvatar.mockReturnValue("https://avatars.steamstatic.com/abc.jpg");

    const { getByTestId } = render(() => <AuthBadge />);
    const img = getByTestId("admin-avatar") as HTMLImageElement;
    expect(img.src).toBe("https://avatars.steamstatic.com/abc.jpg");
  });

  it("shows placeholder when no avatar", () => {
    authState.authenticated.mockReturnValue(true);

    const { getByText, queryByTestId } = render(() => <AuthBadge />);
    expect(getByText("A")).toBeDefined();
    expect(queryByTestId("admin-avatar")).toBeNull();
  });

  it("calls logout on sign-out click", async () => {
    authState.authenticated.mockReturnValue(true);

    const { getByTitle } = render(() => <AuthBadge />);
    fireEvent.click(getByTitle("Sign out"));
    expect(mockLogout).toHaveBeenCalledOnce();
  });
});
