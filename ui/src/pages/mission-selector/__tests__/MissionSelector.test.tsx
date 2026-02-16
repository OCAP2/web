import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { Router, Route, useLocation } from "@solidjs/router";
import { I18nProvider } from "../../../hooks/useLocale";
import { CustomizeProvider } from "../../../hooks/useCustomize";
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
    <Router root={(p) => <I18nProvider locale="en"><CustomizeProvider>{p.children}</CustomizeProvider></I18nProvider>}>
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
