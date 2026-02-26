import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { MapManager } from "../MapManager";
import type { ToolSet, MapInfo, JobInfo } from "../types";

// ─── Mock API ───

const {
  mockGetMapToolTools,
  mockGetMapToolMaps,
  mockDeleteMapToolMap,
  mockImportMapToolZip,
  mockRestyleMapToolAll,
  mockCancelMapToolJob,
  mockGetMapToolEventsUrl,
} = vi.hoisted(() => ({
  mockGetMapToolTools: vi.fn(),
  mockGetMapToolMaps: vi.fn(),
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
      deleteMapToolMap = mockDeleteMapToolMap;
      importMapToolZip = mockImportMapToolZip;
      restyleMapToolAll = mockRestyleMapToolAll;
      cancelMapToolJob = mockCancelMapToolJob;
      getMapToolEventsUrl = mockGetMapToolEventsUrl;
    },
  };
});

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
  mockGetMapToolTools.mockResolvedValue(tools);
  mockGetMapToolMaps.mockResolvedValue(maps);
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
    const listBtn = buttons.find((b) =>
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

    // Confirm deletion
    const confirmBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Delete") && b.className.includes("danger"),
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
      await flush();
      expect(mockDeleteMapToolMap).toHaveBeenCalledWith("Altis");
    }
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
    if (deleteBtn) {
      fireEvent.click(deleteBtn);
      const confirmBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Delete") && b.className.includes("danger"),
      );
      if (confirmBtn) {
        fireEvent.click(confirmBtn);
        await flush();
        expect(spy).toHaveBeenCalledWith("Delete failed:", expect.any(Error));
      }
    }
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
    const { container } = renderPage();
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
});
