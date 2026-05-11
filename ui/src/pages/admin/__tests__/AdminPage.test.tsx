import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { I18nProvider } from "../../../hooks/useLocale";
import { AdminPage } from "../AdminPage";
import type { AdminAuthConfig } from "../../../data/apiClient";

const { mockGetAdminAuthConfig, mockGetAllowlist, mockAddToAllowlist, mockRemoveFromAllowlist } = vi.hoisted(() => ({
  mockGetAdminAuthConfig: vi.fn(),
  mockGetAllowlist: vi.fn(),
  mockAddToAllowlist: vi.fn(),
  mockRemoveFromAllowlist: vi.fn(),
}));

vi.mock("../../../data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../../data/apiClient")>("../../../data/apiClient");
  return {
    ...actual,
    ApiClient: class {
      getAdminAuthConfig = mockGetAdminAuthConfig;
      getAllowlist = mockGetAllowlist;
      addToAllowlist = mockAddToAllowlist;
      removeFromAllowlist = mockRemoveFromAllowlist;
    },
  };
});

function renderPage(): ReturnType<typeof render> {
  return render(() => (
    <I18nProvider locale="en">
      <Router>
        <Route path="*" component={AdminPage} />
      </Router>
    </I18nProvider>
  ));
}

function configFixture(overrides: Partial<AdminAuthConfig> = {}): AdminAuthConfig {
  return {
    mode: "steamAllowlist",
    adminSteamIds: ["76561198000000001"],
    steamApiKeyConfigured: true,
    sessionTtl: "24h",
    ...overrides,
  };
}

describe("AdminPage", () => {
  beforeEach(() => {
    mockGetAdminAuthConfig.mockReset();
    mockGetAllowlist.mockReset();
    mockAddToAllowlist.mockReset();
    mockRemoveFromAllowlist.mockReset();
  });
  afterEach(() => cleanup());

  it("renders allowlist rows fetched from the server", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198012345678", "76561198087654321"]);

    const screen = renderPage();
    await waitFor(() => {
      expect(screen.queryAllByText("76561198012345678").length).toBeGreaterThan(0);
      expect(screen.queryAllByText("76561198087654321").length).toBeGreaterThan(0);
    });
  });

  it("shows mode mismatch banner when auth.mode is not steamAllowlist", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture({ mode: "public" }));
    mockGetAllowlist.mockResolvedValue([]);

    const screen = renderPage();
    await waitFor(() => {
      expect(screen.getByText("Allowlist is configured but not enforced")).toBeTruthy();
    });
  });

  it("does not show the mismatch banner in steamAllowlist mode", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture({ mode: "steamAllowlist" }));
    mockGetAllowlist.mockResolvedValue([]);

    const screen = renderPage();
    await waitFor(() => {
      expect(screen.queryByText("Allowlist is configured but not enforced")).toBeNull();
    });
  });

  it("renders empty state when allowlist is empty", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue([]);

    const screen = renderPage();
    await waitFor(() => {
      expect(screen.getByText("Nobody on the allowlist yet")).toBeTruthy();
    });
  });

  it("validates Steam ID format inline", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue([]);

    const screen = renderPage();
    await waitFor(() => screen.getByPlaceholderText(/Add Steam64 ID/));
    const input = screen.getByPlaceholderText(/Add Steam64 ID/) as HTMLInputElement;

    fireEvent.input(input, { target: { value: "not-valid" } });
    await waitFor(() => {
      expect(screen.getByText(/Must be 17 digits/)).toBeTruthy();
    });
  });

  it("adds a valid Steam ID via the API", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue([]);
    mockAddToAllowlist.mockResolvedValue(undefined);

    const screen = renderPage();
    await waitFor(() => screen.getByPlaceholderText(/Add Steam64 ID/));
    const input = screen.getByPlaceholderText(/Add Steam64 ID/) as HTMLInputElement;

    fireEvent.input(input, { target: { value: "76561198099999999" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockAddToAllowlist).toHaveBeenCalledWith("76561198099999999");
    });
  });

  it("flags entries also listed as admins in config", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture({ adminSteamIds: ["76561198012345678"] }));
    mockGetAllowlist.mockResolvedValue(["76561198012345678"]);

    const screen = renderPage();
    await waitFor(() => {
      expect(screen.getByTitle("This Steam ID is also listed as an admin in setting.json")).toBeTruthy();
    });
  });

  it("filters list when searching by Steam ID substring", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198012345678", "76561198087654321"]);

    const screen = renderPage();
    await waitFor(() => screen.getByText("76561198012345678"));

    const search = screen.getByPlaceholderText(/Search by Steam ID/) as HTMLInputElement;
    fireEvent.input(search, { target: { value: "0876" } });

    await waitFor(() => {
      // ConfigStrip may also contain "76561198012345678" if it's an admin ID; rule that out via fixture choice.
      expect(screen.queryAllByText("76561198012345678").length).toBe(0);
      expect(screen.queryAllByText("76561198087654321").length).toBeGreaterThan(0);
    });
  });

  it("disables the remove button on rows whose Steam ID is a configured admin", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture({ adminSteamIds: ["76561198012345678"] }));
    mockGetAllowlist.mockResolvedValue(["76561198012345678", "76561198087654321"]);

    const screen = renderPage();
    await waitFor(() => screen.getByTitle("This Steam ID is also listed as an admin in setting.json"));

    const lockedButtons = screen.getAllByTitle(/Configured as admin in setting.json/);
    // Both the checkbox and the trash button on the admin row carry the locked tooltip.
    expect(lockedButtons.length).toBeGreaterThanOrEqual(2);
    for (const btn of lockedButtons) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
    // The other (non-admin) row still has an enabled remove button.
    const removeButtons = screen.getAllByTitle("Remove from allowlist");
    expect(removeButtons.length).toBe(1);
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens confirm dialog before removing a single entry", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198087654321"]);
    mockRemoveFromAllowlist.mockResolvedValue(undefined);

    const screen = renderPage();
    await waitFor(() => screen.getByText("76561198087654321"));

    const removeBtn = screen.getByTitle("Remove from allowlist");
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(screen.getByText("Remove from allowlist?")).toBeTruthy();
    });

    const confirm = screen.getByText("REMOVE");
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(mockRemoveFromAllowlist).toHaveBeenCalledWith("76561198087654321");
    });
  });
});
