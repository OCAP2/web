import type { WorldConfig } from "../../data/types";
import type { ArmaCoord } from "../../utils/coordinates";
import type {
  MarkerHandle,
  LineHandle,
  EntityMarkerOpts,
  EntityMarkerState,
  LineOpts,
  RenderLayer,
} from "../renderer.types";
import { LeafletRenderer } from "./leafletRenderer";
import { EntityCanvasLayer, type FireLine } from "./entityCanvasLayer";
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

function wrapLineHandle(index: number): LineHandle {
  return { _brand: undefined as any, _internal: index } as unknown as LineHandle;
}

// --------------- Canvas-backed Leaflet renderer ---------------

/**
 * Extends LeafletRenderer, replacing only entity marker rendering with a
 * canvas overlay. Fire lines and the coordinate grid are also drawn on canvas.
 * Everything else (map tiles, briefing markers, styles, events) is inherited unchanged.
 */
export class CanvasLeafletRenderer extends LeafletRenderer {
  private canvasLayer!: EntityCanvasLayer;
  private iconCache = new CanvasIconCache();
  private pendingFireLines: FireLine[] = [];

  override init(container: HTMLElement, world: WorldConfig): void {
    super.init(container, world);

    // Suppress DOM-based grid — canvas layer handles grid rendering
    if (this.gridLayer && this.map.hasLayer(this.gridLayer)) {
      this.map.removeLayer(this.gridLayer);
    }
    this.gridLayer = null;

    this.canvasLayer = new EntityCanvasLayer(this.map, {
      armaToLatLng: (c) => this.armaToLatLng(c),
      iconCache: this.iconCache,
      getZoom: () => this.map.getZoom(),
      isMapLibreMode: this.useMapLibreMode,
      nameDisplayMode: () => this.nameDisplayMode(),
      layerVisible: () => this.layerVisibility().entities ?? true,
      worldSize: world.worldSize,
      latLngToArma: (ll) => this.latLngToArma(ll),
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

  override addLine(from: ArmaCoord, to: ArmaCoord, opts: LineOpts): LineHandle {
    const idx = this.pendingFireLines.length;
    this.pendingFireLines.push({
      fromX: from[0], fromY: from[1],
      toX: to[0], toY: to[1],
      color: opts.color, weight: opts.weight, opacity: opts.opacity,
      cachedFromPx: 0, cachedFromPy: 0,
      cachedToPx: 0, cachedToPy: 0,
    });
    // Push to canvas layer immediately — useRenderBridge calls removeLine
    // for all old handles first, then addLine for new ones.
    this.canvasLayer?.setFireLines(this.pendingFireLines);
    return wrapLineHandle(idx);
  }

  override removeLine(_handle: LineHandle): void {
    // useRenderBridge removes all old handles then adds new ones.
    // Clear on first removeLine call; subsequent calls are no-ops.
    if (this.pendingFireLines.length > 0) {
      this.pendingFireLines = [];
      this.canvasLayer?.clearFireLines();
    }
  }

  override setLayerVisible(layer: RenderLayer, visible: boolean): void {
    if (layer === "grid") {
      this.canvasLayer?.setGridVisible(visible);
    }
    // Update signal so UI stays in sync; base class grid toggle is a no-op
    // since we set this.gridLayer = null in init().
    super.setLayerVisible(layer, visible);
  }
}
