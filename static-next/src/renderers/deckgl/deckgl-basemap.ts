/**
 * Build deck.gl basemap layers from a compiled MapLibre style.
 *
 * Renders vector tiles via MVTLayer and raster tiles via TileLayer+BitmapLayer,
 * with a SolidPolygonLayer background.
 */

import { GeoJsonLayer, IconLayer, TextLayer, ScatterplotLayer, SolidPolygonLayer, BitmapLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { parse } from "@loaders.gl/core";
import { MVTLoader } from "@loaders.gl/mvt";
import type { Layer } from "@deck.gl/core";
import type { PMTiles } from "pmtiles";
import { parseCssColor } from "./deckgl-expressions";
import type { ExprFn } from "./deckgl-expressions";
import type { CompiledStyle, CompiledLayer, SourceDef } from "./deckgl-style-parser";

// --------------- Types ---------------

export interface SpriteAtlas {
  image: ImageBitmap | HTMLImageElement;
  url: string;
  mapping: Record<string, { x: number; y: number; width: number; height: number; anchorY: number }>;
}

// --------------- Sprite atlas loader ---------------

export async function loadSpriteAtlas(spriteUrl: string): Promise<SpriteAtlas | null> {
  if (!spriteUrl) return null;

  try {
    // Prefer @2x if available, fallback to @1x
    const [jsonResp, imgResp] = await Promise.all([
      fetch(`${spriteUrl}.json`),
      fetch(`${spriteUrl}.png`),
    ]);

    if (!jsonResp.ok || !imgResp.ok) return null;

    const spriteJson = await jsonResp.json();
    const blob = await imgResp.blob();
    const image = await createImageBitmap(blob);

    // Convert MapLibre sprite format to deck.gl iconMapping
    const mapping: SpriteAtlas["mapping"] = {};
    for (const [name, def] of Object.entries<any>(spriteJson)) {
      mapping[name] = {
        x: def.x,
        y: def.y,
        width: def.width,
        height: def.height,
        anchorY: def.height / 2,
      };
    }

    return { image, url: `${spriteUrl}.png`, mapping };
  } catch {
    return null;
  }
}

// --------------- Color helpers ---------------

function evalColor(expr: ExprFn | undefined, props: Record<string, any>, zoom: number, fallback: string): [number, number, number, number] {
  if (!expr) return parseCssColor(fallback);
  const val = expr(props, zoom);
  if (typeof val === "string") return parseCssColor(val);
  return parseCssColor(fallback);
}

function evalNumber(expr: ExprFn | undefined, props: Record<string, any>, zoom: number, fallback: number): number {
  if (!expr) return fallback;
  const val = expr(props, zoom);
  return typeof val === "number" ? val : fallback;
}

// --------------- Vector sub-layers (batched by geometry type) ---------------

/**
 * Build sub-layers for a single vector tile, batching features by geometry type.
 *
 * Instead of creating one deck.gl layer per style layer (~30 per tile),
 * we pre-compute style values on each feature and batch into ~6 typed layers:
 * fills → lines → extrusions → circles → icons → texts.
 * This reduces draw calls from ~600 to ~120 across all visible tiles.
 */
function buildVectorSubLayers(
  tileProps: any,
  compiledLayers: CompiledLayer[],
  zoom: number,
  spriteAtlas: SpriteAtlas | null,
): Layer[] {
  const { data, id: tileId } = tileProps;
  if (!data || !Array.isArray(data) || data.length === 0) return [];

  // Group features by source layer name (set by MVT loader as `layerName`)
  const bySourceLayer = new Map<string, any[]>();
  for (const feature of data) {
    const name = feature.properties?.layerName ?? "";
    let arr = bySourceLayer.get(name);
    if (!arr) {
      arr = [];
      bySourceLayer.set(name, arr);
    }
    arr.push(feature);
  }

  // Typed batches — features are pushed in style-layer order to preserve
  // cartographic ordering within each batch.
  const fills: any[] = [];
  const lines: any[] = [];
  const extrusions: any[] = [];
  const circles: any[] = [];
  const icons: any[] = [];
  const texts: any[] = [];

  for (const layer of compiledLayers) {
    if (zoom < layer.minZoom || zoom > layer.maxZoom) continue;

    const features = bySourceLayer.get(layer.sourceLayer);
    if (!features || features.length === 0) continue;

    let filtered = features;
    if (layer.filter) {
      const filterFn = layer.filter;
      filtered = features.filter((f) => filterFn(f.properties || {}, zoom));
    }
    if (filtered.length === 0) continue;

    switch (layer.type) {
      case "fill":
        for (const f of filtered) {
          const c = evalColor(layer.paint["fill-color"], f.properties, zoom, "#888");
          const opacity = evalNumber(layer.paint["fill-opacity"], f.properties, zoom, 1);
          fills.push({
            type: f.type, geometry: f.geometry, properties: f.properties,
            _color: [c[0], c[1], c[2], Math.round(c[3] * opacity)],
          });
        }
        break;

      case "line":
        for (const f of filtered) {
          const c = evalColor(layer.paint["line-color"], f.properties, zoom, "#000");
          const opacity = evalNumber(layer.paint["line-opacity"], f.properties, zoom, 1);
          lines.push({
            type: f.type, geometry: f.geometry, properties: f.properties,
            _color: [c[0], c[1], c[2], Math.round(c[3] * opacity)],
            _width: evalNumber(layer.paint["line-width"], f.properties, zoom, 1),
          });
        }
        break;

      case "fill-extrusion":
        for (const f of filtered) {
          const c = evalColor(layer.paint["fill-extrusion-color"], f.properties, zoom, "#888");
          const opacity = evalNumber(layer.paint["fill-extrusion-opacity"], f.properties, zoom, 1);
          extrusions.push({
            type: f.type, geometry: f.geometry, properties: f.properties,
            _color: [c[0], c[1], c[2], Math.round(c[3] * opacity)],
            _height: evalNumber(layer.paint["fill-extrusion-height"], f.properties, zoom, 0),
          });
        }
        break;

      case "circle":
        for (const f of filtered) {
          const c = evalColor(layer.paint["circle-color"], f.properties, zoom, "#000");
          const opacity = evalNumber(layer.paint["circle-opacity"], f.properties, zoom, 1);
          circles.push({
            position: f.geometry?.coordinates ?? [0, 0],
            _color: [c[0], c[1], c[2], Math.round(c[3] * opacity)],
            _radius: evalNumber(layer.paint["circle-radius"], f.properties, zoom, 5),
          });
        }
        break;

      case "symbol": {
        const iconImage = layer.layout["icon-image"];
        const textField = layer.layout["text-field"];
        const placement = layer.layout["symbol-placement"];
        const placementVal = placement ? placement({}, zoom) : "point";

        if (iconImage && spriteAtlas) {
          const iconSize = layer.layout["icon-size"];
          for (const f of filtered) {
            const name = iconImage(f.properties, zoom);
            if (name && spriteAtlas.mapping[name]) {
              const scale = iconSize ? evalNumber(iconSize, f.properties, zoom, 1) : 1;
              icons.push({
                position: f.geometry?.coordinates ?? [0, 0],
                _icon: name,
                _size: 64 * scale,
              });
            }
          }
        }

        if (textField && placementVal !== "line") {
          const textSize = layer.layout["text-size"];
          const textOffset = layer.layout["text-offset"];
          const textAnchor = layer.layout["text-anchor"];
          const anchor = textAnchor ? textAnchor({}, zoom) : "center";
          const mappedAnchor = anchor === "left" ? "start" : anchor === "right" ? "end" : "middle";
          let pixelOffset: [number, number] = [0, 0];
          if (textOffset) {
            const off = textOffset({}, zoom);
            if (Array.isArray(off)) pixelOffset = [off[0] * 16, off[1] * 16];
          }

          for (const f of filtered) {
            const text = textField(f.properties, zoom);
            if (text != null && String(text) !== "") {
              texts.push({
                position: f.geometry?.coordinates ?? [0, 0],
                _text: String(text),
                _size: evalNumber(textSize, f.properties, zoom, 14),
                _color: evalColor(layer.paint["text-color"], f.properties, zoom, "#000"),
                _anchor: mappedAnchor,
                _pixelOffset: pixelOffset,
              });
            }
          }
        }
        break;
      }
    }
  }

  // Build one deck.gl layer per non-empty batch
  const subLayers: Layer[] = [];

  if (fills.length > 0) {
    subLayers.push(new GeoJsonLayer({
      id: `${tileId}-fills`,
      data: fills,
      filled: true,
      stroked: false,
      getFillColor: (d: any) => d._color,
      pickable: false,
    }));
  }

  if (lines.length > 0) {
    subLayers.push(new GeoJsonLayer({
      id: `${tileId}-lines`,
      data: lines,
      filled: false,
      stroked: true,
      getLineColor: (d: any) => d._color,
      getLineWidth: (d: any) => d._width,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 0.5,
      pickable: false,
    }));
  }

  if (extrusions.length > 0) {
    subLayers.push(new GeoJsonLayer({
      id: `${tileId}-extrusions`,
      data: extrusions,
      filled: true,
      stroked: false,
      extruded: true,
      getFillColor: (d: any) => d._color,
      getElevation: (d: any) => d._height,
      pickable: false,
    }));
  }

  if (circles.length > 0) {
    subLayers.push(new ScatterplotLayer({
      id: `${tileId}-circles`,
      data: circles,
      getPosition: (d: any) => d.position,
      getRadius: (d: any) => d._radius,
      getFillColor: (d: any) => d._color,
      radiusUnits: "pixels",
      pickable: false,
    }));
  }

  if (icons.length > 0 && spriteAtlas) {
    subLayers.push(new IconLayer({
      id: `${tileId}-icons`,
      data: icons,
      iconAtlas: spriteAtlas.url,
      iconMapping: spriteAtlas.mapping,
      getIcon: (d: any) => d._icon,
      getPosition: (d: any) => d.position,
      getSize: (d: any) => d._size,
      sizeUnits: "pixels",
      billboard: false,
      pickable: false,
    }));
  }

  if (texts.length > 0) {
    subLayers.push(new TextLayer({
      id: `${tileId}-texts`,
      data: texts,
      getPosition: (d: any) => d.position,
      getText: (d: any) => d._text,
      getSize: (d: any) => d._size,
      getColor: (d: any) => d._color,
      getTextAnchor: (d: any) => d._anchor,
      getPixelOffset: (d: any) => d._pixelOffset,
      sizeUnits: "pixels",
      billboard: false,
      fontFamily: "Arial, sans-serif",
      pickable: false,
    }));
  }

  return subLayers;
}

// --------------- Raster tile layer ---------------

function buildRasterTileLayer(
  id: string,
  pmtiles: PMTiles,
  _source: SourceDef,
): Layer {
  return new TileLayer({
    id,
    getTileData: async ({ index: { z, x, y } }: any) => {
      try {
        const result = await pmtiles.getZxy(z, x, y);
        if (!result || !result.data) return null;
        return createImageBitmap(new Blob([result.data]));
      } catch {
        return null;
      }
    },
    renderSubLayers: (props: any) => {
      if (!props.data) return null;
      const { west, south, east, north } = props.tile.bbox;
      return new BitmapLayer({
        ...props,
        image: props.data,
        bounds: [west, south, east, north],
      });
    },
    minZoom: 0,
    maxZoom: 22,
    tileSize: _source.tileSize ?? 256,
  }) as unknown as Layer;
}

// --------------- Background layer ---------------

function buildBackgroundLayer(
  bgColor: ExprFn,
  zoom: number,
  worldSizeDeg: number,
): Layer {
  const color = parseCssColor(bgColor({}, zoom));
  // World-covering polygon
  return new SolidPolygonLayer({
    id: "basemap-background",
    data: [{
      polygon: [
        [-1, -1],
        [worldSizeDeg + 1, -1],
        [worldSizeDeg + 1, worldSizeDeg + 1],
        [-1, worldSizeDeg + 1],
      ],
    }],
    getPolygon: (d: any) => d.polygon,
    getFillColor: color,
    pickable: false,
  }) as unknown as Layer;
}

// --------------- Stable tile data fetcher ---------------

/**
 * Create a stable getTileData function for a PMTiles vector source.
 * Call once per PMTiles instance and reuse across basemap rebuilds
 * so deck.gl's TileLayer keeps its tile cache instead of refetching.
 */
export function createVectorTileDataFetcher(pmtiles: PMTiles) {
  return async ({ index: { z, x, y } }: any) => {
    try {
      const result = await pmtiles.getZxy(z, x, y);
      if (!result?.data) return null;
      return await parse(result.data, MVTLoader, {
        mvt: { coordinates: "wgs84", tileIndex: { x, y, z } },
      });
    } catch {
      return null;
    }
  };
}

// --------------- Assembly ---------------

export interface BasemapConfig {
  compiledStyle: CompiledStyle;
  zoom: number;
  worldSizeDeg: number;
  spriteAtlas: SpriteAtlas | null;
  vectorPMTiles?: PMTiles;
  vectorMaxZoom?: number;
  /** Stable getTileData function — created once via createVectorTileDataFetcher. */
  vectorGetTileData?: (opts: any) => Promise<any>;
  rasterPMTiles?: Map<string, PMTiles>;
}

/**
 * Build all basemap layers from a compiled style.
 * Returns layers in render order: background, raster, vector.
 */
export function buildBasemapLayers(config: BasemapConfig): Layer[] {
  const { compiledStyle, zoom, worldSizeDeg, spriteAtlas, vectorPMTiles, vectorMaxZoom, vectorGetTileData, rasterPMTiles } = config;
  const layers: Layer[] = [];

  // 1. Background
  layers.push(buildBackgroundLayer(compiledStyle.background, zoom, worldSizeDeg));

  // 2. Raster tile layers
  if (rasterPMTiles) {
    for (const [name, pmtiles] of rasterPMTiles) {
      const source = compiledStyle.sources[name];
      if (source && source.type === "raster") {
        layers.push(buildRasterTileLayer(`basemap-raster-${name}`, pmtiles, source));
      }
    }
  }

  // 3. Vector tile layer (TileLayer + MVT parsing)
  if (vectorPMTiles) {
    // Filter to layers from vector sources only
    const vectorSourceNames = new Set(
      Object.entries(compiledStyle.sources)
        .filter(([_, s]) => s.type === "vector")
        .map(([name]) => name),
    );
    const vectorLayers = compiledStyle.layers.filter((l) => vectorSourceNames.has(l.source));

    if (vectorLayers.length > 0) {
      const intZoom = Math.floor(zoom);
      // Use stable getTileData reference if provided (avoids tile cache
      // invalidation on zoom change). Fall back to creating one on the fly.
      const getTileData = vectorGetTileData ?? createVectorTileDataFetcher(vectorPMTiles);
      layers.push(
        new TileLayer({
          id: "basemap-vector",
          getTileData,
          renderSubLayers: (props: any) =>
            buildVectorSubLayers(props, vectorLayers, zoom, spriteAtlas),
          updateTriggers: {
            renderSubLayers: intZoom,
          },
          minZoom: 0,
          maxZoom: vectorMaxZoom ?? 14,
        }) as unknown as Layer,
      );
    }
  }

  return layers;
}
