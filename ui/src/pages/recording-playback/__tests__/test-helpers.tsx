/**
 * Shared test helpers for recording-playback component tests.
 */
import type { JSX } from "solid-js";
import { PlaybackEngine } from "../../../playback/engine";
import { MockRenderer } from "../../../renderers/mock-renderer";
import { EngineProvider } from "../../../hooks/useEngine";
import { RendererProvider } from "../../../hooks/useRenderer";
import { I18nProvider } from "../../../hooks/useLocale";
import type { Manifest, EntityDef, EventDef } from "../../../data/types";

/** Create a PlaybackEngine backed by a MockRenderer. */
export function createTestEngine(): { engine: PlaybackEngine; renderer: MockRenderer } {
  const renderer = new MockRenderer();
  const engine = new PlaybackEngine(renderer);
  return { engine, renderer };
}

/** Wrapper component that provides Engine + Renderer + I18n context. */
export function TestProviders(props: {
  engine: PlaybackEngine;
  renderer: MockRenderer;
  children: JSX.Element;
}): JSX.Element {
  return (
    <I18nProvider locale="en">
      <EngineProvider engine={props.engine}>
        <RendererProvider renderer={props.renderer}>
          {props.children}
        </RendererProvider>
      </EngineProvider>
    </I18nProvider>
  );
}

/** Build a minimal entity definition for a unit. */
export function unitDef(overrides: Partial<EntityDef> = {}): EntityDef {
  return {
    id: 1,
    type: "man",
    name: "Rifleman",
    side: "WEST",
    groupName: "Alpha",
    isPlayer: true,
    startFrame: 0,
    endFrame: 100,
    role: "Rifleman",
    positions: [{ position: [100, 200], direction: 0, alive: 1 }],
    ...overrides,
  };
}

/** Build a minimal entity definition for a vehicle. */
export function vehicleDef(overrides: Partial<EntityDef> = {}): EntityDef {
  return {
    id: 50,
    type: "car",
    name: "HMMWV",
    side: undefined,
    groupName: undefined,
    isPlayer: false,
    startFrame: 0,
    endFrame: 100,
    role: "",
    positions: [{ position: [300, 400], direction: 90, alive: 1 }],
    ...overrides,
  };
}

/** Build a manifest with the given entities and events. */
export function makeManifest(
  entities: EntityDef[],
  events: EventDef[] = [],
  frameCount = 100,
): Manifest {
  return {
    frameCount,
    captureDelayMs: 1000,
    chunkSize: 300,
    entities,
    events,
    markers: [],
  };
}

/** Create a killed event definition. */
export function killedEvent(
  frameNum: number,
  victimId: number,
  causedById: number,
  weapon = "M4A1",
  distance = 100,
): EventDef {
  return {
    type: "killed",
    frameNum,
    victimId,
    causedById,
    weapon,
    distance,
  } as EventDef;
}

/** Create a hit event definition. */
export function hitEvent(
  frameNum: number,
  victimId: number,
  causedById: number,
  weapon = "M4A1",
  distance = 50,
): EventDef {
  return {
    type: "hit",
    frameNum,
    victimId,
    causedById,
    weapon,
    distance,
  } as EventDef;
}

/** Create a connected/disconnected event definition. */
export function connectEvent(
  frameNum: number,
  type: "connected" | "disconnected",
  unitName: string,
): EventDef {
  return { type, frameNum, unitName } as EventDef;
}

/** Create an endMission event definition. */
export function endMissionEvent(
  frameNum: number,
  side: string,
  message: string,
): EventDef {
  return { type: "endMission", frameNum, side, message } as EventDef;
}
