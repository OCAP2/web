import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { AuthBadge } from "../AuthBadge";
import { I18nProvider } from "../../hooks/useLocale";

// ─── Mock useAuth ───

const mockLoginWithSteam = vi.fn();
const mockLogout = vi.fn();

const authState = {
  authenticated: vi.fn(() => false),
  role: vi.fn(() => null as string | null),
  isAdmin: vi.fn(() => false),
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
    authState.role.mockReturnValue(null);
    authState.isAdmin.mockReturnValue(false);
    authState.steamName.mockReturnValue(null);
    authState.steamId.mockReturnValue(null);
    authState.steamAvatar.mockReturnValue(null);
  });

  it("shows sign-in button when not authenticated", () => {
    const { getByText } = render(() => <I18nProvider locale="en"><AuthBadge /></I18nProvider>);
    expect(getByText("Sign in")).toBeDefined();
  });

  it("calls loginWithSteam on sign-in click", async () => {
    const { getByText } = render(() => <I18nProvider locale="en"><AuthBadge /></I18nProvider>);
    fireEvent.click(getByText("Sign in"));
    expect(mockLoginWithSteam).toHaveBeenCalledOnce();
  });

  it("shows admin badge when authenticated as admin", () => {
    authState.authenticated.mockReturnValue(true);
    authState.isAdmin.mockReturnValue(true);
    authState.steamName.mockReturnValue("TestPlayer");

    const { getByText, queryByText } = render(() => <I18nProvider locale="en"><AuthBadge /></I18nProvider>);
    expect(getByText("TestPlayer")).toBeDefined();
    expect(getByText("ADMIN")).toBeDefined();
    expect(queryByText("Sign in")).toBeNull();
  });

  it("hides ADMIN label for non-admin authenticated users", () => {
    authState.authenticated.mockReturnValue(true);
    authState.isAdmin.mockReturnValue(false);
    authState.steamName.mockReturnValue("RegularUser");

    const { getByText, queryByText } = render(() => <I18nProvider locale="en"><AuthBadge /></I18nProvider>);
    expect(getByText("RegularUser")).toBeDefined();
    expect(queryByText("ADMIN")).toBeNull();
    expect(queryByText("Sign in")).toBeNull();
  });

  it("shows steamId when steamName is not available", () => {
    authState.authenticated.mockReturnValue(true);
    authState.steamId.mockReturnValue("76561198012345678");

    const { getByText } = render(() => <I18nProvider locale="en"><AuthBadge /></I18nProvider>);
    expect(getByText("76561198012345678")).toBeDefined();
  });

  it("shows fallback 'User' when no name or id", () => {
    authState.authenticated.mockReturnValue(true);

    const { getByText } = render(() => <I18nProvider locale="en"><AuthBadge /></I18nProvider>);
    expect(getByText("User")).toBeDefined();
  });

  it("shows avatar image when steamAvatar is set", () => {
    authState.authenticated.mockReturnValue(true);
    authState.steamAvatar.mockReturnValue("https://avatars.steamstatic.com/abc.jpg");

    const { getByTestId } = render(() => <I18nProvider locale="en"><AuthBadge /></I18nProvider>);
    const img = getByTestId("admin-avatar") as HTMLImageElement;
    expect(img.src).toBe("https://avatars.steamstatic.com/abc.jpg");
  });

  it("shows placeholder when no avatar", () => {
    authState.authenticated.mockReturnValue(true);

    const { getByText, queryByTestId } = render(() => <I18nProvider locale="en"><AuthBadge /></I18nProvider>);
    expect(getByText("U")).toBeDefined();
    expect(queryByTestId("admin-avatar")).toBeNull();
  });

  it("calls logout on sign-out click", async () => {
    authState.authenticated.mockReturnValue(true);

    const { getByTitle } = render(() => <I18nProvider locale="en"><AuthBadge /></I18nProvider>);
    fireEvent.click(getByTitle("Sign out"));
    expect(mockLogout).toHaveBeenCalledOnce();
  });
});
