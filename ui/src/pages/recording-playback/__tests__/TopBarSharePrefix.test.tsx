import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { TimeMode } from "../../../playback/time";

// The basePath module computes its constant at import time from
// `globalThis.__BASE_PATH__`. To exercise the share button with a non-default
// prefix (prefixURL), the whole module graph must be loaded AFTER
// __BASE_PATH__ is set. `vi.resetModules()` + dynamic imports below ensure all
// providers and TopBar come from the same fresh module graph, so Solid's
// context identity stays consistent.
const BASE = "/ocap";

beforeEach(() => {
  (globalThis as Record<string, unknown>).__BASE_PATH__ = BASE;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).__BASE_PATH__;
});

async function renderShareBar(recordingId: string, filename: string) {
  vi.resetModules();
  // Re-import the whole helper chain so basePath is computed with the prefix.
  const [{ TopBar }, { createTestEngine, TestProviders, makeManifest }] =
    await Promise.all([
      import("../components/TopBar"),
      import("./testHelpers"),
    ]);

  const { engine, renderer } = createTestEngine();
  const [missionName] = createSignal("Test Mission");
  const [mapName] = createSignal("Altis");
  const [duration] = createSignal("01:30:00");
  const [recId] = createSignal<string | null>(recordingId);
  const [recFilename] = createSignal<string | null>(filename);
  const [worldConfig] = createSignal(undefined);
  const [timeMode] = createSignal<TimeMode>("elapsed");
  const onTimeMode = vi.fn();
  const onInfoClick = vi.fn();
  const onBack = vi.fn();

  engine.loadRecording(makeManifest([]));

  render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <TopBar
        missionName={missionName}
        mapName={mapName}
        duration={duration}
        recordingId={recId}
        recordingFilename={recFilename}
        worldConfig={worldConfig}
        timeMode={timeMode}
        onTimeMode={onTimeMode}
        onInfoClick={onInfoClick}
        onBack={onBack}
      />
    </TestProviders>
  ));
}

describe("TopBar share with prefixURL", () => {
  it("copies a URL that includes the configured basePath prefix", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    await renderShareBar("op-123", "test-op");

    fireEvent.click(screen.getByTitle("Share"));

    expect(writeTextMock).toHaveBeenCalledOnce();
    const copiedUrl = writeTextMock.mock.calls[0][0] as string;
    expect(copiedUrl).toContain("/ocap/recording/op-123/test-op");

    await vi.waitFor(() => {
      expect(screen.getByText("Link copied!")).toBeTruthy();
    });
  });
});
