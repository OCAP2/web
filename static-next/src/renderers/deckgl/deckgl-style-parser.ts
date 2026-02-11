/**
 * Parse a MapLibre GL style v8 document into compiled layer definitions
 * that can be evaluated by the deck.gl basemap renderer.
 */

import { compileExpression, compileFilter } from "./deckgl-expressions";
import type { ExprFn } from "./deckgl-expressions";

// --------------- Types ---------------

export interface CompiledStyle {
  background: ExprFn;
  sources: Record<string, SourceDef>;
  layers: CompiledLayer[];
  spriteUrl: string;
}

export interface SourceDef {
  type: string;
  url: string;
  tileSize?: number;
}

export interface CompiledLayer {
  id: string;
  type: "fill" | "line" | "circle" | "symbol" | "fill-extrusion" | "raster" | "background";
  source: string;
  sourceLayer: string;
  minZoom: number;
  maxZoom: number;
  filter?: ExprFn;
  paint: Record<string, ExprFn>;
  layout: Record<string, ExprFn>;
}

// --------------- Parser ---------------

/**
 * Parse a MapLibre style document and compile all expressions.
 */
export function parseStyleDocument(doc: any): CompiledStyle {
  let background: ExprFn = () => "#DFDFDF";

  // Sources: strip pmtiles:// prefix, resolve relative URLs
  const sources: Record<string, SourceDef> = {};
  if (doc.sources) {
    for (const [name, src] of Object.entries<any>(doc.sources)) {
      let url = src.url || "";
      if (url.startsWith("pmtiles://")) {
        url = url.slice("pmtiles://".length);
      }
      // Resolve relative URLs to page origin
      if (url && !url.startsWith("http")) {
        url = new URL(url, window.location.href).href;
      }
      sources[name] = {
        type: src.type,
        url,
        tileSize: src.tileSize,
      };
    }
  }

  // Layers: compile in cartographic order (as given)
  const layers: CompiledLayer[] = [];

  if (doc.layers) {
    for (const layer of doc.layers) {
      if (layer.type === "background") {
        background = compileExpression(layer.paint?.["background-color"] ?? "#DFDFDF");
        continue;
      }

      // Skip layers without a source (e.g. background)
      if (!layer.source) continue;

      // Compile paint properties
      const paint: Record<string, ExprFn> = {};
      if (layer.paint) {
        for (const [key, val] of Object.entries(layer.paint)) {
          paint[key] = compileExpression(val);
        }
      }

      // Compile layout properties
      const layout: Record<string, ExprFn> = {};
      if (layer.layout) {
        for (const [key, val] of Object.entries(layer.layout)) {
          layout[key] = compileExpression(val);
        }
      }

      layers.push({
        id: layer.id,
        type: layer.type,
        source: layer.source,
        sourceLayer: layer["source-layer"] || "",
        minZoom: layer.minzoom ?? 0,
        maxZoom: layer.maxzoom ?? 24,
        filter: compileFilter(layer.filter),
        paint,
        layout,
      });
    }
  }

  // Sprite URL
  let spriteUrl = doc.sprite || "";
  if (spriteUrl && !spriteUrl.startsWith("http")) {
    spriteUrl = new URL(spriteUrl, window.location.href).href;
  }

  return { background, sources, layers, spriteUrl };
}
