import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@solidjs/testing-library";
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
    expect(op1.textContent).toContain("Op Alpha");
    expect(op1.textContent).toContain("Altis");
    expect(op1.textContent).toContain("1h 0m 0s");
  });

  it("shows tag badges on operations", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");
    expect(op1.textContent).toContain("TvT");
    const op2 = await findByTestId("recording-2");
    expect(op2.textContent).toContain("COOP");
  });

  it("shows status badges on operations", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("recording-1");
    expect(op1.textContent).toContain("Ready");
    const op3 = await findByTestId("recording-3");
    expect(op3.textContent).toContain("Ready");
    const op4 = await findByTestId("recording-4");
    expect(op4.textContent).toContain("Live");
    const op5 = await findByTestId("recording-5");
    expect(op5.textContent).toContain("Pending");
  });

  it("shows footer with mission count", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");
    expect(container.textContent).toContain("5 of 5 recordings");
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
    const { findByTestId, getByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "nonexistent" } });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("No recordings found");
    });
  });

  // ── Tag filter ──

  it("filters by tag when tag badge is clicked", async () => {
    const { findByTestId, queryByTestId, container } = renderPage();
    await findByTestId("recording-1");

    // Find the COOP tag filter button in the filter bar
    const tagButtons = container.querySelectorAll("button");
    const coopButton = Array.from(tagButtons).find(
      (b) => b.textContent === "COOP" && b !== queryByTestId("recording-2")?.querySelector("button"),
    );
    expect(coopButton).toBeDefined();

    fireEvent.click(coopButton!);

    await vi.waitFor(() => {
      expect(queryByTestId("recording-1")).toBeNull();
      expect(queryByTestId("recording-3")).toBeNull();
    });
    expect(queryByTestId("recording-2")).not.toBeNull();
  });

  it("toggles tag filter off when clicked again", async () => {
    const { findByTestId, queryByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const tagButtons = container.querySelectorAll("button");
    const coopButton = Array.from(tagButtons).find(
      (b) => b.textContent === "COOP" && b !== queryByTestId("recording-2")?.querySelector("button"),
    );

    fireEvent.click(coopButton!);
    await vi.waitFor(() => expect(queryByTestId("recording-1")).toBeNull());

    fireEvent.click(coopButton!);
    await vi.waitFor(() => expect(queryByTestId("recording-1")).not.toBeNull());
  });

  it("does not crash when rapidly toggling tag filters", async () => {
    const { findByTestId, queryByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const findTagButton = (tag: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === tag && b !== queryByTestId("recording-1")?.querySelector("button"),
      );

    const tvtButton = findTagButton("TvT")!;
    const coopButton = findTagButton("COOP")!;
    expect(tvtButton).toBeDefined();
    expect(coopButton).toBeDefined();

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
    const { findByTestId, queryByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const buttons = container.querySelectorAll("button");
    const stratisButton = Array.from(buttons).find(
      (b) => b.textContent?.trim() === "Stratis",
    );
    expect(stratisButton).toBeDefined();

    fireEvent.click(stratisButton!);

    await vi.waitFor(() => {
      expect(queryByTestId("recording-1")).toBeNull();
      expect(queryByTestId("recording-3")).toBeNull();
    });
    expect(queryByTestId("recording-2")).not.toBeNull();
  });

  it("does not crash when rapidly toggling map filters", async () => {
    const { findByTestId, queryByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const findMapButton = (name: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === name,
      );

    const altisButton = findMapButton("Altis")!;
    const stratisButton = findMapButton("Stratis")!;
    expect(altisButton).toBeDefined();
    expect(stratisButton).toBeDefined();

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
    const { findByTestId, queryByTestId, container, getByTestId } = renderPage();
    await findByTestId("recording-1");

    // Apply a search filter
    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Bravo" } });

    await vi.waitFor(() => expect(queryByTestId("recording-1")).toBeNull());

    // Find and click clear button
    const clearButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Clear"),
    );
    expect(clearButton).toBeDefined();
    fireEvent.click(clearButton!);

    await vi.waitFor(() => {
      expect(queryByTestId("recording-1")).not.toBeNull();
      expect(queryByTestId("recording-2")).not.toBeNull();
      expect(queryByTestId("recording-3")).not.toBeNull();
    });
  });

  // ── Row selection & sidebar ──

  it("opens detail sidebar when a row is clicked", async () => {
    const { findByTestId, container } = renderPage();
    const op1 = await findByTestId("recording-1");

    fireEvent.click(op1);

    await vi.waitFor(() => {
      // Sidebar should show the mission name and map name
      const sidebarText = container.textContent!;
      expect(sidebarText).toContain("Op Alpha");
      // Launch button should appear
      expect(container.querySelector("[data-testid='launch-button']")).not.toBeNull();
    });
  });

  it("sidebar shows correct mission details", async () => {
    const { findByTestId, container } = renderPage();
    const op1 = await findByTestId("recording-1");

    fireEvent.click(op1);
    await findByTestId("launch-button");

    // The sidebar contains stats with duration and date
    const sidebarText = container.textContent!;
    expect(sidebarText).toContain("1h 0m 0s");
    expect(sidebarText).toContain("1 Jan 2024");
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
    const { findByTestId, container } = renderPage();
    const op1 = await findByTestId("recording-1");
    const op2 = await findByTestId("recording-2");

    fireEvent.click(op1);
    await findByTestId("launch-button");
    expect(container.textContent).toContain("Op Alpha");

    fireEvent.click(op2);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Op Bravo");
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
    expect(loadingScreen.textContent).toContain("Op Alpha");
    expect(loadingScreen.textContent).toContain("Altis");
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
    expect(launchButton.textContent).toContain("Converting");
  });

  // ── Sorting ──

  it("sorts by name when Name header is clicked", async () => {
    const { findByTestId, container, getByTestId } = renderPage();
    await findByTestId("recording-1");

    const nameHeader = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Name",
    );
    expect(nameHeader).toBeDefined();

    fireEvent.click(nameHeader!);

    await vi.waitFor(() => {
      const list = getByTestId("recordings-list");
      const rows = list.querySelectorAll("[data-testid^='recording-']");
      const names = Array.from(rows).map((r) => r.textContent!);
      // Descending by name: Op Echo, Op Delta, Op Charlie, Op Bravo, Op Alpha
      expect(names[0]).toContain("Op Echo");
      expect(names[4]).toContain("Op Alpha");
    });
  });

  it("toggles sort direction on second click", async () => {
    const { findByTestId, container, getByTestId } = renderPage();
    await findByTestId("recording-1");

    const nameHeader = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Name",
    );

    // First click: descending
    fireEvent.click(nameHeader!);
    // Second click: ascending
    fireEvent.click(nameHeader!);

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
    const { container } = renderPage();

    await vi.waitFor(() => {
      expect(container.textContent).toContain("No recordings found");
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

  // ── Header stats ──

  it("shows correct map count in stats", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    // 2 unique maps: Altis and Stratis
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("MAPS");
  });

  // ── Auth error toast ──

  it("auto-dismisses auth error toast after timeout", async () => {
    vi.useFakeTimers();

    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?auth_error=steam_denied", href: window.location.origin + "/?auth_error=steam_denied", pathname: "/" },
      writable: true,
      configurable: true,
    });

    const { container } = renderPage();

    // Wait for toast to appear (flush microtasks with real timers temporarily)
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Your Steam account is not authorized for admin access.");
    });

    // Advance past the 5s auto-dismiss timeout
    vi.advanceTimersByTime(5000);

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("not authorized for admin access");
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

    const { container } = renderPage();

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Your Steam account is not authorized for admin access.");
    });

    // Click the dismiss button on the toast (it's the button whose parent contains the error message)
    const toastDiv = Array.from(container.querySelectorAll("div")).find(
      (d) => d.textContent?.includes("not authorized for admin access"),
    )!;
    const dismissBtn = toastDiv.querySelector("button")!;
    expect(dismissBtn).toBeDefined();
    fireEvent.click(dismissBtn);

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("not authorized for admin access");
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
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    await vi.waitFor(() => {
      expect(container.textContent).toContain("TestPlayer");
      expect(container.textContent).toContain("ADMIN");
      expect(container.querySelector("img[src='https://avatars.steamstatic.com/test.jpg']")).not.toBeNull();
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

    const { findByTestId, container } = renderPage();
    await findByTestId("recording-selector");

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Sign in");
    });
  });

  it("logout button clears admin UI", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const logoutBtn = container.querySelector("button[title='Sign out']") as HTMLButtonElement;
    expect(logoutBtn).not.toBeNull();

    fireEvent.click(logoutBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Sign in");
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

    const { findByTestId, container } = renderPage();
    await findByTestId("recording-selector");

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Sign in");
    });

    const signInBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Sign in"),
    );
    expect(signInBtn).toBeDefined();
  });

  // ── Edit operation ──

  it("edit flow: sidebar Edit → modal → save", async () => {
    const { findByTestId, container } = renderPage();
    const row = await findByTestId("recording-1");

    // Select operation to open sidebar
    fireEvent.click(row);
    await findByTestId("launch-button");

    // Click Edit in sidebar
    const editBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Edit"),
    )!;
    fireEvent.click(editBtn);

    // Edit modal should appear
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Edit Recording");
    });

    // Save (click the save button)
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Save"),
    )!;
    fireEvent.click(saveBtn);

    // Modal should close
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("Edit Recording");
    });
  });

  // ── Delete operation ──

  it("delete flow: sidebar Delete → confirm dialog → confirm", async () => {
    const { findByTestId, container } = renderPage();
    const row = await findByTestId("recording-1");

    fireEvent.click(row);
    await findByTestId("launch-button");

    // Click Delete in sidebar
    const deleteBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Delete"),
    )!;
    fireEvent.click(deleteBtn);

    // Confirm dialog should appear
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Delete Recording");
    });

    // Click confirm delete
    const confirmBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Delete") && b !== deleteBtn,
    )!;
    fireEvent.click(confirmBtn);

    // Dialog should close
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("Delete Recording");
    });
  });

  // ── Retry conversion ──

  it("retry button appears for failed operations and calls API", async () => {
    const { findByTestId, container } = renderPage();
    const row = await findByTestId("recording-6");

    fireEvent.click(row);
    await findByTestId("launch-button");

    // Retry button should be visible for failed operation
    const retryBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Retry"),
    )!;
    expect(retryBtn).toBeDefined();

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
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    // Click upload button
    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    expect(uploadBtn).not.toBeNull();
    fireEvent.click(uploadBtn);

    // Upload dialog should appear
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Upload Recording");
      expect(container.textContent).toContain("Drop");
    });

    // Use the hidden file input (jsdom doesn't support DragEvent.dataTransfer)
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File(["data"], "mission.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    // File info should appear and name auto-filled
    await vi.waitFor(() => {
      expect(container.textContent).toContain("mission.json.gz");
    });

    // Click the Upload Recording submit button
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Upload Recording") && !b.disabled,
    )!;
    expect(submitBtn).toBeDefined();
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
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    // Open upload zone
    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Drop .json.gz");
    });

    const uploadZone = Array.from(container.querySelectorAll("div")).find(
      (d) => d.textContent?.includes("Drop .json.gz"),
    )!;

    fireEvent.dragOver(uploadZone, { preventDefault: () => {} });

    // dragLeave should clear the state
    fireEvent.dragLeave(uploadZone);
  });

  it("upload dialog closes on Cancel button", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Upload Recording");
    });

    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    )!;
    fireEvent.click(cancelBtn);

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("Upload Recording");
    });
  });

  it("upload dialog closes on X button", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Upload Recording");
    });

    // The X close button is the dialogCloseBtn inside the upload dialog header
    const dialogCloseBtns = container.querySelectorAll("button");
    const xBtn = Array.from(dialogCloseBtns).find((b) => {
      // X button has no text besides the SVG icon, and is inside the upload dialog
      const parent = b.closest("[class]");
      return b.textContent?.trim() === "" && parent?.textContent?.includes("Upload Recording");
    });
    // Fallback: find by the SVG-only button near the header
    const closeBtn = xBtn || Array.from(dialogCloseBtns).find(
      (b) => b.innerHTML.includes("svg") && !b.textContent?.trim() && b.closest("div")?.textContent?.includes("Upload Recording"),
    );
    expect(closeBtn).toBeDefined();
    fireEvent.click(closeBtn!);

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("Upload Recording");
    });
  });

  it("upload submit is disabled without file", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Upload Recording");
    });

    // Submit button should be disabled when no file is selected
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Upload Recording") && b !== uploadBtn,
    ) as HTMLButtonElement;
    expect(submitBtn).toBeDefined();
    expect(submitBtn.disabled).toBe(true);

    // Footer hint should say "Select a file to upload"
    expect(container.textContent).toContain("Select a file to upload");
  });

  it("upload submit is disabled when name is cleared after file select", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Upload Recording");
    });

    // Select a file
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["data"], "test.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("test.json.gz");
    });

    // Clear the name field (use placeholder to find the right input)
    const nameInput = container.querySelector("input[placeholder*='MP_COOP']") as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: "" } });

    // Submit should be disabled and hint should say "Enter a mission name"
    await vi.waitFor(() => {
      const submitBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Upload Recording") && b !== uploadBtn,
      ) as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);
      expect(container.textContent).toContain("Enter a mission name");
    });
  });

  it("auto-fills mission name from filename stripping extensions", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Upload Recording");
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["data"], "MP_COOP_m05.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      const nameInput = container.querySelector("input[placeholder*='MP_COOP']") as HTMLInputElement;
      expect(nameInput.value).toBe("MP_COOP_m05");
    });
  });

  it("file remove button clears file and re-shows drop zone", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Drop .json.gz");
    });

    // Select a file
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["data"], "mission.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("mission.json.gz");
      // Drop text should be gone
      expect(container.textContent).not.toContain("Drop .json.gz");
    });

    // Click the remove button (the X button inside the file row)
    // It's distinct from the dialog close X — it's inside the file info area
    const removeBtn = Array.from(container.querySelectorAll("button")).find((b) => {
      const text = b.textContent?.trim();
      return text === "" && b.closest("div")?.textContent?.includes("mission.json.gz");
    });
    expect(removeBtn).toBeDefined();
    fireEvent.click(removeBtn!);

    // Drop zone should reappear
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Drop .json.gz");
      expect(container.textContent).not.toContain("mission.json.gz");
    });
  });

  it("upload sends form data with all fields", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Upload Recording");
    });

    // Select file
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["data"], "op_test.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("op_test.json.gz");
    });

    // Fill map field (use placeholder to find the right input)
    const mapInput = container.querySelector("input[placeholder*='altis']") as HTMLInputElement;
    fireEvent.input(mapInput, { target: { value: "altis" } });

    // Select a tag — find the TvT button inside the upload dialog (near the TAG label)
    const tagLabel = Array.from(container.querySelectorAll("label")).find(
      (l) => l.textContent === "TAG",
    )!;
    const tagGroup = tagLabel.nextElementSibling!;
    const tvtBtn = Array.from(tagGroup.querySelectorAll("button")).find(
      (b) => b.textContent === "TvT",
    );
    expect(tvtBtn).toBeDefined();
    fireEvent.click(tvtBtn!);

    // Submit
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Upload Recording") && !(b as HTMLButtonElement).disabled,
    )!;
    fireEvent.click(submitBtn);

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
    const { findByTestId, container } = renderPage();
    await findByTestId("recording-1");

    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    // No file: "Select a file to upload"
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Select a file to upload");
    });

    // Add file → should show "Ready to upload" (name auto-fills)
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["data"], "test.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Ready to upload");
    });
  });

});
