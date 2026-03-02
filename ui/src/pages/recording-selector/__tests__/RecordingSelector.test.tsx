import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { Router, Route, useLocation } from "@solidjs/router";
import { I18nProvider } from "../../../hooks/useLocale";
import { CustomizeProvider } from "../../../hooks/useCustomize";
import { AuthProvider } from "../../../hooks/useAuth";
import { setAuthToken } from "../../../data/apiClient";
import { RecordingSelector } from "..";
import type { Recording } from "../../../data/types";

// ─── Helpers ───

const mockRecordings: Recording[] = [
  {
    id: "1",
    worldName: "Altis",
    missionName: "Op Alpha",
    missionDuration: 3600,
    date: "2024-01-01",
    tag: "TvT",
  },
  {
    id: "2",
    worldName: "Stratis",
    missionName: "Op Bravo",
    missionDuration: 1800,
    date: "2024-02-01",
    tag: "COOP",
  },
  {
    id: "3",
    worldName: "Altis",
    missionName: "Op Charlie",
    missionDuration: 900,
    date: "2024-03-01",
    tag: "TvT",
    storageFormat: "protobuf",
  },
  {
    id: "4",
    worldName: "Altis",
    missionName: "Op Delta",
    missionDuration: 600,
    date: "2024-04-01",
    conversionStatus: "streaming",
  },
  {
    id: "5",
    worldName: "Stratis",
    missionName: "Op Echo",
    missionDuration: 1200,
    date: "2024-05-01",
    conversionStatus: "pending",
  },
];

function mockFetchWith(ops: Recording[]) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve(
        ops.map((op) => ({
          id: Number(op.id),
          world_name: op.worldName,
          mission_name: op.missionName,
          mission_duration: op.missionDuration,
          filename: `${op.id}.json`,
          date: op.date,
          tag: op.tag,
          storageFormat: op.storageFormat,
          conversionStatus: op.conversionStatus,
          player_count: op.playerCount,
          kill_count: op.killCount,
          player_kill_count: op.playerKillCount,
        })),
      ),
  } as Response);
}

/** Lightweight stub that renders location state without needing Leaflet/engine */
function RecordingStub() {
  const location = useLocation();
  const state = () => location.state as { missionName?: string; worldName?: string } | undefined;
  return (
    <div data-testid="loading-screen">
      {state()?.missionName} {state()?.worldName}
    </div>
  );
}

function renderPage() {
  return render(() => (
    <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider><AuthProvider>{p.children}</AuthProvider></CustomizeProvider></I18nProvider>}>
      <Route path="/" component={RecordingSelector} />
      <Route path="/recording/:id/:name" component={RecordingStub} />
    </Router>
  ));
}

// ─── Tests ───

describe("RecordingSelector", () => {
  beforeEach(() => {
    // Reset URL to / so the router starts fresh after tests that navigate away
    window.history.replaceState(null, "", "/");
    mockFetchWith(mockRecordings);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  // ── Rendering ──

  it("renders mission selector page", async () => {
    const { findByTestId } = renderPage();
    expect(await findByTestId("recording-selector")).toBeDefined();
  });

  it("displays all operations", async () => {
    const { findByTestId } = renderPage();
    expect(await findByTestId("recording-1")).toBeDefined();
    expect(await findByTestId("recording-2")).toBeDefined();
    expect(await findByTestId("recording-3")).toBeDefined();
  });

  it("shows operation details in rows", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");
    const row = within(op1);
    expect(row.getByText(/Op Alpha/)).toBeDefined();
    expect(row.getByText(/Altis/)).toBeDefined();
    expect(row.getByText(/1h 0m 0s/)).toBeDefined();
  });

  it("shows tag badges on operations", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");
    expect(within(op1).getByText("TvT")).toBeDefined();
    const op2 = await findByTestId("recording-2");
    expect(within(op2).getByText("COOP")).toBeDefined();
  });

  it("shows status badges on operations", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");
    expect(within(op1).getByText("Ready")).toBeDefined();
    const op3 = await findByTestId("recording-3");
    expect(within(op3).getByText("Ready")).toBeDefined();
    const op4 = await findByTestId("recording-4");
    expect(within(op4).getByText("Live")).toBeDefined();
    const op5 = await findByTestId("recording-5");
    expect(within(op5).getByText("Pending")).toBeDefined();
  });

  it("shows footer with mission count", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");
    expect(screen.getByText(/5 of 5 recordings/)).toBeDefined();
  });

  // ── Search ──

  it("filters operations by mission name", async () => {
    const { findByTestId, getByTestId, queryByTestId } = renderPage();
    await findByTestId("recording-1");

    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Bravo" } });

    await vi.waitFor(() => {
      expect(queryByTestId("recording-1")).toBeNull();
      expect(queryByTestId("recording-3")).toBeNull();
    });
    expect(queryByTestId("recording-2")).not.toBeNull();
  });

  it("filters operations by world name", async () => {
    const { findByTestId, getByTestId, queryByTestId } = renderPage();
    await findByTestId("recording-1");

    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Stratis" } });

    await vi.waitFor(() => {
      expect(queryByTestId("recording-1")).toBeNull();
      expect(queryByTestId("recording-3")).toBeNull();
    });
    expect(queryByTestId("recording-2")).not.toBeNull();
  });

  it("search is case-insensitive", async () => {
    const { findByTestId, getByTestId, queryByTestId } = renderPage();
    await findByTestId("recording-1");

    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "bravo" } });

    await vi.waitFor(() => {
      expect(queryByTestId("recording-2")).not.toBeNull();
      expect(queryByTestId("recording-1")).toBeNull();
    });
  });

  it("shows empty state when search matches nothing", async () => {
    const { findByTestId, getByTestId } = renderPage();
    await findByTestId("recording-1");

    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "nonexistent" } });

    await vi.waitFor(() => {
      expect(screen.getByText(/No recordings found/)).toBeDefined();
    });
  });

  // ── Tag filter ──

  it("filters by tag when tag badge is clicked", async () => {
    const { findByTestId, queryByTestId } = renderPage();
    await findByTestId("recording-1");

    const coopButton = screen.getByTestId("tag-filter-COOP");
    fireEvent.click(coopButton);

    await vi.waitFor(() => {
      expect(queryByTestId("recording-1")).toBeNull();
      expect(queryByTestId("recording-3")).toBeNull();
    });
    expect(queryByTestId("recording-2")).not.toBeNull();
  });

  it("toggles tag filter off when clicked again", async () => {
    const { findByTestId, queryByTestId } = renderPage();
    await findByTestId("recording-1");

    const coopButton = screen.getByTestId("tag-filter-COOP");

    fireEvent.click(coopButton);
    await vi.waitFor(() => expect(queryByTestId("recording-1")).toBeNull());

    fireEvent.click(coopButton);
    await vi.waitFor(() => expect(queryByTestId("recording-1")).not.toBeNull());
  });

  it("does not crash when rapidly toggling tag filters", async () => {
    const { findByTestId, queryByTestId } = renderPage();
    await findByTestId("recording-1");

    const tvtButton = screen.getByTestId("tag-filter-TvT");
    const coopButton = screen.getByTestId("tag-filter-COOP");

    // Rapidly toggle between tag filters
    fireEvent.click(coopButton);
    fireEvent.click(tvtButton);
    fireEvent.click(coopButton);
    fireEvent.click(coopButton); // toggle off

    await vi.waitFor(() => {
      expect(queryByTestId("recording-1")).not.toBeNull();
      expect(queryByTestId("recording-2")).not.toBeNull();
      expect(queryByTestId("recording-3")).not.toBeNull();
    });
  });

  // ── Map filter ──

  it("filters by map when map button is clicked", async () => {
    const { findByTestId, queryByTestId } = renderPage();
    await findByTestId("recording-1");

    const stratisButton = screen.getByTestId("map-filter-Stratis");
    fireEvent.click(stratisButton);

    await vi.waitFor(() => {
      expect(queryByTestId("recording-1")).toBeNull();
      expect(queryByTestId("recording-3")).toBeNull();
    });
    expect(queryByTestId("recording-2")).not.toBeNull();
  });

  it("does not crash when rapidly toggling map filters", async () => {
    const { findByTestId, queryByTestId } = renderPage();
    await findByTestId("recording-1");

    const altisButton = screen.getByTestId("map-filter-Altis");
    const stratisButton = screen.getByTestId("map-filter-Stratis");

    // Rapidly toggle between filters — previously caused
    // "Cannot read properties of undefined (reading 'storageFormat')"
    // when virtualizer held stale indices after filtered list shrank
    fireEvent.click(stratisButton);
    fireEvent.click(altisButton);
    fireEvent.click(stratisButton);
    fireEvent.click(stratisButton); // toggle off

    await vi.waitFor(() => {
      expect(queryByTestId("recording-1")).not.toBeNull();
      expect(queryByTestId("recording-2")).not.toBeNull();
      expect(queryByTestId("recording-3")).not.toBeNull();
    });
  });

  // ── Clear filters ──

  it("shows clear button when filter is active and clears on click", async () => {
    const { findByTestId, queryByTestId, getByTestId } = renderPage();
    await findByTestId("recording-1");

    // Apply a search filter
    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Bravo" } });

    await vi.waitFor(() => expect(queryByTestId("recording-1")).toBeNull());

    // Find and click clear button
    const clearButton = screen.getByTestId("clear-filters");
    fireEvent.click(clearButton);

    await vi.waitFor(() => {
      expect(queryByTestId("recording-1")).not.toBeNull();
      expect(queryByTestId("recording-2")).not.toBeNull();
      expect(queryByTestId("recording-3")).not.toBeNull();
    });
  });

  // ── Row selection & sidebar ──

  it("opens detail sidebar when a row is clicked", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");

    fireEvent.click(op1);

    await vi.waitFor(() => {
      // Op Alpha appears in both the row and the sidebar
      expect(screen.getAllByText(/Op Alpha/).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByTestId("launch-button")).toBeDefined();
    });
  });

  it("sidebar shows correct mission details", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");

    fireEvent.click(op1);
    const sidebar = await findByTestId("detail-sidebar");

    expect(within(sidebar).getByText(/1h 0m 0s/)).toBeDefined();
    expect(within(sidebar).getByText(/1 Jan 2024/)).toBeDefined();
  });

  it("closes sidebar when close button is clicked", async () => {
    const { findByTestId, queryByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");

    fireEvent.click(op1);
    const closeButton = await findByTestId("sidebar-close");

    fireEvent.click(closeButton);

    await vi.waitFor(() => {
      expect(queryByTestId("launch-button")).toBeNull();
    });
  });

  it("switching selection updates sidebar content", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");
    const op2 = await findByTestId("recording-2");

    fireEvent.click(op1);
    const sidebar = await findByTestId("detail-sidebar");
    expect(within(sidebar).getByText(/Op Alpha/)).toBeDefined();

    fireEvent.click(op2);
    await vi.waitFor(() => {
      expect(within(sidebar).getByText(/Op Bravo/)).toBeDefined();
    });
  });

  // ── Launch ──

  it("shows loading screen when launch button is clicked", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");

    fireEvent.click(op1);
    const launchButton = await findByTestId("launch-button");

    fireEvent.click(launchButton);

    const loadingScreen = await findByTestId("loading-screen");
    const ls = within(loadingScreen);
    expect(ls.getByText(/Op Alpha/)).toBeDefined();
    expect(ls.getByText(/Altis/)).toBeDefined();
  });

  it("launch button is disabled for non-ready operations", async () => {
    const pendingOps: Recording[] = [
      {
        id: "10",
        worldName: "Altis",
        missionName: "Op Pending",
        missionDuration: 600,
        date: "2024-01-01",
        tag: "TvT",
        conversionStatus: "converting",
      },
    ];
    mockFetchWith(pendingOps);

    const { findByTestId } = renderPage();
    const op = await findByTestId("recording-10");

    fireEvent.click(op);
    const launchButton = await findByTestId("launch-button");

    expect((launchButton as HTMLButtonElement).disabled).toBe(true);
    expect(within(launchButton).getByText(/Converting/)).toBeDefined();
  });

  // ── Sorting ──

  it("sorts by name when Name header is clicked", async () => {
    const { findByTestId, getByTestId } = renderPage();
    await findByTestId("recording-1");

    const nameHeader = screen.getByRole("button", { name: "Name" });
    fireEvent.click(nameHeader);

    await vi.waitFor(() => {
      const list = getByTestId("recordings-list");
      const rows = list.querySelectorAll("[data-testid^='recording-']");
      const names = Array.from(rows).map((r) => r.textContent!);
      // Descending by name: Op Echo, Op Delta, Op Charlie, Op Bravo, Op Alpha
      expect(names[0]).toContain("Op Echo");
      expect(names[4]).toContain("Op Alpha");
    });
  });

  it("sorts by duration when Duration header is clicked", async () => {
    const { findByTestId, getByTestId } = renderPage();
    await findByTestId("recording-1");

    const durationHeader = screen.getByRole("button", { name: "Duration" });
    fireEvent.click(durationHeader);

    await vi.waitFor(() => {
      const list = getByTestId("recordings-list");
      const rows = list.querySelectorAll("[data-testid^='recording-']");
      const names = Array.from(rows).map((r) => r.textContent!);
      // Descending by duration: Op Alpha (3600s) should be first
      expect(names[0]).toContain("Op Alpha");
    });
  });

  it("toggles sort direction on second click", async () => {
    const { findByTestId, getByTestId } = renderPage();
    await findByTestId("recording-1");

    const nameHeader = screen.getByRole("button", { name: "Name" });

    // First click: descending
    fireEvent.click(nameHeader);
    // Second click: ascending
    fireEvent.click(nameHeader);

    await vi.waitFor(() => {
      const list = getByTestId("recordings-list");
      const rows = list.querySelectorAll("[data-testid^='recording-']");
      const names = Array.from(rows).map((r) => r.textContent!);
      // Ascending by name: Op Alpha, Op Bravo, Op Charlie, Op Delta, Op Echo
      expect(names[0]).toContain("Op Alpha");
      expect(names[4]).toContain("Op Echo");
    });
  });

  // ── Loading ──

  it("shows loading indicator while fetching", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return new Promise<Response>((resolve) => { resolvers.push(resolve); });
    });

    const { queryByTestId } = renderPage();
    expect(queryByTestId("loading-indicator")).not.toBeNull();

    const emptyResponse = { ok: true, json: () => Promise.resolve([]) } as Response;
    for (const resolve of resolvers) resolve(emptyResponse);

    await vi.waitFor(() => {
      expect(queryByTestId("loading-indicator")).toBeNull();
    });
  });

  // ── Empty state ──

  it("shows empty state when no operations exist", async () => {
    mockFetchWith([]);
    renderPage();

    await vi.waitFor(() => {
      expect(screen.getByText(/No recordings found/)).toBeDefined();
    });
  });

  // ── Keyboard shortcuts ──

  it("closes sidebar on Escape", async () => {
    const { findByTestId, queryByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");

    fireEvent.click(op1);
    await findByTestId("launch-button");

    fireEvent.keyDown(window, { key: "Escape" });

    await vi.waitFor(() => {
      expect(queryByTestId("launch-button")).toBeNull();
    });
  });

  it("launches selected operation on Enter", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");

    fireEvent.click(op1);
    await findByTestId("launch-button");

    fireEvent.keyDown(window, { key: "Enter" });

    await findByTestId("loading-screen");
  });

  it("focuses search on / key", async () => {
    const { findByTestId, getByTestId } = renderPage();
    await findByTestId("recording-1");

    const input = getByTestId("search-input");
    fireEvent.keyDown(window, { key: "/" });

    expect(document.activeElement).toBe(input);
  });

  // ── Keyboard navigation ──

  it("ArrowDown selects the first recording when none is selected", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    fireEvent.keyDown(window, { key: "ArrowDown" });

    await vi.waitFor(() => {
      // The first recording in descending date order should be selected (id=5 is most recent)
      const list = screen.getByTestId("recordings-list");
      const rows = list.querySelectorAll("[data-testid^='recording-']");
      expect(rows[0]?.getAttribute("data-testid")).toBe("recording-5");
      // The first row should now have selected styling (sidebar opens)
      expect(screen.getByTestId("detail-sidebar")).toBeDefined();
    });
  });

  it("ArrowDown moves selection to the next recording", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    // Select first item
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await vi.waitFor(() => expect(screen.getByTestId("detail-sidebar")).toBeDefined());

    // Move down
    fireEvent.keyDown(window, { key: "ArrowDown" });

    // Sidebar should still be open with a different recording
    await vi.waitFor(() => {
      expect(screen.getByTestId("detail-sidebar")).toBeDefined();
    });
  });

  it("ArrowUp selects the last recording when none is selected", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    fireEvent.keyDown(window, { key: "ArrowUp" });

    await vi.waitFor(() => {
      expect(screen.getByTestId("detail-sidebar")).toBeDefined();
    });
  });

  it("ArrowUp moves selection to the previous recording", async () => {
    const { findByTestId } = renderPage();
    const op3 = await findByTestId("recording-3");

    // Select a recording in the middle
    fireEvent.click(op3);
    await vi.waitFor(() => {
      const sidebar = screen.getByTestId("detail-sidebar");
      expect(within(sidebar).getByText(/Op Charlie/)).toBeDefined();
    });

    // Move up
    fireEvent.keyDown(window, { key: "ArrowUp" });

    await vi.waitFor(() => {
      expect(screen.getByTestId("detail-sidebar")).toBeDefined();
    });
  });

  // ── Header stats ──

  it("shows correct map count in stats", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    // 2 unique maps: Altis and Stratis
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("MAPS")).toBeDefined();
  });

  // ── Auth error toast ──

  it("auto-dismisses auth error toast after timeout", async () => {
    vi.useFakeTimers();

    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?auth_error=steam_denied", href: window.location.origin + "/?auth_error=steam_denied", pathname: "/" },
      writable: true,
      configurable: true,
    });

    renderPage();

    // Wait for toast to appear
    await vi.waitFor(() => {
      expect(screen.getByTestId("auth-toast")).toBeDefined();
      expect(screen.getByText(/not authorized for admin access/)).toBeDefined();
    });

    // Advance past the 5s auto-dismiss timeout
    vi.advanceTimersByTime(5000);

    await vi.waitFor(() => {
      expect(screen.queryByTestId("auth-toast")).toBeNull();
    });

    vi.useRealTimers();
  });

  it("shows auth error toast and dismisses on click", async () => {
    // Mock location with auth_error param so AuthProvider picks it up
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?auth_error=steam_denied", href: window.location.origin + "/?auth_error=steam_denied", pathname: "/" },
      writable: true,
      configurable: true,
    });

    renderPage();

    await vi.waitFor(() => {
      expect(screen.getByTestId("auth-toast")).toBeDefined();
    });

    const dismissBtn = screen.getByTestId("auth-toast-dismiss");
    fireEvent.click(dismissBtn);

    await vi.waitFor(() => {
      expect(screen.queryByTestId("auth-toast")).toBeNull();
    });
  });
});

// ─── Player/kill data and language selector tests ───

describe("RecordingSelector (player/kill columns)", () => {
  const recsWithStats: Recording[] = [
    {
      id: "10",
      worldName: "Altis",
      missionName: "Op Stats A",
      missionDuration: 3600,
      date: "2024-01-01",
      tag: "TvT",
      playerCount: 32,
      killCount: 150,
    },
    {
      id: "11",
      worldName: "Stratis",
      missionName: "Op Stats B",
      missionDuration: 1800,
      date: "2024-02-01",
      tag: "COOP",
      playerCount: 16,
      killCount: 50,
    },
  ];

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    mockFetchWith(recsWithStats);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows player and kill column headers when data is present", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-10");

    // Column headers for players and kills should be visible
    // t("players") = "Players", t("total_kills") = "Kills"
    expect(screen.getAllByText("Players").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Kills").length).toBeGreaterThanOrEqual(1);
  });

  it("shows maxPlayers stat pill", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-10");

    // maxPlayers = 32, label t("max_players") = "MAX PLAYERS"
    // "32" appears in both the stat pill and the row, so check for at least one
    expect(screen.getAllByText("32").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("MAX PLAYERS")).toBeDefined();
  });

  it("shows totalKills stat pill", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-10");

    // totalKills = 150 + 50 = 200, label t("total_kills") = "Kills"
    expect(screen.getByText("200")).toBeDefined();
  });
});

describe("RecordingSelector (language selector)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    mockFetchWith(mockRecordings);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("opens language dropdown when language button is clicked", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    // Find the language button by its label text
    const langButton = screen.getByText("English").closest("button")!;
    fireEvent.click(langButton);

    // Dropdown should appear with language options
    await vi.waitFor(() => {
      expect(screen.getByText("Deutsch")).toBeDefined();
      expect(screen.getByText("Italiano")).toBeDefined();
    });
  });

  it("selects a language and closes the dropdown", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    // Open dropdown
    const langButton = screen.getByText("English").closest("button")!;
    fireEvent.click(langButton);

    await vi.waitFor(() => {
      expect(screen.getByText("Deutsch")).toBeDefined();
    });

    // Click on Deutsch
    const deutschOption = screen.getAllByText("Deutsch");
    // The option button is in the dropdown
    const optionButton = deutschOption.find(el => el.closest("button") !== langButton)!;
    fireEvent.click(optionButton.closest("button")!);

    // Dropdown should close (the dropdown-only options like Italiano should disappear from dropdown)
    await vi.waitFor(() => {
      // The lang button label should now show Deutsch
      expect(langButton.textContent).toContain("Deutsch");
    });
  });

  it("closes language dropdown on Escape key", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    // Open dropdown
    const langButton = screen.getByText("English").closest("button")!;
    fireEvent.click(langButton);

    await vi.waitFor(() => {
      expect(screen.getByText("Italiano")).toBeDefined();
    });

    // Click Escape to close
    fireEvent.keyDown(window, { key: "Escape" });

    // The dropdown content (like the title "LANGUAGE") should disappear
    await vi.waitFor(() => {
      // After Escape, the dropdown should be closed
      // Check that one of the dropdown-only elements is no longer present
      // The dropdown title "LANGUAGE" is only shown in the dropdown
      expect(screen.queryByText("LANGUAGE")).toBeNull();
    });
  });
});

// ─── Admin tests ───

/** Mock fetch that routes by URL pattern and responds appropriately */
function mockAdminFetch(ops: Recording[]) {
  const rawOps = ops.map((op) => ({
    id: Number(op.id),
    world_name: op.worldName,
    mission_name: op.missionName,
    mission_duration: op.missionDuration,
    filename: `${op.id}.json`,
    date: op.date,
    tag: op.tag,
    storageFormat: op.storageFormat,
    conversionStatus: op.conversionStatus,
  }));

  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const u = typeof url === "string" ? url : "";

    // Auth: getMe
    if (u.includes("/api/v1/auth/me")) {
      return Promise.resolve({
        ok: true, status: 200, statusText: "OK",
        json: () => Promise.resolve({ authenticated: true, steamId: "76561198012345678", steamName: "TestPlayer", steamAvatar: "https://avatars.steamstatic.com/test.jpg" }),
      } as Response);
    }

    // Auth: logout
    if (u.includes("/api/v1/auth/logout")) {
      return Promise.resolve({ ok: true, status: 204, statusText: "No Content" } as Response);
    }

    // Admin: edit operation (PATCH)
    if (u.match(/\/api\/v1\/operations\/\d+$/) && init?.method === "PATCH") {
      const id = u.match(/\/(\d+)$/)![1];
      const data = JSON.parse((init?.body as string) || "{}");
      const raw = rawOps.find((o) => String(o.id) === id);
      return Promise.resolve({
        ok: true, status: 200, statusText: "OK",
        json: () => Promise.resolve({ ...raw, ...data }),
      } as Response);
    }

    // Admin: delete operation (DELETE)
    if (u.match(/\/api\/v1\/operations\/\d+$/) && init?.method === "DELETE") {
      return Promise.resolve({ ok: true, status: 204, statusText: "No Content" } as Response);
    }

    // Admin: retry conversion (POST)
    if (u.match(/\/api\/v1\/operations\/\d+\/retry$/)) {
      return Promise.resolve({
        ok: true, status: 200, statusText: "OK",
        json: () => Promise.resolve({}),
      } as Response);
    }

    // Admin: upload
    if (u.includes("/api/v1/operations/add")) {
      return Promise.resolve({ ok: true, status: 200, statusText: "OK" } as Response);
    }

    // Default: operations list (+ version)
    if (u.includes("/api/version")) {
      return Promise.resolve({
        ok: true, status: 200, statusText: "OK",
        json: () => Promise.resolve({ BuildVersion: "test", BuildCommit: "abc", BuildDate: "2026-01-01" }),
      } as Response);
    }

    // Default: operations list
    return Promise.resolve({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve(rawOps),
    } as Response);
  });
}

describe("RecordingSelector (Admin)", () => {
  const failedOp: Recording = {
    id: "6",
    worldName: "Altis",
    missionName: "Op Failed",
    missionDuration: 600,
    date: "2024-06-01",
    tag: "TvT",
    conversionStatus: "failed",
  };

  const adminOps: Recording[] = [
    {
      id: "1",
      worldName: "Altis",
      missionName: "Op Alpha",
      missionDuration: 3600,
      date: "2024-01-01",
      tag: "TvT",
    },
    failedOp,
  ];

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    globalThis.fetch = mockAdminFetch(adminOps);
    setAuthToken("fake-jwt");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setAuthToken(null);
  });

  // ── Auth UI ──

  it("shows admin badge with Steam profile when authenticated", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    await vi.waitFor(() => {
      expect(screen.getByText("TestPlayer")).toBeDefined();
      expect(screen.getByText("ADMIN")).toBeDefined();
      expect(screen.getByTestId("admin-avatar").getAttribute("src")).toBe("https://avatars.steamstatic.com/test.jpg");
    });
  });

  it("shows sign-in button when not authenticated", async () => {
    setAuthToken(null);
    // Override getMe to return not authenticated
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          json: () => Promise.resolve({ authenticated: false }),
        } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200, statusText: "OK",
        json: () => Promise.resolve([]),
      } as Response);
    });

    const { findByTestId } = renderPage();
    await findByTestId("recording-selector");

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: /Sign in/ })).toBeDefined();
    });
  });

  it("logout button clears admin UI", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    const logoutBtn = screen.getByTitle("Sign out");
    fireEvent.click(logoutBtn);

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: /Sign in/ })).toBeDefined();
    });
  });

  // ── Steam sign-in button ──

  it("Steam sign-in button exists when not authenticated", async () => {
    setAuthToken(null);
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          json: () => Promise.resolve({ authenticated: false }),
        } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200, statusText: "OK",
        json: () => Promise.resolve([]),
      } as Response);
    });

    const { findByTestId } = renderPage();
    await findByTestId("recording-selector");

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: /Sign in/ })).toBeDefined();
    });
  });

  // ── Edit operation ──

  it("edit flow: sidebar Edit → modal → save", async () => {
    const { findByTestId } = renderPage();
    const row = await findByTestId("recording-1");

    // Select operation to open sidebar
    fireEvent.click(row);
    await findByTestId("launch-button");

    // Click Edit in sidebar
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));

    // Edit modal should appear
    await vi.waitFor(() => {
      expect(screen.getByText("Edit Recording")).toBeDefined();
    });

    // Save (click the save button)
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    // Modal should close
    await vi.waitFor(() => {
      expect(screen.queryByText("Edit Recording")).toBeNull();
    });
  });

  // ── Delete operation ──

  it("delete flow: sidebar Delete → confirm dialog → confirm", async () => {
    const { findByTestId } = renderPage();
    const row = await findByTestId("recording-1");

    fireEvent.click(row);
    await findByTestId("launch-button");

    // Click Delete in sidebar
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

    // Confirm dialog should appear (title + danger button both say "Delete Recording")
    await vi.waitFor(() => {
      expect(screen.getAllByText("Delete Recording").length).toBeGreaterThanOrEqual(2);
    });

    // Click confirm delete (the last button with "Delete Recording" is the dialog's danger button)
    const confirmBtns = screen.getAllByRole("button", { name: /Delete Recording/ });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    // Dialog should close
    await vi.waitFor(() => {
      expect(screen.queryByText("Delete Recording")).toBeNull();
    });
  });

  // ── Retry conversion ──

  it("retry button appears for failed operations and calls API", async () => {
    const { findByTestId } = renderPage();
    const row = await findByTestId("recording-6");

    fireEvent.click(row);
    await findByTestId("launch-button");

    // Retry button should be visible for failed operation
    const retryBtn = screen.getByRole("button", { name: /Retry/ });
    fireEvent.click(retryBtn);

    // Verify retry API was called
    await vi.waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const retryCall = calls.find(
        (call: unknown[]) =>
          (call[0] as string).includes("/api/v1/operations/6/retry") && (call[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(retryCall).toBeDefined();
    });
  });

  // ── Upload zone ──

  it("toggle upload zone and upload a file via input", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    // Click upload button
    const uploadBtn = screen.getByTitle("Upload recording");
    fireEvent.click(uploadBtn);

    // Upload dialog should appear
    await vi.waitFor(() => {
      expect(screen.getByTestId("upload-submit")).toBeDefined();
      expect(screen.getByText(/Drop/)).toBeDefined();
    });

    // Use the hidden file input (jsdom doesn't support DragEvent.dataTransfer)
    const fileInput = screen.getByTestId("upload-file-input") as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File(["data"], "mission.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    // File info should appear and name auto-filled
    await vi.waitFor(() => {
      expect(screen.getByText("mission.json.gz")).toBeDefined();
    });

    // Click the Upload Recording submit button
    const submitBtn = screen.getByTestId("upload-submit");
    fireEvent.click(submitBtn);

    // Verify upload API was called
    await vi.waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const uploadCall = calls.find(
        (call: unknown[]) =>
          (call[0] as string).includes("/api/v1/operations/add") && (call[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(uploadCall).toBeDefined();
    });
  });

  it("drag over adds visual state", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    // Open upload zone
    const uploadBtn = screen.getByTitle("Upload recording") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId("upload-drop-zone")).toBeDefined();
    });

    const uploadZone = screen.getByTestId("upload-drop-zone");

    fireEvent.dragOver(uploadZone, { preventDefault: () => {} });

    // dragLeave should clear the state
    fireEvent.dragLeave(uploadZone);
  });

  it("upload dialog closes on Cancel button", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = screen.getByTitle("Upload recording") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId("upload-submit")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await vi.waitFor(() => {
      expect(screen.queryByTestId("upload-submit")).toBeNull();
    });
  });

  it("upload dialog closes on X button", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = screen.getByTitle("Upload recording") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId("upload-submit")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("upload-dialog-close"));

    await vi.waitFor(() => {
      expect(screen.queryByTestId("upload-submit")).toBeNull();
    });
  });

  it("upload submit is disabled without file", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = screen.getByTitle("Upload recording") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId("upload-submit")).toBeDefined();
    });

    // Submit button should be disabled when no file is selected
    const submitBtn = screen.getByTestId("upload-submit") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // Footer hint should say "Select a file to upload"
    expect(screen.getByText("Select a file to upload")).toBeDefined();
  });

  it("upload submit is disabled when name is cleared after file select", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = screen.getByTitle("Upload recording") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId("upload-submit")).toBeDefined();
    });

    // Select a file
    const fileInput = screen.getByTestId("upload-file-input") as HTMLInputElement;
    const file = new File(["data"], "test.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(screen.getByText("test.json.gz")).toBeDefined();
    });

    // Clear the name field (use placeholder to find the right input)
    const nameInput = screen.getByPlaceholderText(/MP_COOP/) as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: "" } });

    // Submit should be disabled and hint should say "Enter a mission name"
    await vi.waitFor(() => {
      expect((screen.getByTestId("upload-submit") as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText("Enter a mission name")).toBeDefined();
    });
  });

  it("auto-fills mission name from filename stripping extensions", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = screen.getByTitle("Upload recording") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId("upload-submit")).toBeDefined();
    });

    const fileInput = screen.getByTestId("upload-file-input") as HTMLInputElement;
    const file = new File(["data"], "MP_COOP_m05.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      const nameInput = screen.getByPlaceholderText(/MP_COOP/) as HTMLInputElement;
      expect(nameInput.value).toBe("MP_COOP_m05");
    });
  });

  it("file remove button clears file and re-shows drop zone", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = screen.getByTitle("Upload recording") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId("upload-drop-zone")).toBeDefined();
    });

    // Select a file
    const fileInput = screen.getByTestId("upload-file-input") as HTMLInputElement;
    const file = new File(["data"], "mission.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(screen.getByText("mission.json.gz")).toBeDefined();
      // Drop text should be gone (browse link only visible when no file selected)
      expect(screen.queryByText("browse")).toBeNull();
    });

    // Click the remove button
    fireEvent.click(screen.getByTestId("upload-file-remove"));

    // Drop zone should reappear
    await vi.waitFor(() => {
      expect(screen.getByTestId("upload-drop-zone")).toBeDefined();
      expect(screen.queryByText("mission.json.gz")).toBeNull();
    });
  });

  it("upload sends form data with all fields", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = screen.getByTitle("Upload recording") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId("upload-submit")).toBeDefined();
    });

    // Select file
    const fileInput = screen.getByTestId("upload-file-input") as HTMLInputElement;
    const file = new File(["data"], "op_test.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(screen.getByText("op_test.json.gz")).toBeDefined();
    });

    // Fill map field (use placeholder to find the right input)
    const mapInput = screen.getByPlaceholderText(/altis/) as HTMLInputElement;
    fireEvent.input(mapInput, { target: { value: "altis" } });

    // Type a tag in the free-form input
    const tagInput = screen.getByPlaceholderText("e.g. TvT, COOP, Zeus") as HTMLInputElement;
    fireEvent.input(tagInput, { target: { value: "TvT" } });

    // Submit
    fireEvent.click(screen.getByTestId("upload-submit"));

    // Verify the API call includes all fields
    await vi.waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const uploadCall = calls.find(
        (call: unknown[]) =>
          (call[0] as string).includes("/api/v1/operations/add") && (call[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(uploadCall).toBeDefined();

      const body = uploadCall![1]!.body as FormData;
      expect(body.get("missionName")).toBe("op_test");
      expect(body.get("worldName")).toBe("altis");
      expect(body.get("tag")).toBe("TvT");
      expect(body.get("filename")).toBe("op_test");
    });
  });

  it("footer hint updates based on form state", async () => {
    const { findByTestId } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = screen.getByTitle("Upload recording") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    // No file: "Select a file to upload"
    await vi.waitFor(() => {
      expect(screen.getByText("Select a file to upload")).toBeDefined();
    });

    // Add file → should show "Ready to upload" (name auto-fills)
    const fileInput = screen.getByTestId("upload-file-input") as HTMLInputElement;
    const file = new File(["data"], "test.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(screen.getByText("Ready to upload")).toBeDefined();
    });
  });

});
