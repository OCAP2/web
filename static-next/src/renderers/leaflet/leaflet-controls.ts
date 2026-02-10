/**
 * Custom Leaflet controls for the OCAP2 map UI.
 *
 * TypeScript port of:
 * - static/leaflet/L.Control.Basemaps.js (Basemap switcher)
 * - static/leaflet/L.Control.MaplibreStyles.js (MapLibre style switcher)
 * - Standard Leaflet scale and layer controls
 */
import L from "leaflet";

// --------------- Factory Functions ---------------

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

// --------------- Basemap Control ---------------

/**
 * Circular thumbnail basemap switcher for raster tile layers.
 * Port of L.Control.Basemaps from the legacy codebase.
 *
 * - First layer = active (added to map)
 * - When collapsed, only the "alt" (next) layer thumbnail is visible
 * - Desktop: expand on hover; Mobile: expand on first click, select on second
 */
class BasemapControl extends L.Control {
  private _basemaps: L.TileLayer[];
  private _tileX: number;
  private _tileY: number;
  private _tileZ: number;
  private _active!: L.TileLayer;

  constructor(
    basemaps: L.TileLayer[],
    opts?: { tileX?: number; tileY?: number; tileZ?: number },
  ) {
    super({ position: "bottomright" });
    this._basemaps = basemaps;
    this._tileX = opts?.tileX ?? 2;
    this._tileY = opts?.tileY ?? 6;
    this._tileZ = opts?.tileZ ?? 4;
  }

  onAdd(map: L.Map): HTMLElement {
    const container = L.DomUtil.create(
      "div",
      "basemaps leaflet-control closed",
    );
    L.DomEvent.disableClickPropagation(container);
    if (!L.Browser.touch) {
      L.DomEvent.disableScrollPropagation(container);
    }

    this._basemaps.forEach((layer, idx) => {
      let cls = "basemap";
      if (idx === 0) {
        this._active = layer;
        map.addLayer(layer);
        cls += " active";
      }
      if (idx === 1) {
        cls += " alt";
      }

      const item = L.DomUtil.create("div", cls, container);
      const img = L.DomUtil.create("img", "", item) as HTMLImageElement;
      img.src = this._getThumbnailUrl(layer);
      const label = (layer.options as any).label;
      if (label) img.title = label;

      L.DomEvent.on(item, "click", () => {
        // Mobile: first click expands, second click selects
        if (
          this._basemaps.length > 2 &&
          L.Browser.mobile &&
          L.DomUtil.hasClass(container, "closed")
        ) {
          L.DomUtil.removeClass(container, "closed");
          return;
        }

        if (layer === this._active) return;

        // Switch layers
        map.removeLayer(this._active);
        map.addLayer(layer);
        layer.bringToBack();
        map.fire("baselayerchange", layer as any);
        this._active = layer;

        // Update active class
        const prev = container.querySelector(".basemap.active");
        if (prev) L.DomUtil.removeClass(prev as HTMLElement, "active");
        L.DomUtil.addClass(item, "active");

        // Update alt class (next layer after active)
        const altIdx = (idx + 1) % this._basemaps.length;
        const prevAlt = container.querySelector(".basemap.alt");
        if (prevAlt) L.DomUtil.removeClass(prevAlt as HTMLElement, "alt");
        const items = container.querySelectorAll(".basemap");
        if (items[altIdx]) L.DomUtil.addClass(items[altIdx] as HTMLElement, "alt");
      });
    });

    // Desktop hover expand/collapse
    if (this._basemaps.length > 2 && !L.Browser.mobile) {
      L.DomEvent.on(container, "mouseenter", () => {
        L.DomUtil.removeClass(container, "closed");
      });
      L.DomEvent.on(container, "mouseleave", () => {
        L.DomUtil.addClass(container, "closed");
      });
    }

    return container;
  }

  private _getThumbnailUrl(layer: L.TileLayer): string {
    if ((layer.options as any).iconURL) {
      return (layer.options as any).iconURL;
    }
    const coords = { x: this._tileX, y: this._tileY };
    return L.Util.template((layer as any)._url, {
      s: (layer as any)._getSubdomain?.(coords) ?? "",
      x: coords.x,
      y: coords.y,
      z: this._tileZ,
      ...layer.options,
    });
  }
}

/**
 * Create a basemap switcher control for raster tile layers.
 */
export function createBasemapControl(
  basemaps: L.TileLayer[],
  opts?: { tileX?: number; tileY?: number; tileZ?: number },
): L.Control {
  return new BasemapControl(basemaps, opts);
}

// --------------- MapLibre Style Control ---------------

export interface StyleCandidate {
  label: string;
  url: string;
  iconURL?: string;
}

/**
 * Circular thumbnail MapLibre style switcher.
 * Port of L.Control.MaplibreStyles from the legacy codebase.
 *
 * - Probes each style URL via HEAD to check availability
 * - Renders 128x128 MapLibre preview thumbnails (offscreen)
 * - Hidden if <=1 style available
 * - Persists preference to localStorage
 */
class MaplibreStyleControl extends L.Control {
  private _mlLayer: any;
  private _candidates: StyleCandidate[];
  private _center: [number, number];
  private _zoom: number;
  private _transformRequest?: (url: string, resourceType: string) => any;
  private _active = -1;
  private _items: (HTMLElement | undefined)[] = [];
  private _availableIndices: number[] = [];
  private _storageKey = "ocap-maplibre-style";

  constructor(
    mlLayer: any,
    candidates: StyleCandidate[],
    opts?: {
      center?: [number, number];
      zoom?: number;
      transformRequest?: (url: string, resourceType: string) => any;
    },
  ) {
    super({ position: "bottomright" });
    this._mlLayer = mlLayer;
    this._candidates = candidates;
    this._center = opts?.center ?? [0, 0];
    this._zoom = opts?.zoom ?? 12;
    this._transformRequest = opts?.transformRequest;
  }

  onAdd(): HTMLElement {
    const container = L.DomUtil.create(
      "div",
      "maplibre-styles leaflet-control closed",
    );
    L.DomEvent.disableClickPropagation(container);
    if (!L.Browser.touch) {
      L.DomEvent.disableScrollPropagation(container);
    }

    // Hidden until probing completes
    container.style.display = "none";

    // Probe each candidate style URL
    const probes = this._candidates.map((candidate, i) => {
      const ctrl = new AbortController();
      return fetch(candidate.url, { method: "HEAD", signal: ctrl.signal })
        .then((res) => {
          ctrl.abort();
          return { index: i, ok: res.ok };
        })
        .catch(() => ({ index: i, ok: false }));
    });

    Promise.all(probes).then((results) => {
      const availableIndices: number[] = [];

      for (const result of results) {
        const candidate = this._candidates[result.index];
        const item = L.DomUtil.create(
          "div",
          "maplibre-style-item",
          container,
        );
        const img = L.DomUtil.create("img", "", item) as HTMLImageElement;
        img.title = candidate.label;
        // 1x1 transparent placeholder
        img.src =
          "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

        if (result.ok) {
          availableIndices.push(result.index);

          if (candidate.iconURL) {
            img.src = candidate.iconURL;
          } else {
            this._renderPreview(candidate.url, (dataUrl) => {
              if (dataUrl) img.src = dataUrl;
            });
          }

          L.DomEvent.on(item, "click", () => {
            if (
              this._candidates.length > 2 &&
              L.Browser.mobile &&
              L.DomUtil.hasClass(container, "closed")
            ) {
              L.DomUtil.removeClass(container, "closed");
              return;
            }
            if (result.index === this._active) return;
            this._setStyle(result.index, container);
          });
        } else {
          item.style.display = "none";
        }

        this._items[result.index] = item;
      }

      // Hide if <=1 style available
      if (availableIndices.length <= 1) return;

      container.style.display = "";
      this._availableIndices = availableIndices;

      // Resolve saved preference
      const saved = this._loadPreference(availableIndices);
      const activeIdx = saved ?? availableIndices[0];

      this._active = activeIdx;
      L.DomUtil.addClass(this._items[activeIdx]!, "active");
      this._updateAlt();

      // Apply saved style if different from initial
      const glMap = this._mlLayer.getMaplibreMap?.();
      if (glMap) {
        glMap.setStyle(this._candidates[activeIdx].url);
      }

      // Desktop hover expand/collapse
      if (availableIndices.length > 1 && !L.Browser.mobile) {
        L.DomEvent.on(container, "mouseenter", () => {
          L.DomUtil.removeClass(container, "closed");
        });
        L.DomEvent.on(container, "mouseleave", () => {
          L.DomUtil.addClass(container, "closed");
        });
      }
    });

    return container;
  }

  private _renderPreview(
    styleUrl: string,
    callback: (dataUrl: string | null) => void,
  ): void {
    // center is [lat, lng] (Leaflet); MapLibre expects [lng, lat]
    const center: [number, number] = [this._center[1], this._center[0]];

    const div = document.createElement("div");
    div.style.cssText =
      "width:128px;height:128px;position:absolute;left:-9999px;top:-9999px;visibility:hidden";
    document.body.appendChild(div);

    // Dynamic import to avoid hard dependency on maplibre-gl
    import("maplibre-gl").then((maplibregl) => {
      const mapOpts: any = {
        container: div,
        style: styleUrl,
        center,
        zoom: this._zoom,
        interactive: false,
        attributionControl: false,
        preserveDrawingBuffer: true,
      };
      if (this._transformRequest) {
        mapOpts.transformRequest = this._transformRequest;
      }
      const miniMap = new maplibregl.Map(mapOpts);

      const timeoutId = setTimeout(() => {
        if (div.parentNode) {
          try { miniMap.remove(); } catch { /* noop */ }
          document.body.removeChild(div);
        }
      }, 10_000);

      miniMap.once("idle", () => {
        clearTimeout(timeoutId);
        if (!div.parentNode) return;
        try {
          callback(miniMap.getCanvas().toDataURL());
        } catch {
          callback(null);
        }
        miniMap.remove();
        document.body.removeChild(div);
      });
    }).catch(() => {
      callback(null);
      if (div.parentNode) document.body.removeChild(div);
    });
  }

  private _setStyle(index: number, container: HTMLElement): void {
    const glMap = this._mlLayer.getMaplibreMap?.();
    if (!glMap) return;

    if (this._active >= 0 && this._items[this._active]) {
      L.DomUtil.removeClass(this._items[this._active]!, "active");
    }
    this._active = index;
    L.DomUtil.addClass(this._items[this._active]!, "active");
    this._updateAlt();

    glMap.setStyle(this._candidates[index].url);
    this._savePreference(index);
  }

  private _updateAlt(): void {
    // Remove existing alt
    for (const item of this._items) {
      if (item) L.DomUtil.removeClass(item, "alt");
    }
    if (this._availableIndices.length < 2) return;
    const activePos = this._availableIndices.indexOf(this._active);
    const altPos = (activePos + 1) % this._availableIndices.length;
    L.DomUtil.addClass(
      this._items[this._availableIndices[altPos]]!,
      "alt",
    );
  }

  private _savePreference(index: number): void {
    try {
      localStorage.setItem(this._storageKey, String(index));
    } catch { /* noop */ }
  }

  private _loadPreference(availableIndices: number[]): number | null {
    try {
      const val = localStorage.getItem(this._storageKey);
      if (val !== null) {
        const idx = parseInt(val, 10);
        if (availableIndices.includes(idx)) return idx;
      }
    } catch { /* noop */ }
    return null;
  }
}

/**
 * Create a MapLibre style switcher control.
 */
export function createMaplibreStyleControl(
  mlLayer: any,
  candidates: StyleCandidate[],
  opts?: {
    center?: [number, number];
    zoom?: number;
    transformRequest?: (url: string, resourceType: string) => any;
  },
): L.Control {
  return new MaplibreStyleControl(mlLayer, candidates, opts);
}
