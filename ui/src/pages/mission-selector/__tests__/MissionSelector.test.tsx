import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { Router, Route, useLocation } from "@solidjs/router";
import { I18nProvider } from "../../../hooks/useLocale";
import { CustomizeProvider } from "../../../hooks/useCustomize";
import { AuthProvider } from "../../../hooks/useAuth";
import { setAuthToken } from "../../../data/api-client";
import { MissionSelector } from "..";
import type { Operation } from "../../../data/types";

// ─── Helpers ───

const mockOperations: Operation[] = [
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

function mockFetchWith(ops: Operation[]) {
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
      <Route path="/" component={MissionSelector} />
      <Route path="/recording/:id/:name" component={RecordingStub} />
    </Router>
  ));
}

// ─── Tests ───

describe("MissionSelector", () => {
  beforeEach(() => {
    // Reset URL to / so the router starts fresh after tests that navigate away
    window.history.replaceState(null, "", "/");
    mockFetchWith(mockOperations);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  // ── Rendering ──

  it("renders mission selector page", async () => {
    const { findByTestId } = renderPage();
    expect(await findByTestId("mission-selector")).toBeDefined();
  });

  it("displays all operations", async () => {
    const { findByTestId } = renderPage();
    expect(await findByTestId("operation-1")).toBeDefined();
    expect(await findByTestId("operation-2")).toBeDefined();
    expect(await findByTestId("operation-3")).toBeDefined();
  });

  it("shows operation details in rows", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("operation-1");
    expect(op1.textContent).toContain("Op Alpha");
    expect(op1.textContent).toContain("Altis");
    expect(op1.textContent).toContain("1h 0m 0s");
  });

  it("shows tag badges on operations", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("operation-1");
    expect(op1.textContent).toContain("TvT");
    const op2 = await findByTestId("operation-2");
    expect(op2.textContent).toContain("COOP");
  });

  it("shows status badges on operations", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("operation-1");
    expect(op1.textContent).toContain("Ready");
    const op3 = await findByTestId("operation-3");
    expect(op3.textContent).toContain("Ready");
    const op4 = await findByTestId("operation-4");
    expect(op4.textContent).toContain("Live");
    const op5 = await findByTestId("operation-5");
    expect(op5.textContent).toContain("Pending");
  });

  it("shows footer with mission count", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("operation-1");
    expect(container.textContent).toContain("5 of 5 missions");
  });

  // ── Search ──

  it("filters operations by mission name", async () => {
    const { findByTestId, getByTestId, queryByTestId } = renderPage();
    await findByTestId("operation-1");

    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Bravo" } });

    await vi.waitFor(() => {
      expect(queryByTestId("operation-1")).toBeNull();
      expect(queryByTestId("operation-3")).toBeNull();
    });
    expect(queryByTestId("operation-2")).not.toBeNull();
  });

  it("filters operations by world name", async () => {
    const { findByTestId, getByTestId, queryByTestId } = renderPage();
    await findByTestId("operation-1");

    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Stratis" } });

    await vi.waitFor(() => {
      expect(queryByTestId("operation-1")).toBeNull();
      expect(queryByTestId("operation-3")).toBeNull();
    });
    expect(queryByTestId("operation-2")).not.toBeNull();
  });

  it("search is case-insensitive", async () => {
    const { findByTestId, getByTestId, queryByTestId } = renderPage();
    await findByTestId("operation-1");

    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "bravo" } });

    await vi.waitFor(() => {
      expect(queryByTestId("operation-2")).not.toBeNull();
      expect(queryByTestId("operation-1")).toBeNull();
    });
  });

  it("shows empty state when search matches nothing", async () => {
    const { findByTestId, getByTestId, container } = renderPage();
    await findByTestId("operation-1");

    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "nonexistent" } });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("No missions found");
    });
  });

  // ── Tag filter ──

  it("filters by tag when tag badge is clicked", async () => {
    const { findByTestId, queryByTestId, container } = renderPage();
    await findByTestId("operation-1");

    // Find the COOP tag filter button in the filter bar
    const tagButtons = container.querySelectorAll("button");
    const coopButton = Array.from(tagButtons).find(
      (b) => b.textContent === "COOP" && b !== queryByTestId("operation-2")?.querySelector("button"),
    );
    expect(coopButton).toBeDefined();

    fireEvent.click(coopButton!);

    await vi.waitFor(() => {
      expect(queryByTestId("operation-1")).toBeNull();
      expect(queryByTestId("operation-3")).toBeNull();
    });
    expect(queryByTestId("operation-2")).not.toBeNull();
  });

  it("toggles tag filter off when clicked again", async () => {
    const { findByTestId, queryByTestId, container } = renderPage();
    await findByTestId("operation-1");

    const tagButtons = container.querySelectorAll("button");
    const coopButton = Array.from(tagButtons).find(
      (b) => b.textContent === "COOP" && b !== queryByTestId("operation-2")?.querySelector("button"),
    );

    fireEvent.click(coopButton!);
    await vi.waitFor(() => expect(queryByTestId("operation-1")).toBeNull());

    fireEvent.click(coopButton!);
    await vi.waitFor(() => expect(queryByTestId("operation-1")).not.toBeNull());
  });

  it("does not crash when rapidly toggling tag filters", async () => {
    const { findByTestId, queryByTestId, container } = renderPage();
    await findByTestId("operation-1");

    const findTagButton = (tag: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === tag && b !== queryByTestId("operation-1")?.querySelector("button"),
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
      expect(queryByTestId("operation-1")).not.toBeNull();
      expect(queryByTestId("operation-2")).not.toBeNull();
      expect(queryByTestId("operation-3")).not.toBeNull();
    });
  });

  // ── Map filter ──

  it("filters by map when map button is clicked", async () => {
    const { findByTestId, queryByTestId, container } = renderPage();
    await findByTestId("operation-1");

    const buttons = container.querySelectorAll("button");
    const stratisButton = Array.from(buttons).find(
      (b) => b.textContent?.trim() === "Stratis",
    );
    expect(stratisButton).toBeDefined();

    fireEvent.click(stratisButton!);

    await vi.waitFor(() => {
      expect(queryByTestId("operation-1")).toBeNull();
      expect(queryByTestId("operation-3")).toBeNull();
    });
    expect(queryByTestId("operation-2")).not.toBeNull();
  });

  it("does not crash when rapidly toggling map filters", async () => {
    const { findByTestId, queryByTestId, container } = renderPage();
    await findByTestId("operation-1");

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
      expect(queryByTestId("operation-1")).not.toBeNull();
      expect(queryByTestId("operation-2")).not.toBeNull();
      expect(queryByTestId("operation-3")).not.toBeNull();
    });
  });

  // ── Clear filters ──

  it("shows clear button when filter is active and clears on click", async () => {
    const { findByTestId, queryByTestId, container, getByTestId } = renderPage();
    await findByTestId("operation-1");

    // Apply a search filter
    const input = getByTestId("search-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Bravo" } });

    await vi.waitFor(() => expect(queryByTestId("operation-1")).toBeNull());

    // Find and click clear button
    const clearButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Clear"),
    );
    expect(clearButton).toBeDefined();
    fireEvent.click(clearButton!);

    await vi.waitFor(() => {
      expect(queryByTestId("operation-1")).not.toBeNull();
      expect(queryByTestId("operation-2")).not.toBeNull();
      expect(queryByTestId("operation-3")).not.toBeNull();
    });
  });

  // ── Row selection & sidebar ──

  it("opens detail sidebar when a row is clicked", async () => {
    const { findByTestId, container } = renderPage();
    const op1 = await findByTestId("operation-1");

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
    const op1 = await findByTestId("operation-1");

    fireEvent.click(op1);
    await findByTestId("launch-button");

    // The sidebar contains stats with duration and date
    const sidebarText = container.textContent!;
    expect(sidebarText).toContain("1h 0m 0s");
    expect(sidebarText).toContain("1 Jan 2024");
  });

  it("closes sidebar when close button is clicked", async () => {
    const { findByTestId, queryByTestId } = renderPage();
    const op1 = await findByTestId("operation-1");

    fireEvent.click(op1);
    const closeButton = await findByTestId("sidebar-close");

    fireEvent.click(closeButton);

    await vi.waitFor(() => {
      expect(queryByTestId("launch-button")).toBeNull();
    });
  });

  it("switching selection updates sidebar content", async () => {
    const { findByTestId, container } = renderPage();
    const op1 = await findByTestId("operation-1");
    const op2 = await findByTestId("operation-2");

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
    const op1 = await findByTestId("operation-1");

    fireEvent.click(op1);
    const launchButton = await findByTestId("launch-button");

    fireEvent.click(launchButton);

    const loadingScreen = await findByTestId("loading-screen");
    expect(loadingScreen.textContent).toContain("Op Alpha");
    expect(loadingScreen.textContent).toContain("Altis");
  });

  it("launch button is disabled for non-ready operations", async () => {
    const pendingOps: Operation[] = [
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
    const op = await findByTestId("operation-10");

    fireEvent.click(op);
    const launchButton = await findByTestId("launch-button");

    expect((launchButton as HTMLButtonElement).disabled).toBe(true);
    expect(launchButton.textContent).toContain("Converting");
  });

  // ── Sorting ──

  it("sorts by name when MISSION header is clicked", async () => {
    const { findByTestId, container, getByTestId } = renderPage();
    await findByTestId("operation-1");

    const missionHeader = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("mission"),
    );
    expect(missionHeader).toBeDefined();

    fireEvent.click(missionHeader!);

    await vi.waitFor(() => {
      const list = getByTestId("operations-list");
      const rows = list.querySelectorAll("[data-testid^='operation-']");
      const names = Array.from(rows).map((r) => r.textContent!);
      // Descending by name: Op Echo, Op Delta, Op Charlie, Op Bravo, Op Alpha
      expect(names[0]).toContain("Op Echo");
      expect(names[4]).toContain("Op Alpha");
    });
  });

  it("toggles sort direction on second click", async () => {
    const { findByTestId, container, getByTestId } = renderPage();
    await findByTestId("operation-1");

    const missionHeader = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("mission"),
    );

    // First click: descending
    fireEvent.click(missionHeader!);
    // Second click: ascending
    fireEvent.click(missionHeader!);

    await vi.waitFor(() => {
      const list = getByTestId("operations-list");
      const rows = list.querySelectorAll("[data-testid^='operation-']");
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
      expect(container.textContent).toContain("No missions found");
    });
  });

  // ── Keyboard shortcuts ──

  it("closes sidebar on Escape", async () => {
    const { findByTestId, queryByTestId } = renderPage();
    const op1 = await findByTestId("operation-1");

    fireEvent.click(op1);
    await findByTestId("launch-button");

    fireEvent.keyDown(window, { key: "Escape" });

    await vi.waitFor(() => {
      expect(queryByTestId("launch-button")).toBeNull();
    });
  });

  it("launches selected operation on Enter", async () => {
    const { findByTestId } = renderPage();
    const op1 = await findByTestId("operation-1");

    fireEvent.click(op1);
    await findByTestId("launch-button");

    fireEvent.keyDown(window, { key: "Enter" });

    await findByTestId("loading-screen");
  });

  it("focuses search on / key", async () => {
    const { findByTestId, getByTestId } = renderPage();
    await findByTestId("operation-1");

    const input = getByTestId("search-input");
    fireEvent.keyDown(window, { key: "/" });

    expect(document.activeElement).toBe(input);
  });

  // ── Header stats ──

  it("shows correct map count in stats", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("operation-1");

    // 2 unique maps: Altis and Stratis
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("MAPS");
  });
});

// ─── Admin tests ───

/** Mock fetch that routes by URL pattern and responds appropriately */
function mockAdminFetch(ops: Operation[]) {
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
        json: () => Promise.resolve({ authenticated: true }),
      } as Response);
    }

    // Auth: login
    if (u.includes("/api/v1/auth/login")) {
      const body = JSON.parse((init?.body as string) || "{}");
      if (body.secret === "correct-secret") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          json: () => Promise.resolve({ authenticated: true, token: "new-jwt" }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 403, statusText: "Forbidden" } as Response);
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

describe("MissionSelector (Admin)", () => {
  const failedOp: Operation = {
    id: "6",
    worldName: "Altis",
    missionName: "Op Failed",
    missionDuration: 600,
    date: "2024-06-01",
    tag: "TvT",
    conversionStatus: "failed",
  };

  const adminOps: Operation[] = [
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

  it("shows admin badge when authenticated", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("operation-1");

    expect(container.textContent).toContain("Admin");
    expect(container.textContent).toContain("ADMIN");
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
    await findByTestId("mission-selector");

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Sign in");
    });
  });

  it("logout button clears admin UI", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("operation-1");

    const logoutBtn = container.querySelector("button[title='Sign out']") as HTMLButtonElement;
    expect(logoutBtn).not.toBeNull();

    fireEvent.click(logoutBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Sign in");
    });
  });

  // ── Login Modal ──

  it("opens login modal and submits successfully", async () => {
    setAuthToken(null);
    globalThis.fetch = mockAdminFetch(adminOps);
    // Override getMe to initially return not authenticated
    const originalFetch = globalThis.fetch;
    let loginDone = false;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          json: () => Promise.resolve({ authenticated: loginDone }),
        } as Response);
      }
      if (typeof url === "string" && url.includes("/api/v1/auth/login")) {
        loginDone = true;
        return originalFetch(url, init);
      }
      return originalFetch(url, init);
    });

    const { findByTestId, container } = renderPage();
    await findByTestId("mission-selector");

    // Wait for Sign in button
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Sign in");
    });

    // Click Sign in
    const signInBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Sign in"),
    )!;
    fireEvent.click(signInBtn);

    // Modal should appear
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Admin Login");
    });

    // Type secret and submit
    const input = container.querySelector("input[type='password']") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "correct-secret" } });

    const submitBtn = Array.from(container.querySelectorAll("button[type='submit']")).find(
      (b) => b.textContent?.includes("Sign in"),
    )!;
    fireEvent.click(submitBtn);

    // Modal should close and admin badge should appear
    await vi.waitFor(() => {
      expect(container.textContent).toContain("ADMIN");
    });
  });

  it("shows error on wrong secret", async () => {
    setAuthToken(null);
    globalThis.fetch = mockAdminFetch(adminOps);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          json: () => Promise.resolve({ authenticated: false }),
        } as Response);
      }
      return originalFetch(url, init);
    });

    const { findByTestId, container } = renderPage();
    await findByTestId("mission-selector");

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Sign in");
    });

    // Open modal
    const signInBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Sign in"),
    )!;
    fireEvent.click(signInBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Admin Login");
    });

    // Type wrong secret and submit
    const input = container.querySelector("input[type='password']") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "wrong-secret" } });

    const submitBtn = container.querySelector("button[type='submit']")!;
    fireEvent.click(submitBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Invalid secret");
    });
  });

  it("closes login modal on Cancel", async () => {
    setAuthToken(null);
    globalThis.fetch = mockAdminFetch(adminOps);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          json: () => Promise.resolve({ authenticated: false }),
        } as Response);
      }
      return originalFetch(url, init);
    });

    const { findByTestId, container } = renderPage();
    await findByTestId("mission-selector");

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Sign in");
    });

    // Open modal
    const signInBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Sign in"),
    )!;
    fireEvent.click(signInBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Admin Login");
    });

    // Click Cancel
    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    )!;
    fireEvent.click(cancelBtn);

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("Admin Login");
    });
  });

  // ── Edit operation ──

  it("edit flow: sidebar Edit → modal → save", async () => {
    const { findByTestId, container } = renderPage();
    const row = await findByTestId("operation-1");

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
    const row = await findByTestId("operation-1");

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
    const row = await findByTestId("operation-6");

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
        ([url, init]: [string, RequestInit?]) =>
          url.includes("/api/v1/operations/6/retry") && init?.method === "POST",
      );
      expect(retryCall).toBeDefined();
    });
  });

  // ── Upload zone ──

  it("toggle upload zone and upload a file via input", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("operation-1");

    // Click upload button
    const uploadBtn = container.querySelector("button[title='Upload recording']") as HTMLButtonElement;
    expect(uploadBtn).not.toBeNull();
    fireEvent.click(uploadBtn);

    // Upload zone should appear
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Drop .json.gz");
    });

    // Use the hidden file input (jsdom doesn't support DragEvent.dataTransfer)
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File(["data"], "mission.json.gz", { type: "application/gzip" });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fireEvent.change(fileInput);

    // Verify upload API was called
    await vi.waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const uploadCall = calls.find(
        ([url, init]: [string, RequestInit?]) =>
          url.includes("/api/v1/operations/add") && init?.method === "POST",
      );
      expect(uploadCall).toBeDefined();
    });
  });

  it("drag over adds visual state", async () => {
    const { findByTestId, container } = renderPage();
    await findByTestId("operation-1");

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

  // ── Escape closes login modal ──

  it("Escape closes login modal", async () => {
    setAuthToken(null);
    globalThis.fetch = mockAdminFetch(adminOps);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          json: () => Promise.resolve({ authenticated: false }),
        } as Response);
      }
      return originalFetch(url, init);
    });

    const { findByTestId, container } = renderPage();
    await findByTestId("mission-selector");

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Sign in");
    });

    // Open modal
    const signInBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Sign in"),
    )!;
    fireEvent.click(signInBtn);

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Admin Login");
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("Admin Login");
    });
  });
});
