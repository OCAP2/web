import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { MockRenderer } from "../../../renderers/mockRenderer";
import { MarkerManager } from "../../../playback/markerManager";
import { PlaybackEngine } from "../../../playback/engine";
import { useRenderBridge } from "../useRenderBridge";
import { setLeftPanelVisible } from "../shortcuts";
import { unitDef, vehicleDef, makeManifest, hitEvent } from "./testHelpers";
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
    engine.loadRecording(makeManifest([unitDef()]));

    createRoot((dispose) => {
      useRenderBridge(engine, renderer, markerManager);
      expect(renderer.listenerCount("dragstart")).toBe(1);
      dispose();
    });
  });

  it("auto-unfollows entity on dragstart", () => {
    const { engine, renderer, markerManager } = createTestSetup();
    engine.loadRecording(makeManifest([unitDef({ id: 1 })]));

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
      engine.loadRecording(
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
      engine.loadRecording(
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
      engine.loadRecording(makeManifest([unitDef({ id: 1 })]));
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
      engine.loadRecording(makeManifest([unitDef()]));
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
      engine.loadRecording(
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
      engine.loadRecording(
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
      engine.loadRecording(makeManifest([unitDef()]));
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
      engine.loadRecording(makeManifest([unitDef({ id: 1 })]));
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

  it("vehicle marker passes crew info with count and player names", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest([
          unitDef({ id: 1, name: "Driver" }),
          unitDef({ id: 2, name: "Gunner" }),
          vehicleDef({
            id: 50,
            name: "HMMWV",
            positions: [
              { position: [300, 400], direction: 90, alive: 1, crewIds: [1, 2] },
            ],
          }),
        ]),
      );
    });

    await flush();

    const vehicleCall = updateSpy.mock.calls.find(
      (call) => (call[1] as any).name === "HMMWV",
    );
    expect(vehicleCall).toBeDefined();
    const state = vehicleCall![1] as any;
    expect(state.name).toBe("HMMWV");
    expect(state.crew).toEqual({ count: 2, names: ["Driver", "Gunner"] });

    dispose();
  });

  it("vehicle with no crew passes crew info with zero count", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest([
          vehicleDef({
            id: 50,
            name: "HMMWV",
            positions: [
              { position: [300, 400], direction: 90, alive: 1 },
            ],
          }),
        ]),
      );
    });

    await flush();

    const vehicleCall = updateSpy.mock.calls.find(
      (call) => (call[1] as any).name === "HMMWV",
    );
    expect(vehicleCall).toBeDefined();
    const state = vehicleCall![1] as any;
    expect(state.name).toBe("HMMWV");
    expect(state.crew).toEqual({ count: 0, names: [] });

    dispose();
  });

  it("vehicle crew info updates when crew changes", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest(
          [
            unitDef({ id: 1, name: "Driver", startFrame: 0, endFrame: 50 }),
            unitDef({ id: 2, name: "Gunner", startFrame: 0, endFrame: 50 }),
            vehicleDef({
              id: 50,
              name: "HMMWV",
              startFrame: 0,
              endFrame: 50,
              positions: [
                { position: [300, 400], direction: 90, alive: 1, crewIds: [1] },
                { position: [300, 400], direction: 90, alive: 1, crewIds: [1, 2] },
              ],
            }),
          ],
          [],
          50,
        ),
      );
    });

    await flush();

    // Frame 0: only Driver in crew
    let vehicleCalls = updateSpy.mock.calls.filter(
      (call) => (call[1] as any).name === "HMMWV",
    );
    let lastState = vehicleCalls[vehicleCalls.length - 1]![1] as any;
    expect(lastState.crew).toEqual({ count: 1, names: ["Driver"] });

    // Seek to frame 1: both Driver and Gunner in crew
    engine.seekTo(1);
    await flush();

    vehicleCalls = updateSpy.mock.calls.filter(
      (call) => (call[1] as any).name === "HMMWV",
    );
    lastState = vehicleCalls[vehicleCalls.length - 1]![1] as any;
    expect(lastState.crew).toEqual({ count: 2, names: ["Driver", "Gunner"] });

    dispose();
  });

  it("vehicle crew info excludes AI (non-player) crew members from names", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest([
          unitDef({ id: 1, name: "PlayerDriver", isPlayer: true }),
          unitDef({ id: 2, name: "AIGunner", isPlayer: false }),
          unitDef({ id: 3, name: "PlayerCargo", isPlayer: true }),
          vehicleDef({
            id: 50,
            name: "HMMWV",
            positions: [
              { position: [300, 400], direction: 90, alive: 1, crewIds: [1, 2, 3] },
            ],
          }),
        ]),
      );
    });

    await flush();

    const vehicleCall = updateSpy.mock.calls.find(
      (call) => (call[1] as any).name === "HMMWV",
    );
    expect(vehicleCall).toBeDefined();
    const state = vehicleCall![1] as any;
    // Total crew count includes all (3), but only players are listed by name
    expect(state.crew).toEqual({ count: 3, names: ["PlayerDriver", "PlayerCargo"] });

    dispose();
  });

  it("vehicle with only AI crew has empty names list", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest([
          unitDef({ id: 1, name: "AIDriver", isPlayer: false }),
          unitDef({ id: 2, name: "AIGunner", isPlayer: false }),
          vehicleDef({
            id: 50,
            name: "HMMWV",
            positions: [
              { position: [300, 400], direction: 90, alive: 1, crewIds: [1, 2] },
            ],
          }),
        ]),
      );
    });

    await flush();

    const vehicleCall = updateSpy.mock.calls.find(
      (call) => (call[1] as any).name === "HMMWV",
    );
    expect(vehicleCall).toBeDefined();
    const state = vehicleCall![1] as any;
    expect(state.crew).toEqual({ count: 2, names: [] });

    dispose();
  });

  it("vehicle isPlayer reflects whether any crew member is a player", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest([
          unitDef({ id: 1, name: "PlayerDriver", isPlayer: true }),
          unitDef({ id: 2, name: "AIGunner", isPlayer: false }),
          vehicleDef({
            id: 50,
            name: "HMMWV",
            positions: [
              { position: [300, 400], direction: 90, alive: 1, crewIds: [1, 2] },
            ],
          }),
        ]),
      );
    });

    await flush();

    // Vehicle has a player crew member → isPlayer should be true
    const vehicleCall = updateSpy.mock.calls.find(
      (call) => (call[1] as any).name === "HMMWV",
    );
    expect(vehicleCall).toBeDefined();
    expect((vehicleCall![1] as any).isPlayer).toBe(true);

    dispose();
  });

  it("vehicle isPlayer is false when no crew member is a player", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest([
          unitDef({ id: 1, name: "AIDriver", isPlayer: false }),
          vehicleDef({
            id: 50,
            name: "HMMWV",
            positions: [
              { position: [300, 400], direction: 90, alive: 1, crewIds: [1] },
            ],
          }),
        ]),
      );
    });

    await flush();

    const vehicleCall = updateSpy.mock.calls.find(
      (call) => (call[1] as any).name === "HMMWV",
    );
    expect(vehicleCall).toBeDefined();
    expect((vehicleCall![1] as any).isPlayer).toBe(false);

    dispose();
  });

  it("sets hit flag on victim marker when hit event fires", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest(
          [
            unitDef({ id: 1, name: "Victim", startFrame: 0, endFrame: 50 }),
            unitDef({ id: 2, name: "Shooter", startFrame: 0, endFrame: 50 }),
          ],
          [hitEvent(5, 1, 2)],
          50,
        ),
      );
    });

    await flush();

    // At frame 0, no hit — hit should be false
    let victimCalls = updateSpy.mock.calls.filter(
      (call) => (call[1] as any).name === "Victim",
    );
    expect(victimCalls.length).toBeGreaterThan(0);
    expect((victimCalls[victimCalls.length - 1]![1] as any).hit).toBe(false);

    // Seek to hit frame
    engine.seekTo(5);
    await flush();

    victimCalls = updateSpy.mock.calls.filter(
      (call) => (call[1] as any).name === "Victim",
    );
    expect((victimCalls[victimCalls.length - 1]![1] as any).hit).toBe(true);

    dispose();
  });

  it("hit flash only active on the exact hit frame", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    // Need enough positions so entities have snapshots at all tested frames (0-8)
    const pos = Array.from({ length: 10 }, () => ({
      position: [100, 200] as [number, number],
      direction: 0,
      alive: 1 as const,
    }));

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest(
          [
            unitDef({ id: 1, name: "Victim", startFrame: 0, endFrame: 50, positions: pos }),
            unitDef({ id: 2, name: "Shooter", startFrame: 0, endFrame: 50, positions: pos }),
          ],
          [hitEvent(5, 1, 2)],
          50,
        ),
      );
    });

    await flush();

    // Seek to hit frame — hit is active
    engine.seekTo(5);
    await flush();

    let victimCalls = updateSpy.mock.calls.filter(
      (call) => (call[1] as any).name === "Victim",
    );
    expect((victimCalls[victimCalls.length - 1]![1] as any).hit).toBe(true);

    // Next frame — hit is no longer active (canvas layer handles visual duration)
    engine.seekTo(6);
    await flush();

    victimCalls = updateSpy.mock.calls.filter(
      (call) => (call[1] as any).name === "Victim",
    );
    expect((victimCalls[victimCalls.length - 1]![1] as any).hit).toBe(false);

    dispose();
  });

  it("hit flash not shown when seeking far from hit frame", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest(
          [
            unitDef({ id: 1, name: "Victim", startFrame: 0, endFrame: 50 }),
            unitDef({ id: 2, name: "Shooter", startFrame: 0, endFrame: 50 }),
          ],
          [hitEvent(5, 1, 2)],
          50,
        ),
      );
    });

    await flush();

    // Seek to frame 0 — well before the hit at frame 5
    engine.seekTo(0);
    await flush();

    let victimCalls = updateSpy.mock.calls.filter(
      (call) => (call[1] as any).name === "Victim",
    );
    expect((victimCalls[victimCalls.length - 1]![1] as any).hit).toBe(false);

    // Seek past the flash window — frame 8 is outside [5, 7]
    engine.seekTo(8);
    await flush();

    victimCalls = updateSpy.mock.calls.filter(
      (call) => (call[1] as any).name === "Victim",
    );
    expect((victimCalls[victimCalls.length - 1]![1] as any).hit).toBe(false);

    dispose();
  });

  it("vehicle passes raw names without HTML escaping", async () => {
    const { engine, renderer, markerManager } = createTestSetup();
    const updateSpy = vi.spyOn(renderer, "updateEntityMarker");

    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      useRenderBridge(engine, renderer, markerManager);
      engine.loadRecording(
        makeManifest([
          unitDef({ id: 1, name: "<script>alert(1)</script>" }),
          vehicleDef({
            id: 50,
            name: "Tank & <APC>",
            positions: [
              { position: [300, 400], direction: 90, alive: 1, crewIds: [1] },
            ],
          }),
        ]),
      );
    });

    await flush();

    const vehicleCall = updateSpy.mock.calls.find(
      (call) => (call[1] as any).name === "Tank & <APC>",
    );
    expect(vehicleCall).toBeDefined();
    const state = vehicleCall![1] as any;
    // Raw names passed through — renderer handles escaping
    expect(state.name).toBe("Tank & <APC>");
    expect(state.crew.names).toEqual(["<script>alert(1)</script>"]);

    dispose();
  });
});
