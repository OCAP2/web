/**
 * Custom Leaflet controls for the OCAP2 map UI.
 *
 * TypeScript port of:
 * - static/leaflet/L.Control.Zoominfo.js (ZoomInfo control)
 * - Standard Leaflet scale and layer controls
 */
import L from "leaflet";

// --------------- ZoomInfo Control ---------------

export interface ZoomInfoOptions extends L.ControlOptions {
  /** CSS namespace for styling. Default: "leaflet-control-zoominfo" */
  styleNS?: string;
}

/**
 * A custom zoom control that displays the current zoom level
 * and provides zoom in/out buttons.
 *
 * Port of L.Control.Zoominfo from the legacy codebase.
 */
class ZoomInfoControl extends L.Control {
  private _ui!: {
    bar: HTMLElement;
    zoomIn: HTMLAnchorElement;
    wrap: HTMLElement;
    zoomOut: HTMLAnchorElement;
    body: HTMLElement;
    info: HTMLElement;
  };
  private _styleNS: string;

  constructor(options?: ZoomInfoOptions) {
    super({ position: "topleft", ...options });
    this._styleNS = options?.styleNS ?? "leaflet-control-zoominfo";
  }

  onAdd(map: L.Map): HTMLElement {
    this._ui = this._createUI();

    // Initialize: append info, bind events, update display
    this._ui.body.appendChild(this._ui.info);
    this._initEvents(map);
    this._updateInfoValue(map);
    this._updateDisabled(map);

    return this._ui.bar;
  }

  onRemove(map: L.Map): void {
    map.off("zoomend zoomlevelschange", this._onZoomChange, this);
  }

  private _createUI(): typeof this._ui {
    const ns = this._styleNS;

    const bar = L.DomUtil.create("div", `${ns} leaflet-bar`);
    const zoomIn = this._createZoomBtn("in", "top", bar);
    const wrap = L.DomUtil.create("div", `${ns}-wrap leaflet-bar-part`, bar);
    const zoomOut = this._createZoomBtn("out", "bottom", bar);
    const body = L.DomUtil.create("div", `${ns}-body`, wrap);
    const info = L.DomUtil.create("div", `${ns}-info`);

    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.disableClickPropagation(info);

    return { bar, zoomIn, wrap, zoomOut, body, info };
  }

  private _createZoomBtn(
    zoomDir: "in" | "out",
    end: "top" | "bottom",
    container: HTMLElement,
  ): HTMLAnchorElement {
    const classDef = `${this._styleNS}-${zoomDir} leaflet-bar-part leaflet-bar-part-${end}`;
    const link = L.DomUtil.create("a", classDef, container) as HTMLAnchorElement;

    link.href = "#";
    link.title = `Zoom ${zoomDir}`;

    L.DomEvent.on(link, "click", L.DomEvent.preventDefault);

    return link;
  }

  private _initEvents(map: L.Map): void {
    map.on("zoomend zoomlevelschange", this._onZoomChange, this);

    L.DomEvent.on(this._ui.zoomIn, "click", () => {
      map.zoomIn(1);
    });
    L.DomEvent.on(this._ui.zoomOut, "click", () => {
      map.zoomOut(1);
    });
  }

  private _onZoomChange(): void {
    const map = (this as unknown as { _map: L.Map | undefined })._map;
    if (!map) return;
    this._updateInfoValue(map);
    this._updateDisabled(map);
  }

  private _updateInfoValue(map: L.Map): void {
    this._ui.info.innerHTML = `<strong>${map.getZoom()}</strong>`;
  }

  private _updateDisabled(map: L.Map): void {
    const className = `${this._styleNS}-disabled`;
    const zoom = map.getZoom();

    L.DomUtil.removeClass(this._ui.zoomIn, className);
    L.DomUtil.removeClass(this._ui.zoomOut, className);

    if (zoom === map.getMinZoom()) {
      L.DomUtil.addClass(this._ui.zoomOut, className);
    }
    if (zoom === map.getMaxZoom()) {
      L.DomUtil.addClass(this._ui.zoomIn, className);
    }
  }
}

// --------------- Factory Functions ---------------

/**
 * Create a ZoomInfo control that displays the current zoom level
 * and provides zoom in/out buttons.
 */
export function createZoomInfoControl(opts?: ZoomInfoOptions): L.Control {
  return new ZoomInfoControl(opts);
}

/**
 * Create a standard Leaflet scale control with metric units.
 */
export function createScaleControl(): L.Control.Scale {
  return L.control.scale({
    metric: true,
    imperial: false,
    position: "bottomleft",
  });
}

/**
 * Create a Leaflet layers control for toggling base layers and overlays.
 */
export function createLayerControl(
  baseLayers: Record<string, L.Layer>,
  overlays: Record<string, L.Layer>,
): L.Control.Layers {
  return L.control.layers(baseLayers, overlays, {
    position: "topright",
    collapsed: true,
  });
}
