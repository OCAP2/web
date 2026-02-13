import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { MockRenderer } from "../../../renderers/mock-renderer";
import { MarkerManager } from "../../../playback/marker-manager";
import { PlaybackEngine } from "../../../playback/engine";
import { useRenderBridge } from "../useRenderBridge";
import { setLeftPanelVisible } from "../shortcuts";
import { unitDef, makeManifest } from "./test-helpers";
import type { RendererEvent } from "../../../renderers/renderer.types";

/**
 * Extends MockRenderer with a fire() method to programmatically
 * trigger event callbacks registered via on().
 */
class TestRenderer extends MockRenderer {
  fire(event: RendererEvent, ...args: unknown[]): void {
    const set = (this as any).listeners.get(event);
    if (set) {
      for (const cb of set) cb(...args);
    }
  }
}

/** Create engine + TestRenderer pair. */
function createTestSetup(): {
  engine: PlaybackEngine;
  renderer: TestRenderer;
  markerManager: MarkerManager;
} {
  const renderer = new TestRenderer();
  const engine = new PlaybackEngine(renderer);
  const markerManager = new MarkerManager(renderer);
  return { engine, renderer, markerManager };
}

/** Flush SolidJS microtask-scheduled effects. */
function flush(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe("useRenderBridge", () => {
  beforeEach(() => {
    setLeftPanelVisible(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a dragstart listener on the renderer", () => {
    const { engine, renderer, markerManager } = createTestSetup();
    engine.loadOperation(makeManifest([unitDef()]));

    createRoot((dispose) => {
      useRenderBridge(engine, renderer, markerManager);
      expect(renderer.listenerCount("dragstart")).toBe(1);
      dispose();
    });
  });

  it("auto-unfollows entity on dragstart", () => {
    const { engine, renderer, markerManager } = createTestSetup();
    engine.loadOperation(makeManifest([unitDef({ id: 1 })]));

    createRoot((dispose) => {
      useRenderBridge(engine, renderer, markerManager);

      // Follow an entity
      engine.followEntity(1);
      expect(engine.followTarget()).toBe(1);

      // Simulate map drag
      renderer.fire("dragstart");
      expect(engine.followTarget()).toBeNull();

      dispose();
    });
  });

  it("creates entity markers when snapshots appear", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const createSpy = vi.spyOn(renderer, "createEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadOperation(
        makeManifest([
          unitDef({ id: 1, name: "Alpha 1" }),
          unitDef({ id: 2, name: "Alpha 2" }),
        ]),
      );
    });

    await flush();

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(createSpy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: "Alpha 1" }),
    );
    expect(createSpy).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ name: "Alpha 2" }),
    );

    dispose();
  });

  it("removes entity markers when snapshots disappear", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const removeSpy = vi.spyOn(renderer, "removeEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      // Entity only exists in frames 0-5
      engine.loadOperation(
        makeManifest(
          [
            unitDef({
              id: 1,
              startFrame: 0,
              endFrame: 5,
              positions: [{ position: [100, 200], direction: 0, alive: 1 }],
            }),
          ],
          [],
          100,
        ),
      );
    });

    await flush();

    // Entity visible at frame 0
    expect(removeSpy).not.toHaveBeenCalled();

    // Seek past entity's endFrame so it disappears from snapshots
    engine.seekTo(10);
    await flush();

    expect(removeSpy).toHaveBeenCalled();

    dispose();
  });

  it("updates entity markers on each snapshot change", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadOperation(makeManifest([unitDef({ id: 1 })]));
    });

    await flush();

    // Initial effect should have called update once for the entity
    const initialCallCount = updateSpy.mock.calls.length;
    expect(initialCallCount).toBeGreaterThanOrEqual(1);

    // Seeking to a new frame triggers another snapshot update
    engine.seekTo(0);
    await flush();

    expect(updateSpy.mock.calls.length).toBeGreaterThan(initialCallCount);

    dispose();
  });

  it("calls markerManager.updateFrame when frame changes", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateFrameSpy = vi.spyOn(markerManager, "updateFrame");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadOperation(makeManifest([unitDef()]));
    });

    await flush();

    // The initial effect should have called updateFrame with frame 0
    expect(updateFrameSpy).toHaveBeenCalledWith(0);

    // Seek to frame 5 -- should call updateFrame again
    engine.seekTo(5);
    await flush();

    expect(updateFrameSpy).toHaveBeenCalledWith(5);

    dispose();
  });

  it("adds fire lines when entity has firedTarget", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const addLineSpy = vi.spyOn(renderer, "addLine");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      // Entity with framesFired data at frame 0
      engine.loadOperation(
        makeManifest([
          unitDef({
            id: 1,
            side: "WEST",
            framesFired: [[0, [500, 600]]],
          }),
        ]),
      );
    });

    await flush();

    // The entity fired at frame 0, so a fire line should be drawn
    expect(addLineSpy).toHaveBeenCalledWith(
      expect.any(Array),
      [500, 600],
      expect.objectContaining({
        weight: 2,
        opacity: 0.4,
      }),
    );

    dispose();
  });

  it("removes old fire lines before drawing new ones", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const removeLineSpy = vi.spyOn(renderer, "removeLine");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadOperation(
        makeManifest([
          unitDef({
            id: 1,
            framesFired: [[0, [500, 600]]],
          }),
        ]),
      );
    });

    await flush();

    // First effect created fire lines; seeking triggers another effect run
    // that should remove the previous fire lines first
    engine.seekTo(1);
    await flush();

    expect(removeLineSpy).toHaveBeenCalled();

    dispose();
  });

  it("sets CSS custom property based on left panel visibility", async () => {
    const { engine, renderer, markerManager } = createTestSetup();

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      engine.loadOperation(makeManifest([unitDef()]));
      useRenderBridge(engine, renderer, markerManager);
    });

    await flush();

    // Panel is visible by default
    expect(
      document.documentElement.style.getPropertyValue("--leaflet-left-offset"),
    ).toBe("calc(var(--pb-panel-width) + 16px)");

    // Hide the panel
    setLeftPanelVisible(false);
    await flush();

    expect(
      document.documentElement.style.getPropertyValue("--leaflet-left-offset"),
    ).toBe("10px");

    // Show the panel again
    setLeftPanelVisible(true);
    await flush();

    expect(
      document.documentElement.style.getPropertyValue("--leaflet-left-offset"),
    ).toBe("calc(var(--pb-panel-width) + 16px)");

    dispose();
  });

  it("does not create duplicate markers for the same entity on re-render", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const createSpy = vi.spyOn(renderer, "createEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadOperation(makeManifest([unitDef({ id: 1 })]));
    });

    await flush();

    const countAfterInit = createSpy.mock.calls.length;
    expect(countAfterInit).toBe(1);

    // Seek to same-range frame -- entity still present, should NOT create again
    engine.seekTo(0);
    await flush();

    expect(createSpy.mock.calls.length).toBe(countAfterInit);

    dispose();
  });
});
