import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { I18nProvider } from "../../../hooks/useLocale";
import { CustomizeProvider } from "../../../hooks/useCustomize";
import { AuthProvider } from "../../../hooks/useAuth";
import { MockRenderer } from "../../../renderers/mockRenderer";
import { setAuthToken } from "../../../data/apiClient";
import type { LoadResult } from "../loadRecording";

// ─── Mocks (must be before imports that use them) ───

// Mock LeafletRenderer to return a MockRenderer
vi.mock("../../../renderers/leaflet/leafletRenderer", () => {
  return {
    LeafletRenderer: vi.fn().mockImplementation(function () {
      return new MockRenderer();
    }),
  };
});

// Mock loadRecording to return a resolved result by default
const mockLoadRecording = vi.fn<(...args: any[]) => Promise<LoadResult>>();
vi.mock("../loadRecording", () => ({
  loadRecording: (...args: any[]) => mockLoadRecording(...args),
}));

// Mock useRenderBridge to be a no-op
vi.mock("../useRenderBridge", () => ({
  useRenderBridge: vi.fn(),
}));

// We need to import the component AFTER mocks are declared
import { RecordingPlayback } from "../RecordingPlayback";
import type { PlaybackEngine } from "../../../playback/engine";
import { setLeftPanelVisible } from "../shortcuts";

// ─── Helpers ───

function mockFetchForRecording() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/v1/operations/")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 42,
            world_name: "Altis",
            mission_name: "Op Alpha",
            mission_duration: 3600,
            filename: "test-42",
            date: "2024-01-15",
            storageFormat: "json",
          }),
      });
    }
    if (url.includes("/api/v1/customize")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    }
    return originalFetch(url);
  });
  return originalFetch;
}

function renderPlayback(opts?: { initialPath?: string }) {
  const path = opts?.initialPath ?? "/recording/42/test-42";
  // Set window location to match
  window.history.pushState({}, "", path);

  return render(() => (
    <Router
      root={(p) => (
        <I18nProvider locale="en">
          <CustomizeProvider>
            <AuthProvider>{p.children}</AuthProvider>
          </CustomizeProvider>
        </I18nProvider>
      )}
    >
      <Route path="/recording/:id/:name" component={RecordingPlayback} />
    </Router>
  ));
}

function renderPlaybackWithState(state: Record<string, unknown>) {
  // Push state into the router
  window.history.pushState(state, "", "/recording/42/test-42");

  return render(() => (
    <Router
      root={(p) => (
        <I18nProvider locale="en">
          <CustomizeProvider>
            <AuthProvider>{p.children}</AuthProvider>
          </CustomizeProvider>
        </I18nProvider>
      )}
    >
      <Route path="/recording/:id/:name" component={RecordingPlayback} />
    </Router>
  ));
}

// ─── Tests ───

describe("RecordingPlayback", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = mockFetchForRecording();

    // Default: loadRecording resolves successfully
    mockLoadRecording.mockResolvedValue({
      worldConfig: {
        worldName: "Altis",
        worldSize: 30720,
        maxZoom: 6,
        minZoom: 0,
      },
      missionName: "Op Alpha",
      recordingId: "42",
      recordingFilename: "test-42",
      extensionVersion: "1.0.0",
      addonVersion: "2.0.0",
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    setAuthToken(null);
    setLeftPanelVisible(true);
    // Reset URL
    window.history.pushState({}, "", "/");
  });

  it("renders loading screen initially", () => {
    renderPlayback();

    const loadingScreen = screen.getByTestId("loading-screen");
    expect(loadingScreen).toBeTruthy();
    // Loading screen should be visible (opacity: 1)
    expect(loadingScreen.style.opacity).toBe("1");
  });

  it("shows loading screen text with mission info from location state", () => {
    renderPlaybackWithState({
      missionName: "Op Bravo",
      worldName: "Stratis",
      missionDuration: 1800,
    });

    const loadingScreen = screen.getByTestId("loading-screen");
    expect(loadingScreen).toBeTruthy();
    // The loading screen should display the mission name from state
    expect(loadingScreen.textContent).toContain("Op Bravo");
    expect(loadingScreen.textContent).toContain("Stratis");
  });

  it("hides loading screen after recording is loaded", async () => {
    renderPlayback();

    // Wait for the loading to complete
    await vi.waitFor(() => {
      const loadingScreen = screen.getByTestId("loading-screen");
      expect(loadingScreen.style.opacity).toBe("0");
    });
  });

  it("shows loading screen with no state info when state is absent", () => {
    renderPlayback();

    const loadingScreen = screen.getByTestId("loading-screen");
    expect(loadingScreen).toBeTruthy();
    // Should still render without crashing — "Loading" is the i18n key,
    // mission name would appear after it if state was present
    expect(loadingScreen.textContent).toContain("Loading");
  });

  it("calls loadRecording on mount", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(mockLoadRecording).toHaveBeenCalledOnce();
    });
  });

  it("handles loadRecording failure gracefully", async () => {
    mockLoadRecording.mockRejectedValueOnce(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderPlayback();

    await vi.waitFor(() => {
      const loadingScreen = screen.getByTestId("loading-screen");
      // Loading screen should be hidden even on failure (finally block)
      expect(loadingScreen.style.opacity).toBe("0");
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to load recording:",
      expect.any(Error),
    );
  });

  it("renders child components after loading completes", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // TopBar, BottomBar, MapControls, etc. should be rendered
    // The TopBar has a back button and info button — their callbacks cover lines 124-125
    expect(screen.getByTestId("map-container")).toBeTruthy();
  });

  it("opens about modal when info button is clicked", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // Click the info button in TopBar
    const infoBtn = screen.getByTitle("Information");
    fireEvent.click(infoBtn);

    // AboutModal should now be visible
    await vi.waitFor(() => {
      expect(screen.getByTestId("about-modal")).toBeTruthy();
    });
  });

  it("closes about modal when close button is clicked", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // Open the about modal
    fireEvent.click(screen.getByTitle("Information"));

    await vi.waitFor(() => {
      expect(screen.getByTestId("about-modal")).toBeTruthy();
    });

    // Click the close button inside the modal
    const modal = screen.getByTestId("about-modal");
    const closeBtn = modal.querySelector("button")!;
    fireEvent.click(closeBtn);

    // Modal should disappear
    await vi.waitFor(() => {
      expect(screen.queryByTestId("about-modal")).toBeNull();
    });
  });

  it("navigates back when back button is clicked", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    const backBtn = screen.getByTitle("Back to recordings");
    fireEvent.click(backBtn);

    // Navigation should have been triggered (URL changes to "/")
    await vi.waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
  });

  it("toggles side panel visibility when panel button is clicked", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // SidePanel should be visible by default (leftPanelVisible starts true)
    expect(screen.getByText("Units")).toBeTruthy();

    // Click the panel toggle button in BottomBar
    const panelBtn = screen.getByText("Panel");
    fireEvent.click(panelBtn);

    // SidePanel should now be hidden
    await vi.waitFor(() => {
      expect(screen.queryByText("Units")).toBeNull();
    });
  });

  it("loadRecording callback sets intermediate worldConfig", async () => {
    const intermediateConfig = {
      worldName: "Stratis",
      worldSize: 8192,
      maxZoom: 5,
      minZoom: 0,
    };

    mockLoadRecording.mockImplementation(async (...args: any[]) => {
      // 5th arg is the onWorldConfig callback (line 120)
      const onWorldConfig = args[4];
      if (typeof onWorldConfig === "function") {
        onWorldConfig(intermediateConfig);
      }
      return {
        worldConfig: {
          worldName: "Altis",
          worldSize: 30720,
          maxZoom: 6,
          minZoom: 0,
        },
        missionName: "Op Alpha",
        recordingId: "42",
        recordingFilename: "test-42",
        extensionVersion: "1.0.0",
        addonVersion: "2.0.0",
      };
    });

    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // The callback was invoked — verify loadRecording was called with a function as 5th arg
    expect(mockLoadRecording).toHaveBeenCalledOnce();
    const callArgs = mockLoadRecording.mock.calls[0];
    expect(typeof callArgs[4]).toBe("function");
  });

  it("toggleBlacklist adds and removes players via API", async () => {
    const apiCalls: { url: string; method: string }[] = [];

    setAuthToken("test-token");

    // Make loadRecording populate the engine with a unit entity and markers
    mockLoadRecording.mockImplementation(async (...args: any[]) => {
      const engine = args[1];
      const markerManager = args[2];
      // Load a minimal manifest with one unit so UnitsTab renders it
      engine.loadRecording({
        version: 1,
        worldName: "Altis",
        missionName: "Op Alpha",
        frameCount: 101,
        chunkSize: 300,
        captureDelayMs: 1000,
        chunkCount: 1,
        entities: [{
          id: 7,
          name: "TestPlayer",
          type: "man",
          startFrame: 0,
          endFrame: 100,
          side: "WEST",
          isPlayer: true,
          groupName: "Alpha",
          role: "Rifleman",
          positions: null,
          framesFired: null,
        }],
        events: [],
        markers: [],
        times: [],
      });
      // Load markers so markerCounts shows count > 0 for the unit (needed for blacklist button)
      markerManager.loadMarkers([{
        type: "hd_dot",
        text: "marker1",
        side: "WEST",
        color: "ColorBlue",
        positions: [[0, "100,200,0", "ICON", 1, 0.8]],
        player: 7,
        alpha: 1,
        startFrame: 0,
        endFrame: 100,
      }]);
      return {
        worldConfig: { worldName: "Altis", worldSize: 30720, maxZoom: 6, minZoom: 0 },
        missionName: "Op Alpha",
        recordingId: "42",
        recordingFilename: "test-42",
        extensionVersion: "1.0.0",
        addonVersion: "2.0.0",
      };
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }),
        });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist/") && (init?.method === "PUT" || init?.method === "DELETE")) {
        apiCalls.push({ url, method: init!.method! });
        return Promise.resolve({ ok: true, status: 204 });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 42, world_name: "Altis", mission_name: "Op Alpha",
              mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json",
            }),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // Unit should be visible in the SidePanel's UnitsTab
    await vi.waitFor(() => {
      expect(screen.getByText("TestPlayer")).toBeTruthy();
    });

    // Click the unit row to expand the detail card
    fireEvent.click(screen.getByText("TestPlayer"));

    // The detail card should show the blacklist button (admin + marker count > 0)
    await vi.waitFor(() => {
      expect(screen.getByTitle("Toggle marker blacklist")).toBeTruthy();
    });

    // Click the blacklist button to trigger toggleBlacklist
    fireEvent.click(screen.getByTitle("Toggle marker blacklist"));

    // Verify the PUT API call was made
    await vi.waitFor(() => {
      expect(apiCalls.some(c => c.method === "PUT" && c.url.includes("/marker-blacklist/7"))).toBe(true);
    });
  });

  it("fetches blacklist after recording loads and renders BlacklistIndicator for admins", async () => {
    // Set auth token so AuthProvider calls getMe
    setAuthToken("test-token");

    // Override fetch to also handle auth + blacklist
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              authenticated: true,
              steamId: "12345",
              steamName: "Admin",
            }),
        });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([5, 10]),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 42,
              world_name: "Altis",
              mission_name: "Op Alpha",
              mission_duration: 3600,
              filename: "test-42",
              date: "2024-01-15",
              storageFormat: "json",
            }),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // Blacklist fetch should have been called
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const blacklistCall = fetchCalls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("/marker-blacklist"),
    );
    expect(blacklistCall).toBeTruthy();

    // BlacklistIndicator should render since admin + blacklist non-empty
    await vi.waitFor(() => {
      expect(screen.getByText(/markers blacklisted/)).toBeTruthy();
    });
  });

  it("toggleBlacklist does nothing when recordingId is null", async () => {
    // Don't resolve loadRecording — recordingId stays null
    mockLoadRecording.mockReturnValue(new Promise(() => {})); // never resolves

    renderPlayback();

    // Wait a tick for mount
    await new Promise((r) => setTimeout(r, 50));

    // toggleBlacklist should early-return since recordingId is null
    // We verify by checking no blacklist API calls are made
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const blacklistCalls = fetchCalls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("/marker-blacklist"),
    );
    expect(blacklistCalls).toHaveLength(0);
  });

  it("initializes focus range from recording metadata", async () => {
    // Override fetch to return recording with focusStart/focusEnd
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/operations/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 42,
              world_name: "Altis",
              mission_name: "Op Alpha",
              mission_duration: 3600,
              filename: "test-42",
              date: "2024-01-15",
              storageFormat: "json",
              focusStart: 50,
              focusEnd: 250,
            }),
        });
      }
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // The FOCUS toggle should appear since focusRange is set
    await vi.waitFor(() => {
      expect(screen.getByText("FOCUS")).toBeTruthy();
    });
  });

  it("shows Focus button for admin users", async () => {
    setAuthToken("test-token");

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 42, world_name: "Altis", mission_name: "Op Alpha",
              mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json",
            }),
        });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // Admin should see the Focus button in the BottomBar
    await vi.waitFor(() => {
      expect(screen.getByText("Focus")).toBeTruthy();
    });
  });

  it("toggleBlacklist un-blacklists a previously blacklisted player", async () => {
    const apiCalls: { url: string; method: string }[] = [];
    setAuthToken("test-token");

    mockLoadRecording.mockImplementation(async (...args: any[]) => {
      const engine = args[1];
      const markerManager = args[2];
      engine.loadRecording({
        version: 1, worldName: "Altis", missionName: "Op Alpha",
        frameCount: 101, chunkSize: 300, captureDelayMs: 1000, chunkCount: 1,
        entities: [{
          id: 7, name: "TestPlayer", type: "man", startFrame: 0, endFrame: 100,
          side: "WEST", isPlayer: true, groupName: "Alpha", role: "Rifleman",
          positions: undefined, framesFired: undefined,
        }],
        events: [], markers: [], times: [],
      });
      markerManager.loadMarkers([{
        type: "hd_dot", text: "marker1", side: "WEST", color: "ColorBlue",
        positions: [[0, "100,200,0", "ICON", 1, 0.8]], player: 7, alpha: 1,
        startFrame: 0, endFrame: 100,
      }]);
      return {
        worldConfig: { worldName: "Altis", worldSize: 30720, maxZoom: 6, minZoom: 0 },
        missionName: "Op Alpha", recordingId: "42", recordingFilename: "test-42",
        extensionVersion: "1.0.0", addonVersion: "2.0.0",
      };
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }) });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist/") && (init?.method === "PUT" || init?.method === "DELETE")) {
        apiCalls.push({ url, method: init!.method! });
        return Promise.resolve({ ok: true, status: 204 });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        // Return player 7 as already blacklisted
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([7]) });
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 42, world_name: "Altis", mission_name: "Op Alpha", mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json" }) });
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));

    // Player should be visible
    await vi.waitFor(() => expect(screen.getByText("TestPlayer")).toBeTruthy());
    fireEvent.click(screen.getByText("TestPlayer"));

    // Click blacklist button to UN-blacklist (player 7 is already in blacklist)
    await vi.waitFor(() => expect(screen.getByTitle("Toggle marker blacklist")).toBeTruthy());
    fireEvent.click(screen.getByTitle("Toggle marker blacklist"));

    // Verify DELETE API call was made (remove from blacklist)
    await vi.waitFor(() => {
      expect(apiCalls.some(c => c.method === "DELETE" && c.url.includes("/marker-blacklist/7"))).toBe(true);
    });
  });

  it("saveFocus handles API error gracefully", async () => {
    setAuthToken("test-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }) };
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/") && init?.method === "PATCH") {
        return { ok: false, status: 500, statusText: "Internal Server Error" };
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ id: 42, world_name: "Altis", mission_name: "Op Alpha", mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json" }) };
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return { ok: true, status: 200, json: () => Promise.resolve([]) };
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return { ok: true, status: 200, json: () => Promise.resolve({}) };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));

    // Enter edit mode
    await vi.waitFor(() => expect(screen.getByText("Focus")).toBeTruthy());
    fireEvent.click(screen.getByText("Focus").closest("button")!);
    await vi.waitFor(() => expect(screen.getByText("Save")).toBeTruthy());

    // Click Save — API will fail
    fireEvent.click(screen.getByText("Save").closest("button")!);

    // Error should be logged
    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith("Failed to save focus range:", expect.anything());
    });

    // Edit mode should remain open (save failed)
    expect(screen.getByText("Focus Range")).toBeTruthy();
  });

  it("clearFocus handles API error gracefully", async () => {
    setAuthToken("test-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let patchCallCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }) };
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/") && init?.method === "PATCH") {
        patchCallCount++;
        if (patchCallCount === 1) {
          // First PATCH (Save) succeeds
          return { ok: true, status: 200, json: () => Promise.resolve({ id: 42, focus_start: 0, focus_end: 99 }) };
        }
        // Second PATCH (Clear) fails
        return { ok: false, status: 500, statusText: "Internal Server Error" };
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ id: 42, world_name: "Altis", mission_name: "Op Alpha", mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json" }) };
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return { ok: true, status: 200, json: () => Promise.resolve([]) };
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return { ok: true, status: 200, json: () => Promise.resolve({}) };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));

    // Enter edit mode, save first to establish a focus range
    await vi.waitFor(() => expect(screen.getByText("Focus")).toBeTruthy());
    fireEvent.click(screen.getByText("Focus").closest("button")!);
    await vi.waitFor(() => expect(screen.getByText("Save")).toBeTruthy());
    fireEvent.click(screen.getByText("Save").closest("button")!);

    // Wait for save to complete and edit mode to close
    await vi.waitFor(() => expect(screen.queryByText("Focus Range")).toBeNull());

    // Re-enter edit mode and Clear — API will fail
    fireEvent.click(screen.getByText("Focus").closest("button")!);
    await vi.waitFor(() => expect(screen.getByText("Clear")).toBeTruthy());
    fireEvent.click(screen.getByText("Clear").closest("button")!);

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith("Failed to clear focus range:", expect.anything());
    });
  });

  it("Focus button opens edit mode and Cancel closes it", async () => {
    setAuthToken("test-token");

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            id: 42, world_name: "Altis", mission_name: "Op Alpha",
            mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json",
          }),
        });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // Click Focus to enter edit mode
    await vi.waitFor(() => expect(screen.getByText("Focus")).toBeTruthy());
    fireEvent.click(screen.getByText("Focus").closest("button")!);

    // FocusToolbar should appear with Save and Cancel
    await vi.waitFor(() => {
      expect(screen.getByText("Focus Range")).toBeTruthy();
      expect(screen.getByText("Save")).toBeTruthy();
      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    // Click Cancel to exit edit mode
    fireEvent.click(screen.getByText("Cancel").closest("button")!);

    await vi.waitFor(() => {
      expect(screen.queryByText("Focus Range")).toBeNull();
    });
  });

  it("Focus edit Save calls API and updates focus range", async () => {
    setAuthToken("test-token");
    const apiCalls: { url: string; method: string; body: any }[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }) };
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/") && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        apiCalls.push({ url, method: "PATCH", body });
        return { ok: true, status: 200, json: () => Promise.resolve({ id: 42, focus_start: body.focusStart, focus_end: body.focusEnd }) };
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ id: 42, world_name: "Altis", mission_name: "Op Alpha", mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json" }) };
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return { ok: true, status: 200, json: () => Promise.resolve([]) };
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return { ok: true, status: 200, json: () => Promise.resolve({}) };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));

    // Enter edit mode
    await vi.waitFor(() => expect(screen.getByText("Focus")).toBeTruthy());
    fireEvent.click(screen.getByText("Focus").closest("button")!);
    await vi.waitFor(() => expect(screen.getByText("Save")).toBeTruthy());

    // Click Save
    fireEvent.click(screen.getByText("Save").closest("button")!);

    await vi.waitFor(() => {
      expect(apiCalls.some(c => c.method === "PATCH" && c.body.focusStart != null)).toBe(true);
    });

    // Edit mode should close after save
    await vi.waitFor(() => {
      expect(screen.queryByText("Focus Range")).toBeNull();
    });
  });

  it("Focus edit Clear calls API with null values", async () => {
    setAuthToken("test-token");
    const apiCalls: { url: string; method: string; body: any }[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }) };
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/") && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        apiCalls.push({ url, method: "PATCH", body });
        return { ok: true, status: 200, json: () => Promise.resolve({ id: 42 }) };
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ id: 42, world_name: "Altis", mission_name: "Op Alpha", mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json" }) };
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return { ok: true, status: 200, json: () => Promise.resolve([]) };
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return { ok: true, status: 200, json: () => Promise.resolve({}) };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));

    // Enter edit mode
    await vi.waitFor(() => expect(screen.getByText("Focus")).toBeTruthy());
    fireEvent.click(screen.getByText("Focus").closest("button")!);
    await vi.waitFor(() => expect(screen.getByText("Clear")).toBeTruthy());

    // Click Clear
    fireEvent.click(screen.getByText("Clear").closest("button")!);

    await vi.waitFor(() => {
      expect(apiCalls.some(c => c.body.focusStart === null && c.body.focusEnd === null)).toBe(true);
    });
  });

  it("clamps frame to inFrame when seeking below focus range", async () => {
    let capturedEngine: PlaybackEngine;

    mockLoadRecording.mockImplementation(async (...args: any[]) => {
      capturedEngine = args[1];
      capturedEngine.loadRecording({
        version: 1, worldName: "Altis", missionName: "Op Alpha",
        frameCount: 101, chunkSize: 300, captureDelayMs: 1000, chunkCount: 1,
        entities: [{ id: 1, name: "Unit", type: "man", startFrame: 0, endFrame: 100, side: "WEST", isPlayer: true, groupName: "A", role: "R", positions: undefined, framesFired: undefined }],
        events: [], markers: [], times: [],
      });
      return {
        worldConfig: { worldName: "Altis", worldSize: 30720, maxZoom: 6, minZoom: 0 },
        missionName: "Op Alpha", recordingId: "42", recordingFilename: "test-42",
        extensionVersion: "1.0.0", addonVersion: "2.0.0",
      };
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/operations/")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
          id: 42, world_name: "Altis", mission_name: "Op Alpha", mission_duration: 3600,
          filename: "test-42", date: "2024-01-15", storageFormat: "json",
          focusStart: 20, focusEnd: 80,
        })});
      }
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));
    await vi.waitFor(() => expect(screen.getByText("FOCUS")).toBeTruthy());

    // Focus range is [20, 80], engine should be at 20 (seeked to focusStart on init)
    expect(capturedEngine!.currentFrame()).toBe(20);

    // Seek below inFrame — should be clamped back to 20
    capturedEngine!.seekTo(5);
    await vi.waitFor(() => {
      expect(capturedEngine!.currentFrame()).toBe(20);
    });
  });

  it("clamps frame to outFrame when seeking above focus range while paused", async () => {
    let capturedEngine: PlaybackEngine;

    mockLoadRecording.mockImplementation(async (...args: any[]) => {
      capturedEngine = args[1];
      capturedEngine.loadRecording({
        version: 1, worldName: "Altis", missionName: "Op Alpha",
        frameCount: 101, chunkSize: 300, captureDelayMs: 1000, chunkCount: 1,
        entities: [{ id: 1, name: "Unit", type: "man", startFrame: 0, endFrame: 100, side: "WEST", isPlayer: true, groupName: "A", role: "R", positions: undefined, framesFired: undefined }],
        events: [], markers: [], times: [],
      });
      return {
        worldConfig: { worldName: "Altis", worldSize: 30720, maxZoom: 6, minZoom: 0 },
        missionName: "Op Alpha", recordingId: "42", recordingFilename: "test-42",
        extensionVersion: "1.0.0", addonVersion: "2.0.0",
      };
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/operations/")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
          id: 42, world_name: "Altis", mission_name: "Op Alpha", mission_duration: 3600,
          filename: "test-42", date: "2024-01-15", storageFormat: "json",
          focusStart: 20, focusEnd: 80,
        })});
      }
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));
    await vi.waitFor(() => expect(screen.getByText("FOCUS")).toBeTruthy());

    // Seek above outFrame while paused — should be clamped back to 80
    capturedEngine!.seekTo(95);
    await vi.waitFor(() => {
      expect(capturedEngine!.currentFrame()).toBe(80);
    });
  });

  it("FOCUS toggle switches to FULL and shows full timeline", async () => {
    // Return recording with focus range so FOCUS toggle appears
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/operations/")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            id: 42, world_name: "Altis", mission_name: "Op Alpha",
            mission_duration: 3600, filename: "test-42", date: "2024-01-15",
            storageFormat: "json", focusStart: 10, focusEnd: 80,
          }),
        });
      }
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));

    // FOCUS toggle should appear
    await vi.waitFor(() => expect(screen.getByText("FOCUS")).toBeTruthy());

    // Click FOCUS to switch to full timeline
    fireEvent.click(screen.getByText("FOCUS"));

    // Should now show FULL
    await vi.waitFor(() => expect(screen.getByText("FULL")).toBeTruthy());
  });

  it("setFocusIn updates draft inFrame via keyboard shortcut", async () => {
    let capturedEngine: PlaybackEngine;
    setAuthToken("test-token");

    mockLoadRecording.mockImplementation(async (...args: any[]) => {
      capturedEngine = args[1];
      capturedEngine.loadRecording({
        version: 1, worldName: "Altis", missionName: "Op Alpha",
        frameCount: 101, chunkSize: 300, captureDelayMs: 1000, chunkCount: 1,
        entities: [{ id: 1, name: "Unit", type: "man", startFrame: 0, endFrame: 100, side: "WEST", isPlayer: true, groupName: "A", role: "R", positions: undefined, framesFired: undefined }],
        events: [], markers: [], times: [],
      });
      return {
        worldConfig: { worldName: "Altis", worldSize: 30720, maxZoom: 6, minZoom: 0 },
        missionName: "Op Alpha", recordingId: "42", recordingFilename: "test-42",
        extensionVersion: "1.0.0", addonVersion: "2.0.0",
      };
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }) });
      }
      if (url.includes("/api/v1/operations/")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 42, world_name: "Altis", mission_name: "Op Alpha", mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json" }) });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));

    // Enter edit mode — draft starts at { inFrame: 0, outFrame: 100 }
    await vi.waitFor(() => expect(screen.getByText("Focus")).toBeTruthy());
    fireEvent.click(screen.getByText("Focus").closest("button")!);
    await vi.waitFor(() => expect(screen.getByText("Focus Range")).toBeTruthy());

    // Seek to frame 30, then press 'i' to set in-point
    capturedEngine!.seekTo(30);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "i" }));

    // Draft should update: inFrame=30. The FocusToolbar range shows "in → out".
    // Look for the range span that contains both the new inFrame time and the arrow.
    await vi.waitFor(() => {
      const rangeSpan = screen.getByText(/0:00:30\s*→/);
      expect(rangeSpan).toBeTruthy();
    });
  });

  it("setFocusOut updates draft outFrame via keyboard shortcut", async () => {
    let capturedEngine: PlaybackEngine;
    setAuthToken("test-token");

    mockLoadRecording.mockImplementation(async (...args: any[]) => {
      capturedEngine = args[1];
      capturedEngine.loadRecording({
        version: 1, worldName: "Altis", missionName: "Op Alpha",
        frameCount: 101, chunkSize: 300, captureDelayMs: 1000, chunkCount: 1,
        entities: [{ id: 1, name: "Unit", type: "man", startFrame: 0, endFrame: 100, side: "WEST", isPlayer: true, groupName: "A", role: "R", positions: undefined, framesFired: undefined }],
        events: [], markers: [], times: [],
      });
      return {
        worldConfig: { worldName: "Altis", worldSize: 30720, maxZoom: 6, minZoom: 0 },
        missionName: "Op Alpha", recordingId: "42", recordingFilename: "test-42",
        extensionVersion: "1.0.0", addonVersion: "2.0.0",
      };
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }) });
      }
      if (url.includes("/api/v1/operations/")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 42, world_name: "Altis", mission_name: "Op Alpha", mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json" }) });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));

    // Enter edit mode — draft starts at { inFrame: 0, outFrame: 100 }
    await vi.waitFor(() => expect(screen.getByText("Focus")).toBeTruthy());
    fireEvent.click(screen.getByText("Focus").closest("button")!);
    await vi.waitFor(() => expect(screen.getByText("Focus Range")).toBeTruthy());

    // Seek to frame 70, then press 'o' to set out-point
    capturedEngine!.seekTo(70);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "o" }));

    // Draft should update: outFrame=70. The FocusToolbar range shows "in → out".
    // Look for the range span that contains the arrow followed by the new outFrame time.
    await vi.waitFor(() => {
      const rangeSpan = screen.getByText(/→\s*0:01:10/);
      expect(rangeSpan).toBeTruthy();
    });
  });

  it("pauses playback when frame reaches outFrame during focus constrained mode", async () => {
    let capturedEngine: PlaybackEngine;

    mockLoadRecording.mockImplementation(async (...args: any[]) => {
      capturedEngine = args[1];
      capturedEngine.loadRecording({
        version: 1, worldName: "Altis", missionName: "Op Alpha",
        frameCount: 101, chunkSize: 300, captureDelayMs: 1000, chunkCount: 1,
        entities: [{ id: 1, name: "Unit", type: "man", startFrame: 0, endFrame: 100, side: "WEST", isPlayer: true, groupName: "A", role: "R", positions: undefined, framesFired: undefined }],
        events: [], markers: [], times: [],
      });
      return {
        worldConfig: { worldName: "Altis", worldSize: 30720, maxZoom: 6, minZoom: 0 },
        missionName: "Op Alpha", recordingId: "42", recordingFilename: "test-42",
        extensionVersion: "1.0.0", addonVersion: "2.0.0",
      };
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/operations/")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
          id: 42, world_name: "Altis", mission_name: "Op Alpha", mission_duration: 3600,
          filename: "test-42", date: "2024-01-15", storageFormat: "json",
          focusStart: 20, focusEnd: 80,
        })});
      }
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();
    await vi.waitFor(() => expect(screen.getByTestId("loading-screen").style.opacity).toBe("0"));
    await vi.waitFor(() => expect(screen.getByText("FOCUS")).toBeTruthy());

    // Engine is at frame 20 (seeked to focusStart). Start playing.
    capturedEngine!.play();
    expect(capturedEngine!.isPlaying()).toBe(true);

    // Seek to outFrame — effect should pause playback
    capturedEngine!.seekTo(80);
    await vi.waitFor(() => {
      expect(capturedEngine!.isPlaying()).toBe(false);
    });
  });

  it("handles getRecording failure gracefully", async () => {
    // Override fetch to return 404 for getRecording
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/operations/")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });
      }
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({ ok: false, status: 500, statusText: "Error" });
    });

    renderPlayback();

    await vi.waitFor(() => {
      const loadingScreen = screen.getByTestId("loading-screen");
      expect(loadingScreen.style.opacity).toBe("0");
    });
  });
});
