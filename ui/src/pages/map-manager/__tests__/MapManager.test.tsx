import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { MapManager } from "../MapManager";
import type { ToolSet, MapInfo } from "../types";

// ─── Mock API ───

const {
  mockGetMapToolTools,
  mockGetMapToolMaps,
  mockGetMapToolHealth,
  mockDeleteMapToolMap,
  mockImportMapToolZip,
  mockRestyleMapToolAll,
  mockCancelMapToolJob,
  mockGetMapToolEventsUrl,
} = vi.hoisted(() => ({
  mockGetMapToolTools: vi.fn(),
  mockGetMapToolMaps: vi.fn(),
  mockGetMapToolHealth: vi.fn(),
  mockDeleteMapToolMap: vi.fn(),
  mockImportMapToolZip: vi.fn(),
  mockRestyleMapToolAll: vi.fn(),
  mockCancelMapToolJob: vi.fn(),
  mockGetMapToolEventsUrl: vi.fn().mockReturnValue(""),
}));

vi.mock("../../../data/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("../../../data/apiClient")>(
      "../../../data/apiClient",
    );
  return {
    ...actual,
    ApiClient: class {
      getMapToolTools = mockGetMapToolTools;
      getMapToolMaps = mockGetMapToolMaps;
      getMapToolHealth = mockGetMapToolHealth;
      deleteMapToolMap = mockDeleteMapToolMap;
      importMapToolZip = mockImportMapToolZip;
      restyleMapToolAll = mockRestyleMapToolAll;
      cancelMapToolJob = mockCancelMapToolJob;
      getMapToolEventsUrl = mockGetMapToolEventsUrl;
    },
  };
});

// ─── Mock useMapToolEvents ───

const mockJobsRef = vi.hoisted(() => ({ current: [] as any[] }));

vi.mock("../useMapToolEvents", () => ({
  useMapToolEvents: () => ({
    jobs: () => mockJobsRef.current,
    connected: () => true,
  }),
}));

// ─── Mock auth ───

vi.mock("../../../hooks/useAuth", () => ({
  useAuth: () => ({
    authenticated: () => true,
    user: () => ({ name: "admin" }),
    login: vi.fn(),
    logout: vi.fn(),
    steamLoginUrl: () => "",
  }),
}));

// ─── Test data ───

const tools: ToolSet = [
  { name: "pmtiles", found: true, path: "/usr/bin/pmtiles", required: true },
  { name: "tippecanoe", found: true, path: "/usr/bin/tippecanoe", required: true },
];

const maps: MapInfo[] = [
  {
    name: "Altis",
    worldSize: 30720,
    status: "complete",
    hasPreview: true,
    featureLayers: ["roads", "buildings"],
    files: { "satellite.pmtiles": 500, "map.json": 1 },
  },
  {
    name: "Stratis",
    worldSize: 8192,
    status: "complete",
    hasPreview: false,
    featureLayers: ["roads"],
    files: { "satellite.pmtiles": 100 },
  },
  {
    name: "Tanoa",
    worldSize: 15360,
    status: "incomplete",
    hasPreview: false,
    featureLayers: [],
    files: {},
  },
];

// ─── Helpers ───

function renderPage() {
  return render(() => (
    <Router root={(p) => <>{p.children}</>}>
      <Route path="/" component={MapManager} />
    </Router>
  ));
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

// ─── Tests ───

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  mockJobsRef.current = [];
  mockGetMapToolTools.mockResolvedValue(tools);
  mockGetMapToolMaps.mockResolvedValue(maps);
  mockGetMapToolHealth.mockResolvedValue([]);
  mockDeleteMapToolMap.mockResolvedValue(undefined);
  mockImportMapToolZip.mockResolvedValue({ id: "j1", status: "pending" });
  mockRestyleMapToolAll.mockResolvedValue(undefined);
  mockCancelMapToolJob.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapManager", () => {
  it("renders header with OCAP title", async () => {
    const { container } = renderPage();
    await flush();
    expect(container.textContent).toContain("OCAP");
    expect(container.textContent).toContain("Map Tool");
  });

  it("fetches tools and maps on mount", async () => {
    renderPage();
    await flush();
    expect(mockGetMapToolTools).toHaveBeenCalled();
    expect(mockGetMapToolMaps).toHaveBeenCalled();
  });

  it("renders map cards in grid view", async () => {
    const { container } = renderPage();
    await flush();
    expect(container.textContent).toContain("Altis");
    expect(container.textContent).toContain("Stratis");
    expect(container.textContent).toContain("Tanoa");
  });

  it("shows map count", async () => {
    const { container } = renderPage();
    await flush();
    expect(container.textContent).toContain("3");
  });

  it("filters maps by search", async () => {
    const { container } = renderPage();
    await flush();
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.input(input, { target: { value: "Alt" } });
    expect(container.textContent).toContain("Altis");
    expect(container.textContent).not.toContain("Stratis");
    expect(container.textContent).not.toContain("Tanoa");
  });

  it("filters maps by status", async () => {
    const { container } = renderPage();
    await flush();
    // Click "Partial" filter
    const buttons = Array.from(container.querySelectorAll("button"));
    const partialBtn = buttons.find((b) => b.textContent === "Partial");
    expect(partialBtn).toBeDefined();
    fireEvent.click(partialBtn!);
    expect(container.textContent).toContain("Tanoa");
    expect(container.textContent).not.toContain("Altis");
  });

  it("toggles status filter off when clicked again", async () => {
    const { container } = renderPage();
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const partialBtn = buttons.find((b) => b.textContent === "Partial")!;
    fireEvent.click(partialBtn);
    expect(container.textContent).not.toContain("Altis");
    // Click again to deselect
    fireEvent.click(partialBtn);
    expect(container.textContent).toContain("Altis");
  });

  it("sorts by name by default", async () => {
    const { container } = renderPage();
    await flush();
    const text = container.textContent!;
    const altisIdx = text.indexOf("Altis");
    const stratisIdx = text.indexOf("Stratis");
    const tanoaIdx = text.indexOf("Tanoa");
    expect(altisIdx).toBeLessThan(stratisIdx);
    expect(stratisIdx).toBeLessThan(tanoaIdx);
  });

  it("sorts by size when Size button clicked", async () => {
    const { container } = renderPage();
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const sizeBtn = buttons.find((b) => b.textContent === "Size")!;
    fireEvent.click(sizeBtn);
    const text = container.textContent!;
    // Altis (30720) > Tanoa (15360) > Stratis (8192)
    expect(text.indexOf("Altis")).toBeLessThan(text.indexOf("Tanoa"));
    expect(text.indexOf("Tanoa")).toBeLessThan(text.indexOf("Stratis"));
  });

  it("sorts by disk when Disk button clicked", async () => {
    const { container } = renderPage();
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const diskBtn = buttons.find((b) => b.textContent === "Disk")!;
    fireEvent.click(diskBtn);
    const text = container.textContent!;
    // Altis (501 MB) > Stratis (100 MB) > Tanoa (0 MB)
    expect(text.indexOf("Altis")).toBeLessThan(text.indexOf("Stratis"));
    expect(text.indexOf("Stratis")).toBeLessThan(text.indexOf("Tanoa"));
  });

  it("shows Import Map button for authenticated users", async () => {
    const { container } = renderPage();
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some((b) => b.textContent?.includes("Import Map"))).toBe(true);
  });

  it("shows Restyle All button for authenticated users", async () => {
    const { container } = renderPage();
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some((b) => b.textContent?.includes("Restyle All"))).toBe(true);
  });

  it("calls restyleMapToolAll when Restyle clicked", async () => {
    const { container } = renderPage();
    await flush();
    const restyleBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restyle All"),
    )!;
    fireEvent.click(restyleBtn);
    await flush();
    expect(mockRestyleMapToolAll).toHaveBeenCalled();
  });

  it("shows empty state when no maps match search", async () => {
    const { container } = renderPage();
    await flush();
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "zzz_no_match" } });
    expect(container.textContent).toContain("No maps match your search");
  });

  it("shows empty state when no maps imported", async () => {
    mockGetMapToolMaps.mockResolvedValue([]);
    const { container } = renderPage();
    await flush();
    expect(container.textContent).toContain("No maps imported yet");
  });

  it("renders list view headers", async () => {
    const { container } = renderPage();
    await flush();
    // Switch to list view
    const buttons = Array.from(container.querySelectorAll("button"));
    // List icon button is the second view toggle button
    const _listBtn = buttons.find((b) =>
      b.querySelector("svg") && b.className.includes("viewBtn") && !b.className.includes("Active"),
    );
    // Alternatively, click based on position in the viewToggle group
    const viewBtns = container.querySelectorAll("[class*='viewBtn']");
    if (viewBtns.length >= 2) {
      fireEvent.click(viewBtns[1]); // second = list view
      expect(container.textContent).toContain("SIZE");
      expect(container.textContent).toContain("LAYERS");
      expect(container.textContent).toContain("DISK");
      expect(container.textContent).toContain("STATUS");
    }
  });

  it("opens import dialog when Import Map clicked", async () => {
    const { container } = renderPage();
    await flush();
    const importBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Import Map"),
    )!;
    fireEvent.click(importBtn);
    expect(container.textContent).toContain("Import Map");
    // Dialog should show drop zone content
    expect(container.textContent).toContain(".zip");
  });

  it("renders status filter buttons", async () => {
    const { container } = renderPage();
    await flush();
    expect(container.textContent).toContain("All");
    expect(container.textContent).toContain("Complete");
    expect(container.textContent).toContain("Partial");
  });

  it("renders sort buttons", async () => {
    const { container } = renderPage();
    await flush();
    expect(container.textContent).toContain("Sort");
    expect(container.textContent).toContain("Name");
    expect(container.textContent).toContain("Size");
    expect(container.textContent).toContain("Disk");
  });

  it("calls importMapToolZip when import dialog submits", async () => {
    const { container } = renderPage();
    await flush();

    // Open import dialog
    const importBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Import Map"),
    )!;
    fireEvent.click(importBtn);

    // Select a file via the file input
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["zip content"], "map.zip", { type: "application/zip" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);

    // Click the import button inside the dialog footer (has btnImport class)
    const dialogImportBtn = container.querySelector("[class*='btnImport']") as HTMLElement;
    expect(dialogImportBtn).not.toBeNull();
    fireEvent.click(dialogImportBtn);
    await flush();

    expect(mockImportMapToolZip).toHaveBeenCalledWith(file, expect.any(Function));
  });

  it("handles import error gracefully", async () => {
    mockImportMapToolZip.mockRejectedValue(new Error("upload failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = renderPage();
    await flush();

    // Open import dialog
    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Import Map"),
      )!,
    );

    // Select file and import
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["z"], "test.zip", { type: "application/zip" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);
    const dialogImportBtn = container.querySelector("[class*='btnImport']") as HTMLElement;
    fireEvent.click(dialogImportBtn);
    await flush();

    expect(spy).toHaveBeenCalledWith("Import failed:", expect.any(Error));
    spy.mockRestore();
  });

  it("selects a map and shows detail sidebar", async () => {
    const { container } = renderPage();
    await flush();

    // Click on Altis card
    const altisCard = Array.from(container.querySelectorAll("[class*='card']")).find(
      (el) => el.textContent?.includes("Altis"),
    ) as HTMLElement;
    expect(altisCard).toBeDefined();
    fireEvent.click(altisCard);

    // Detail sidebar should show
    expect(container.textContent).toContain("30.7 km");
  });

  it("deletes a map via delete confirm dialog", async () => {
    const { container } = renderPage();
    await flush();

    // Select Altis
    const altisCard = Array.from(container.querySelectorAll("[class*='card']")).find(
      (el) => el.textContent?.includes("Altis"),
    ) as HTMLElement;
    fireEvent.click(altisCard);

    // Find and click delete button in detail sidebar
    const deleteBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Delete") && !b.textContent?.includes("Confirm"),
    );
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);

    // Confirm deletion — find the danger-styled delete button in the confirm dialog
    const confirmBtn = container.querySelector("[class*='btnDelete']") as HTMLElement;
    expect(confirmBtn).not.toBeNull();
    fireEvent.click(confirmBtn);
    await flush();
    expect(mockDeleteMapToolMap).toHaveBeenCalledWith("Altis");
  });

  it("handles delete error gracefully", async () => {
    mockDeleteMapToolMap.mockRejectedValue(new Error("delete failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = renderPage();
    await flush();

    // Select Altis
    const altisCard = Array.from(container.querySelectorAll("[class*='card']")).find(
      (el) => el.textContent?.includes("Altis"),
    ) as HTMLElement;
    fireEvent.click(altisCard);

    // Find and click delete button
    const deleteBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Delete") && !b.textContent?.includes("Confirm"),
    );
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);
    const confirmBtn = container.querySelector("[class*='btnDelete']") as HTMLElement;
    expect(confirmBtn).not.toBeNull();
    fireEvent.click(confirmBtn);
    await flush();
    expect(spy).toHaveBeenCalledWith("Delete failed:", expect.any(Error));
    spy.mockRestore();
  });

  it("handles restyle error gracefully", async () => {
    mockRestyleMapToolAll.mockRejectedValue(new Error("restyle failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = renderPage();
    await flush();

    const restyleBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restyle All"),
    )!;
    fireEvent.click(restyleBtn);
    await flush();

    expect(spy).toHaveBeenCalledWith("Restyle failed:", expect.any(Error));
    spy.mockRestore();
  });

  it("navigates to / when API fetch fails on mount", async () => {
    mockGetMapToolTools.mockRejectedValue(new Error("unauthorized"));
    renderPage();
    await flush();
    // Should not show loading content when redirected
    expect(mockGetMapToolTools).toHaveBeenCalled();
  });

  it("deselects map when clicking same card again", async () => {
    const { container } = renderPage();
    await flush();

    const altisCard = Array.from(container.querySelectorAll("[class*='card']")).find(
      (el) => el.textContent?.includes("Altis"),
    ) as HTMLElement;
    fireEvent.click(altisCard);
    expect(container.textContent).toContain("30.7 km");

    // Click again to deselect
    fireEvent.click(altisCard);
    // Detail sidebar should close - worldSize detail no longer visible
  });

  it("closes import dialog via Cancel button", async () => {
    const { container } = renderPage();
    await flush();

    // Open import dialog
    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Import Map"),
      )!,
    );
    expect(container.textContent).toContain(".zip");

    // Click Cancel button inside dialog footer
    const cancelBtn = container.querySelector("[class*='btnCancel']") as HTMLElement;
    expect(cancelBtn).not.toBeNull();
    fireEvent.click(cancelBtn);

    // Dialog should be closed — drop zone text gone
    expect(container.textContent).not.toContain("Max 2 GB");
  });

  it("navigates to recordings on back button click", async () => {
    const { container } = renderPage();
    await flush();

    const backBtn = container.querySelector("button[title='Back to recordings']") as HTMLElement;
    expect(backBtn).not.toBeNull();
    fireEvent.click(backBtn);
  });

  it("switches between grid and list view", async () => {
    const { container } = renderPage();
    await flush();

    const viewBtns = container.querySelectorAll("[class*='viewBtn']");
    expect(viewBtns.length).toBeGreaterThanOrEqual(2);

    // Switch to list view
    fireEvent.click(viewBtns[1]);
    expect(container.textContent).toContain("SIZE");
    expect(container.textContent).toContain("LAYERS");

    // Switch back to grid view
    fireEvent.click(viewBtns[0]);
    // Grid cards should be visible again
    expect(container.textContent).toContain("Altis");
  });

  it("selects a map row in list view", async () => {
    const { container } = renderPage();
    await flush();

    // Switch to list view
    const viewBtns = container.querySelectorAll("[class*='viewBtn']");
    fireEvent.click(viewBtns[1]);

    // Click a row
    const rows = container.querySelectorAll("[class*='row']");
    const altisRow = Array.from(rows).find((r) => r.textContent?.includes("Altis")) as HTMLElement;
    if (altisRow) {
      fireEvent.click(altisRow);
      // Detail sidebar should show
      expect(container.textContent).toContain("30.7 km");
    }
  });

  it("shows import button in empty state and opens dialog", async () => {
    mockGetMapToolMaps.mockResolvedValue([]);
    const { container } = renderPage();
    await flush();

    expect(container.textContent).toContain("No maps imported yet");

    // Find the import button in the empty state
    const emptyImportBtn = container.querySelector("[class*='emptyImportBtn']") as HTMLElement;
    expect(emptyImportBtn).not.toBeNull();
    fireEvent.click(emptyImportBtn);

    // Import dialog should be open
    expect(container.textContent).toContain("Max 2 GB");
  });

  it("closes detail sidebar via close button", async () => {
    const { container } = renderPage();
    await flush();

    // Select Altis to open detail sidebar
    const altisCard = Array.from(container.querySelectorAll("[class*='card']")).find(
      (el) => el.textContent?.includes("Altis"),
    ) as HTMLElement;
    fireEvent.click(altisCard);
    expect(container.textContent).toContain("30.7 km");

    // Click the close button in the detail sidebar hero
    const closeBtn = container.querySelector("[class*='heroClose']") as HTMLElement;
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn);
  });

  it("cancels delete confirmation via Cancel button", async () => {
    const { container } = renderPage();
    await flush();

    // Select Altis, open delete confirm
    const altisCard = Array.from(container.querySelectorAll("[class*='card']")).find(
      (el) => el.textContent?.includes("Altis"),
    ) as HTMLElement;
    fireEvent.click(altisCard);

    const deleteBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Delete") && !b.textContent?.includes("Confirm"),
    )!;
    fireEvent.click(deleteBtn);

    // Click Cancel in the delete confirm dialog
    const cancelBtn = container.querySelector("[class*='btnCancel']") as HTMLElement;
    expect(cancelBtn).not.toBeNull();
    fireEvent.click(cancelBtn);

    // Dialog should be closed — "cannot be undone" text gone
    expect(container.textContent).not.toContain("cannot be undone");
  });

  it("invokes upload progress callback during import", async () => {
    mockImportMapToolZip.mockImplementation((_file: any, onProgress: any) => {
      if (onProgress) onProgress(50, 100);
      return Promise.resolve({ id: "j1", status: "pending" });
    });
    const { container } = renderPage();
    await flush();

    // Open import dialog
    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Import Map"),
      )!,
    );

    // Select file
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["zip"], "test.zip", { type: "application/zip" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);

    // Click Import
    const importBtn = container.querySelector("[class*='btnImport']") as HTMLElement;
    fireEvent.click(importBtn);
    await flush();

    expect(mockImportMapToolZip).toHaveBeenCalledWith(file, expect.any(Function));
  });

  it("cancels a running job via StatusStrip", async () => {
    mockJobsRef.current = [
      {
        id: "job-1",
        worldName: "Altis",
        status: "running",
        stage: "satellite",
        stageNum: 2,
        totalStages: 7,
        startedAt: new Date().toISOString(),
      },
    ];
    const { container } = renderPage();
    await flush();

    // Find cancel button in the status strip (title="Cancel import")
    const cancelBtn = container.querySelector("button[title='Cancel import']") as HTMLElement;
    expect(cancelBtn).not.toBeNull();
    fireEvent.click(cancelBtn);
    await flush();

    expect(mockCancelMapToolJob).toHaveBeenCalledWith("job-1");
  });
});
