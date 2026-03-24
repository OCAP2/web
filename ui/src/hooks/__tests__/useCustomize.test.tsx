import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { CustomizeProvider, useCustomize } from "../useCustomize";
import type { CustomizeConfig } from "../../data/apiClient";

// ─── Mock ApiClient ───

const mockGetCustomize = vi.fn();

vi.mock("../../data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../../data/apiClient")>("../../data/apiClient");
  return {
    ...actual,
    ApiClient: class {
      getCustomize = mockGetCustomize;
    },
  };
});

// ─── Test consumer component ───

function TestConsumer(props: { onConfig: (config: CustomizeConfig) => void }) {
  const config = useCustomize();
  props.onConfig(config());
  return <div data-testid="config">{JSON.stringify(config())}</div>;
}

// ─── Tests ───

describe("useCustomize", () => {
  beforeEach(() => {
    mockGetCustomize.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // Clean up any leftover style properties
    document.documentElement.style.removeProperty("--accent-primary");
    document.documentElement.style.removeProperty("--bg-dark");
  });

  it("provides default empty config", () => {
    let received: CustomizeConfig | undefined;
    render(() => (
      <CustomizeProvider>
        <TestConsumer onConfig={(c) => (received = c)} />
      </CustomizeProvider>
    ));
    expect(received).toEqual({});
  });

  it("throws when useCustomize is used outside provider", () => {
    expect(() => {
      render(() => {
        useCustomize();
        return <div />;
      });
    }).toThrow("useCustomize must be used within a CustomizeProvider");
  });

  it("applies cssOverrides to document.documentElement.style", async () => {
    mockGetCustomize.mockResolvedValue({
      enabled: true,
      cssOverrides: {
        "--accent-primary": "#fcb00d",
        "--bg-dark": "#1a2a1a",
      },
    });

    render(() => (
      <CustomizeProvider>
        <div>test</div>
      </CustomizeProvider>
    ));

    // Wait for onMount async to complete
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--accent-primary")).toBe("#fcb00d");
    });
    expect(document.documentElement.style.getPropertyValue("--bg-dark")).toBe("#1a2a1a");
  });

  it("ignores properties not starting with --", async () => {
    mockGetCustomize.mockResolvedValue({
      enabled: true,
      cssOverrides: {
        "--accent-primary": "#fcb00d",
        "color": "red",
        "background": "blue",
      },
    });

    render(() => (
      <CustomizeProvider>
        <div>test</div>
      </CustomizeProvider>
    ));

    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--accent-primary")).toBe("#fcb00d");
    });
    // Non-custom-property keys should not be applied
    expect(document.documentElement.style.getPropertyValue("color")).toBe("");
    expect(document.documentElement.style.getPropertyValue("background")).toBe("");
  });

  it("does not apply config when enabled is false", async () => {
    mockGetCustomize.mockResolvedValue({
      enabled: false,
      websiteURL: "https://should-not-appear.com",
      cssOverrides: {
        "--accent-primary": "#ff0000",
      },
    });

    let received: CustomizeConfig | undefined;
    render(() => (
      <CustomizeProvider>
        <TestConsumer onConfig={(c) => (received = c)} />
      </CustomizeProvider>
    ));

    // Give onMount time to run
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual({});
    expect(document.documentElement.style.getPropertyValue("--accent-primary")).toBe("");
  });

  it("cleans up applied properties on unmount", async () => {
    mockGetCustomize.mockResolvedValue({
      enabled: true,
      cssOverrides: {
        "--accent-primary": "#fcb00d",
      },
    });

    const { unmount } = render(() => (
      <CustomizeProvider>
        <div>test</div>
      </CustomizeProvider>
    ));

    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--accent-primary")).toBe("#fcb00d");
    });

    unmount();
    expect(document.documentElement.style.getPropertyValue("--accent-primary")).toBe("");
  });
});
