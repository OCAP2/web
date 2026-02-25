import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { I18nProvider } from "../../../hooks/useLocale";
import { CustomizeProvider } from "../../../hooks/useCustomize";
import { AuthProvider } from "../../../hooks/useAuth";
import { MockRenderer } from "../../../renderers/mockRenderer";
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
