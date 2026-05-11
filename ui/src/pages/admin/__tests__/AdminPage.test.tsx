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

  it("disables add/remove/bulk controls when auth.mode is not steamAllowlist", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture({ mode: "public", adminSteamIds: ["76561198000000001"] }));
    mockGetAllowlist.mockResolvedValue(["76561198087654321"]);

    const screen = renderPage();
    await waitFor(() => screen.getByText("INACTIVE"));

    expect((screen.getByPlaceholderText(/Add Steam64 ID/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByText("ADD").closest("button") as HTMLButtonElement).disabled).toBe(true);
    // The row remove button + select-all + bulk toggle all carry the inactive tooltip too.
    const inactiveTitled = screen.queryAllByTitle(/auth\.mode is not steamAllowlist/);
    expect(inactiveTitled.length).toBeGreaterThanOrEqual(4);
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

  it("cancels the remove dialog without calling the API", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198087654321"]);

    const screen = renderPage();
    await waitFor(() => screen.getByText("76561198087654321"));

    fireEvent.click(screen.getByTitle("Remove from allowlist"));
    await waitFor(() => screen.getByText("Remove from allowlist?"));

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => {
      expect(screen.queryByText("Remove from allowlist?")).toBeNull();
    });
    expect(mockRemoveFromAllowlist).not.toHaveBeenCalled();
  });

  it("surfaces an error toast when add fails", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue([]);
    mockAddToAllowlist.mockRejectedValue(new Error("backend exploded"));

    const screen = renderPage();
    const input = (await screen.findByPlaceholderText(/Add Steam64 ID/)) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "76561198099999999" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("backend exploded")).toBeTruthy();
    });
  });

  it("rejects duplicate IDs with a warn toast and skips the API call", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198099999999"]);

    const screen = renderPage();
    const input = (await screen.findByPlaceholderText(/Add Steam64 ID/)) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "76561198099999999" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/is already on the allowlist/)).toBeTruthy();
    });
    expect(mockAddToAllowlist).not.toHaveBeenCalled();
  });

  it("performs bulk add and summarises added / skipped / invalid counts", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198000000001"]);
    mockAddToAllowlist.mockResolvedValue(undefined);

    const screen = renderPage();
    await screen.findByPlaceholderText(/Add Steam64 ID/);

    fireEvent.click(screen.getByText("Bulk add"));
    const textarea = (await screen.findByPlaceholderText(/76561198012345678/)) as HTMLTextAreaElement;
    fireEvent.input(textarea, {
      target: {
        value: [
          "76561198000000001", // duplicate
          "76561198000000002", // valid
          "76561198000000003", // valid
          "not-a-steam-id",    // invalid
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByText("ADD ALL"));

    await waitFor(() => {
      expect(mockAddToAllowlist).toHaveBeenCalledTimes(2);
    });
    expect(mockAddToAllowlist).toHaveBeenCalledWith("76561198000000002");
    expect(mockAddToAllowlist).toHaveBeenCalledWith("76561198000000003");
    // Summary toast mentions the counts.
    expect(screen.queryByText(/Added 2/)).toBeTruthy();
  });

  it("cancels bulk-add when Cancel inside the bulk panel is clicked", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue([]);

    const screen = renderPage();
    await screen.findByPlaceholderText(/Add Steam64 ID/);

    fireEvent.click(screen.getByText("Bulk add"));
    const textarea = (await screen.findByPlaceholderText(/76561198012345678/)) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "76561198000000002" } });
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/76561198012345678/)).toBeNull();
    });
    expect(mockAddToAllowlist).not.toHaveBeenCalled();
  });

  it("selects all rows and bulk-removes via the confirm dialog", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198000000002", "76561198000000003"]);
    mockRemoveFromAllowlist.mockResolvedValue(undefined);

    const screen = renderPage();
    await screen.findByText("76561198000000002");

    fireEvent.click(screen.getByText(/Select all/));
    const bulkBtn = await screen.findByText("REMOVE SELECTED");
    fireEvent.click(bulkBtn);

    const confirm = await screen.findByText(/REMOVE 2/);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(mockRemoveFromAllowlist).toHaveBeenCalledTimes(2);
    });
  });

  it("toggles select-all on and off", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198000000002", "76561198000000003"]);

    const screen = renderPage();
    await screen.findByText("76561198000000002");

    fireEvent.click(screen.getByText(/Select all/));
    await screen.findByText(/Deselect all/);
    fireEvent.click(screen.getByText(/Deselect all/));
    await screen.findByText(/Select all/);
    expect(screen.queryByText("REMOVE SELECTED")).toBeNull();
  });

  it("clears the search via the X button", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198000000002"]);

    const screen = renderPage();
    const search = (await screen.findByPlaceholderText(/Search by Steam ID/)) as HTMLInputElement;
    fireEvent.input(search, { target: { value: "xyz" } });
    await waitFor(() => expect(search.value).toBe("xyz"));

    const wrapper = search.parentElement!;
    const clear = wrapper.querySelector("button") as HTMLButtonElement;
    fireEvent.click(clear);
    await waitFor(() => expect(search.value).toBe(""));
  });

  it("copies the Steam ID to the clipboard with a success toast", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198000000002"]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const screen = renderPage();
    const copyBtn = await screen.findByTitle("Click to copy");
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith("76561198000000002");
    await waitFor(() => {
      expect(screen.getByText(/Copied to clipboard/)).toBeTruthy();
    });
  });

  it("renders an error toast when the admin config load fails", async () => {
    mockGetAdminAuthConfig.mockRejectedValue(new Error("network down"));
    mockGetAllowlist.mockResolvedValue([]);

    const screen = renderPage();
    await waitFor(() => {
      expect(screen.getByText("Failed to load admin data.")).toBeTruthy();
    });
  });

  it("shows the empty state and focuses the input via the CTA", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue([]);

    const screen = renderPage();
    await screen.findByText("Nobody on the allowlist yet");

    const cta = screen.getByText(/PASTE YOUR FIRST STEAM ID/);
    const input = screen.getByPlaceholderText(/Add Steam64 ID/) as HTMLInputElement;
    fireEvent.click(cta);
    expect(document.activeElement).toBe(input);
  });

  it("shows the API-key-absent fallback in the config strip", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture({ steamApiKeyConfigured: false }));
    mockGetAllowlist.mockResolvedValue([]);

    const screen = renderPage();
    await waitFor(() => {
      expect(screen.getByText("Not configured")).toBeTruthy();
      expect(screen.getByText(/display names will fall back to Steam ID/)).toBeTruthy();
    });
  });

  it("navigates back to recordings via the back button", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue([]);

    const screen = renderPage();
    const back = await screen.findByTitle("Back to recordings");
    fireEvent.click(back);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
  });

  it("surfaces ApiError detail on remove failure", async () => {
    const { ApiError } = await import("../../../data/apiClient");
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198000000002"]);
    mockRemoveFromAllowlist.mockRejectedValue(
      new ApiError("fail", 409, "Conflict", "still has active sessions"),
    );

    const screen = renderPage();
    await screen.findByText("76561198000000002");

    fireEvent.click(screen.getByTitle("Remove from allowlist"));
    fireEvent.click(await screen.findByText("REMOVE"));
    await waitFor(() => {
      expect(screen.getByText(/still has active sessions/)).toBeTruthy();
    });
  });

  it("surfaces ApiError status when no detail is present", async () => {
    const { ApiError } = await import("../../../data/apiClient");
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198000000002"]);
    mockRemoveFromAllowlist.mockRejectedValue(new ApiError("fail", 500, "Internal Server Error"));

    const screen = renderPage();
    await screen.findByText("76561198000000002");
    fireEvent.click(screen.getByTitle("Remove from allowlist"));
    fireEvent.click(await screen.findByText("REMOVE"));
    await waitFor(() => {
      expect(screen.getByText(/500 Internal Server Error/)).toBeTruthy();
    });
  });

  it("falls back to a generic action-failed toast for unknown error shapes", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198000000002"]);
    mockRemoveFromAllowlist.mockRejectedValue("plain string, not an Error");

    const screen = renderPage();
    await screen.findByText("76561198000000002");
    fireEvent.click(screen.getByTitle("Remove from allowlist"));
    fireEvent.click(await screen.findByText("REMOVE"));
    await waitFor(() => {
      expect(screen.getByText(/Action failed/)).toBeTruthy();
    });
  });

  it("toggles a single row checkbox on and off", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198000000002", "76561198000000003"]);

    const screen = renderPage();
    await screen.findByText("76561198000000002");

    // Per-row checkbox button is sibling of the row's content; click the first one.
    const rows = screen.getAllByTitle("Click to copy");
    const firstRowParent = rows[0].closest("[class*='_row_']")!;
    const checkbox = firstRowParent.querySelector("button[aria-pressed]") as HTMLButtonElement;
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(checkbox.getAttribute("aria-pressed")).toBe("true");
    });
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(checkbox.getAttribute("aria-pressed")).toBe("false");
    });
  });

  it("shows an error toast when the allowlist load fails", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockRejectedValue(new Error("boom"));

    const screen = renderPage();
    await waitFor(() => {
      expect(screen.getByText("Failed to load admin data.")).toBeTruthy();
    });
  });

  it("replaces the toast in flight when two actions fire back-to-back", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue([]);
    mockAddToAllowlist.mockResolvedValue(undefined);

    const screen = renderPage();
    const input = (await screen.findByPlaceholderText(/Add Steam64 ID/)) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "76561198000000002" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => screen.getByText(/Added/));

    fireEvent.input(input, { target: { value: "76561198000000003" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.queryAllByText(/76561198000000003/).length).toBeGreaterThan(0);
    });
  });

  it("bulk-add keeps the local list in sync with which IDs actually succeeded", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture({ adminSteamIds: [] }));
    mockGetAllowlist.mockResolvedValue([]);
    // Middle entry fails server-side; first and third succeed.
    mockAddToAllowlist
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("backend timeout"))
      .mockResolvedValueOnce(undefined);

    const screen = renderPage();
    await screen.findByPlaceholderText(/Add Steam64 ID/);
    fireEvent.click(screen.getByText("Bulk add"));
    const textarea = (await screen.findByPlaceholderText(/76561198012345678/)) as HTMLTextAreaElement;
    fireEvent.input(textarea, {
      target: {
        value: ["76561198000000011", "76561198000000022", "76561198000000033"].join("\n"),
      },
    });
    fireEvent.click(screen.getByText("ADD ALL"));

    await waitFor(() => {
      expect(mockAddToAllowlist).toHaveBeenCalledTimes(3);
    });
    // Local state should contain only the two that succeeded — NOT the failed middle ID.
    await waitFor(() => {
      expect(screen.getByText("76561198000000011")).toBeTruthy();
      expect(screen.queryByText("76561198000000022")).toBeNull();
      expect(screen.getByText("76561198000000033")).toBeTruthy();
    });
    // Summary distinguishes "failed" from "invalid format".
    expect(screen.queryByText(/1 failed/)).toBeTruthy();
    expect(screen.queryByText(/invalid format/)).toBeNull();
  });

  it("bulk-remove keeps failed rows visible and reports the failure count", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture({ adminSteamIds: [] }));
    mockGetAllowlist.mockResolvedValue([
      "76561198000000011",
      "76561198000000022",
      "76561198000000033",
    ]);
    // Middle removal fails.
    mockRemoveFromAllowlist
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("server error"))
      .mockResolvedValueOnce(undefined);

    const screen = renderPage();
    await screen.findByText("76561198000000011");

    fireEvent.click(screen.getByText(/Select all/));
    fireEvent.click(await screen.findByText("REMOVE SELECTED"));
    fireEvent.click(await screen.findByText((_, el) => el?.textContent?.trim() === "REMOVE 3"));

    await waitFor(() => {
      expect(mockRemoveFromAllowlist).toHaveBeenCalledTimes(3);
    });
    // The failed row is still on screen.
    await waitFor(() => {
      expect(screen.queryByText("76561198000000011")).toBeNull();
      expect(screen.getByText("76561198000000022")).toBeTruthy();
      expect(screen.queryByText("76561198000000033")).toBeNull();
    });
    expect(screen.queryByText(/Removed 2/)).toBeTruthy();
    expect(screen.queryByText(/1 failed/)).toBeTruthy();
  });

  it("uses singular wording when exactly one entry is removed", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture({ adminSteamIds: [] }));
    mockGetAllowlist.mockResolvedValue(["76561198000000011"]);
    mockRemoveFromAllowlist.mockResolvedValue(undefined);

    const screen = renderPage();
    await screen.findByText("76561198000000011");
    fireEvent.click(screen.getByText(/Select all/));
    fireEvent.click(await screen.findByText("REMOVE SELECTED"));
    fireEvent.click(await screen.findByText((_, el) => el?.textContent?.trim() === "REMOVE 1"));

    await waitFor(() => {
      expect(screen.getByText(/Removed 1 entry from the allowlist/)).toBeTruthy();
    });
  });

  it("dismisses the toast via its close button", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue([]);
    mockAddToAllowlist.mockResolvedValue(undefined);

    const screen = renderPage();
    const input = (await screen.findByPlaceholderText(/Add Steam64 ID/)) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "76561198000000044" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const toast = await screen.findByText(/Added/);

    // The toast's close button sits next to the message inside the toast container.
    const container = toast.parentElement!;
    const dismiss = container.querySelector("button") as HTMLButtonElement;
    fireEvent.click(dismiss);
    await waitFor(() => {
      expect(screen.queryByText(/Added/)).toBeNull();
    });
  });

  it("cancels the bulk-remove confirm dialog without calling the API", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture({ adminSteamIds: [] }));
    mockGetAllowlist.mockResolvedValue(["76561198000000077"]);

    const screen = renderPage();
    await screen.findByText("76561198000000077");
    fireEvent.click(screen.getByText(/Select all/));
    fireEvent.click(await screen.findByText("REMOVE SELECTED"));
    fireEvent.click(await screen.findByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByText(/Remove selected entries/i)).toBeNull();
    });
    expect(mockRemoveFromAllowlist).not.toHaveBeenCalled();
  });

  it("submit() on Enter with an invalid Steam ID is a no-op", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue([]);

    const screen = renderPage();
    const input = (await screen.findByPlaceholderText(/Add Steam64 ID/)) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "12345" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockAddToAllowlist).not.toHaveBeenCalled();
    expect(input.value).toBe("12345"); // input is NOT cleared because submit was a no-op
  });

  it("renders the no-match message when search filters everything out", async () => {
    mockGetAdminAuthConfig.mockResolvedValue(configFixture());
    mockGetAllowlist.mockResolvedValue(["76561198000000002"]);

    const screen = renderPage();
    const search = (await screen.findByPlaceholderText(/Search by Steam ID/)) as HTMLInputElement;
    fireEvent.input(search, { target: { value: "zzzz" } });
    await waitFor(() => {
      expect(screen.getByText(/No matches for/)).toBeTruthy();
    });
  });
});
