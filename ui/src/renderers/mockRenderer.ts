import type { ArmaCoord } from "../utils/coordinates";
import type { WorldConfig } from "../data/types";
import type { MapRenderer } from "./renderer.interface";
import type {
  MarkerHandle,
  EntityMarkerOpts,
  EntityMarkerState,
  BriefingMarkerHandle,
  BriefingMarkerDef,
  BriefingMarkerState,
  LineHandle,
  LineOpts,
  PulseHandle,
  PulseOpts,
  RenderLayer,
  RendererEvent,
  RendererControls,
} from "./renderer.types";

let nextId = 0;

function makeHandle<T>(): T {
  return { _brand: Symbol(), _internal: nextId++ } as unknown as T;
}

/**
 * Full mock implementation of MapRenderer for testing.
 * All methods are no-ops that return dummy handles.
 * Event methods store callbacks but don't fire them.
 */
export class MockRenderer implements MapRenderer {
  private listeners = new Map<RendererEvent, Set<(...args: any[]) => void>>();

  init(_container: HTMLElement, _world: WorldConfig): void {
    // no-op
  }

  dispose(): void {
    this.listeners.clear();
  }

  getZoom(): number {
    return 1;
  }

  setView(_armaPos: ArmaCoord, _zoom?: number, _animate?: boolean): void {
    // no-op
  }

  fitBounds(_sw: ArmaCoord, _ne: ArmaCoord): void {
    // no-op
  }

  getCenter(): ArmaCoord {
    return [0, 0];
  }

  createEntityMarker(_id: number, _opts: EntityMarkerOpts): MarkerHandle {
    return makeHandle<MarkerHandle>();
  }

  updateEntityMarker(
    _handle: MarkerHandle,
    _state: EntityMarkerState,
  ): void {
    // no-op
  }

  removeEntityMarker(_handle: MarkerHandle): void {
    // no-op
  }

  createBriefingMarker(_def: BriefingMarkerDef): BriefingMarkerHandle {
    return makeHandle<BriefingMarkerHandle>();
  }

  updateBriefingMarker(
    _handle: BriefingMarkerHandle,
    _state: BriefingMarkerState,
  ): void {
    // no-op
  }

  removeBriefingMarker(_handle: BriefingMarkerHandle): void {
    // no-op
  }

  addLine(
    _from: ArmaCoord,
    _to: ArmaCoord,
    _opts: LineOpts,
  ): LineHandle {
    return makeHandle<LineHandle>();
  }

  removeLine(_handle: LineHandle): void {
    // no-op
  }

  addPulse(_pos: ArmaCoord, _opts: PulseOpts): PulseHandle {
    return makeHandle<PulseHandle>();
  }

  removePulse(_handle: PulseHandle): void {
    // no-op
  }

  setLayerVisible(_layer: RenderLayer, _visible: boolean): void {
    // no-op
  }

  setMarkerDisplayMode(_mode: "all" | "noLabels" | "none"): void {
    // no-op
  }

  getMapStyles(): import("./renderer.types").MapStyleInfo[] {
    return [];
  }

  getActiveStyleIndex(): number {
    return 0;
  }

  setMapStyle(_index: number): void {
    // no-op
  }

  setSmoothingEnabled(_enabled: boolean): void {
    // no-op
  }

  setNameDisplayMode(_mode: "players" | "all" | "none"): void {
    // no-op
  }

  on(event: RendererEvent, cb: (...args: any[]) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
  }

  off(event: RendererEvent, cb: (...args: any[]) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  getControls(): RendererControls {
    return {};
  }

  /** Test helper: returns number of listeners for a given event. */
  listenerCount(event: RendererEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
