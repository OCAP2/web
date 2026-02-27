import type { ArmaCoord } from "../utils/coordinates";
import type { WorldConfig } from "../data/types";
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
  MapStyleInfo,
  RendererEvent,
  RendererControls,
} from "./renderer.types";

export interface MapRenderer {
  // Lifecycle
  init(container: HTMLElement, world: WorldConfig): void;
  dispose(): void;

  // Camera
  getZoom(): number;
  setView(armaPos: ArmaCoord, zoom?: number, animate?: boolean): void;
  fitBounds(sw: ArmaCoord, ne: ArmaCoord): void;
  getCenter(): ArmaCoord;

  // Entity markers
  createEntityMarker(id: number, opts: EntityMarkerOpts): MarkerHandle;
  updateEntityMarker(handle: MarkerHandle, state: EntityMarkerState): void;
  removeEntityMarker(handle: MarkerHandle): void;

  // Briefing markers
  createBriefingMarker(def: BriefingMarkerDef): BriefingMarkerHandle;
  updateBriefingMarker(
    handle: BriefingMarkerHandle,
    state: BriefingMarkerState,
  ): void;
  removeBriefingMarker(handle: BriefingMarkerHandle): void;

  // Transient lines (fire lines, kill lines)
  addLine(from: ArmaCoord, to: ArmaCoord, opts: LineOpts): LineHandle;
  removeLine(handle: LineHandle): void;

  // Pulse effects
  addPulse(pos: ArmaCoord, opts: PulseOpts): PulseHandle;
  removePulse(handle: PulseHandle): void;

  // Layer visibility
  setLayerVisible(layer: RenderLayer, visible: boolean): void;
  setMarkerDisplayMode(mode: "all" | "noLabels" | "none"): void;

  // Map styles
  getMapStyles(): MapStyleInfo[];
  getActiveStyleIndex(): number;
  setMapStyle(index: number): void;

  // Settings
  setSmoothingEnabled(enabled: boolean): void;
  setNameDisplayMode(mode: "players" | "all" | "none"): void;

  // Events
  on(event: RendererEvent, cb: (...args: any[]) => void): void;
  off(event: RendererEvent, cb: (...args: any[]) => void): void;

  // Controls
  getControls(): RendererControls;
}
