import { createSignal, type Accessor, type Setter } from "solid-js";
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
  RenderLayer,
  MapStyleInfo,
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

  // Signal-backed state
  private readonly _nameDisplayMode: Accessor<"players" | "all" | "none">;
  private readonly _setNameDisplayMode: Setter<"players" | "all" | "none">;
  private readonly _markerDisplayMode: Accessor<"all" | "noLabels" | "none">;
  private readonly _setMarkerDisplayMode: Setter<"all" | "noLabels" | "none">;
  private readonly _mapStyles: Accessor<MapStyleInfo[]>;
  private readonly _setMapStyles: Setter<MapStyleInfo[]>;
  private readonly _activeStyleIndex: Accessor<number>;
  private readonly _setActiveStyleIndex: Setter<number>;
  private readonly _layerVisibility: Accessor<Record<string, boolean>>;
  private readonly _setLayerVisibility: Setter<Record<string, boolean>>;

  constructor() {
    const [ndm, setNdm] = createSignal<"players" | "all" | "none">("players");
    this._nameDisplayMode = ndm;
    this._setNameDisplayMode = setNdm;

    const [mdm, setMdm] = createSignal<"all" | "noLabels" | "none">("all");
    this._markerDisplayMode = mdm;
    this._setMarkerDisplayMode = setMdm;

    const [ms, setMs] = createSignal<MapStyleInfo[]>([]);
    this._mapStyles = ms;
    this._setMapStyles = setMs;

    const [asi, setAsi] = createSignal(0);
    this._activeStyleIndex = asi;
    this._setActiveStyleIndex = setAsi;

    const [lv, setLv] = createSignal<Record<string, boolean>>({
      entities: true,
      systemMarkers: true,
      projectileMarkers: true,
      grid: false,
      mapIcons: true,
      buildings3D: true,
    });
    this._layerVisibility = lv;
    this._setLayerVisibility = setLv;
  }

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


  // Signal accessors
  get layerVisibility() { return this._layerVisibility; }
  get markerDisplayMode() { return this._markerDisplayMode; }
  get mapStyles() { return this._mapStyles; }
  get activeStyleIndex() { return this._activeStyleIndex; }
  get nameDisplayMode() { return this._nameDisplayMode; }

  setLayerVisible(layer: RenderLayer, visible: boolean): void {
    this._setLayerVisibility((prev) => ({ ...prev, [layer]: visible }));
  }

  setMarkerDisplayMode(mode: "all" | "noLabels" | "none"): void {
    this._setMarkerDisplayMode(mode);
  }

  setMapStyle(_index: number): void {
    this._setActiveStyleIndex(_index);
  }

  setSmoothingEnabled(_enabled: boolean, _speed?: number): void {
    // no-op
  }

  setNameDisplayMode(mode: "players" | "all" | "none"): void {
    this._setNameDisplayMode(mode);
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

  /** Test helper: set map styles for testing. */
  setMapStylesForTest(styles: MapStyleInfo[]): void {
    this._setMapStyles(styles);
  }

  /** Test helper: set active style index for testing. */
  setActiveStyleIndexForTest(index: number): void {
    this._setActiveStyleIndex(index);
  }
}
