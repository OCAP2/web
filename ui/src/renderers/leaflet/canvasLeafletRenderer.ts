import type { WorldConfig } from "../../data/types";
import type {
  MarkerHandle,
  EntityMarkerOpts,
  EntityMarkerState,
} from "../renderer.types";
import { LeafletRenderer } from "./leafletRenderer";
import { EntityCanvasLayer } from "./entityCanvasLayer";
import { CanvasIconCache } from "./canvasIcons";

// --------------- Handle wrapping ---------------

interface CanvasMarkerInternal {
  canvasEntityId: number;
}

function wrapHandle(id: number): MarkerHandle {
  return {
    _brand: undefined as any,
    _internal: { canvasEntityId: id } as CanvasMarkerInternal,
  } as unknown as MarkerHandle;
}

function unwrapHandle(handle: MarkerHandle): number {
  return ((handle as any)._internal as CanvasMarkerInternal).canvasEntityId;
}

// --------------- Canvas-backed Leaflet renderer ---------------

/**
 * Extends LeafletRenderer, replacing only entity marker rendering with a
 * canvas overlay. Everything else (map tiles, briefing markers, fire lines,
 * pulses, grid, styles, events) is inherited unchanged.
 */
export class CanvasLeafletRenderer extends LeafletRenderer {
  private canvasLayer!: EntityCanvasLayer;
  private iconCache = new CanvasIconCache();

  override init(container: HTMLElement, world: WorldConfig): void {
    super.init(container, world);

    this.canvasLayer = new EntityCanvasLayer(this.map, {
      armaToLatLng: (c) => this.armaToLatLng(c),
      iconCache: this.iconCache,
      getZoom: () => this.map.getZoom(),
      isMapLibreMode: this.useMapLibreMode,
      nameDisplayMode: () => this.nameDisplayMode(),
      layerVisible: () => this.layerVisibility().entities ?? true,
    });

    void this.iconCache.preloadAll().then(() => {
      console.log("[CanvasRenderer] Icon cache loaded");
    });

    console.log(
      "[CanvasRenderer] init: canvas entity layer active, mode=%s",
      this.useMapLibreMode ? "maplibre" : "legacy",
    );
  }

  override createEntityMarker(
    id: number,
    opts: EntityMarkerOpts,
  ): MarkerHandle {
    this.canvasLayer.addEntity(id, opts);
    return wrapHandle(id);
  }

  override updateEntityMarker(
    handle: MarkerHandle,
    state: EntityMarkerState,
  ): void {
    this.canvasLayer.updateEntity(unwrapHandle(handle), state);
  }

  override removeEntityMarker(handle: MarkerHandle): void {
    this.canvasLayer.removeEntity(unwrapHandle(handle));
  }

  override setSmoothingEnabled(enabled: boolean, speed?: number): void {
    // Guard: SolidJS effects may fire before init()
    this.canvasLayer?.setSmoothingEnabled(enabled, speed);
  }

  override dispose(): void {
    this.canvasLayer?.dispose();
    super.dispose();
  }
}
