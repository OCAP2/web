import { IconLayer, TextLayer, LineLayer, PathLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { IconAtlas } from "./deckgl-icon-atlas";
import type {
  EntityData,
  LineData,
  BriefingPolygonData,
  BriefingPathData,
  BriefingIconData,
  PulseData,
} from "./deckgl-state";
import { ICON_SIZES } from "../shared/icon-constants";

// --------------- Entity layers ---------------

/**
 * @param visibleEntities Pre-filtered array of visible entities (cached by DeckState).
 * @param revision Monotonic counter — deck.gl only re-diffs accessors when this changes.
 */
export function buildEntityIconLayer(
  visibleEntities: EntityData[],
  atlas: IconAtlas,
  revision: number,
  transitions?: { getPosition?: { duration: number } },
): Layer {
  return new IconLayer<EntityData>({
    id: "entity-icons",
    data: visibleEntities,
    iconAtlas: atlas.atlasUrl,
    iconMapping: atlas.mapping,
    getIcon: (d) => d.iconKey,
    getPosition: (d) => d.position,
    getAngle: (d) => -d.angle, // deck.gl uses counter-clockwise
    getSize: (d) => {
      const size = ICON_SIZES[d.iconType] ?? ICON_SIZES.unknown;
      return Math.max(size[0], size[1]) * d.sizeScale;
    },
    getColor: (d) => [255, 255, 255, Math.round(d.opacity * 255)],
    sizeScale: 1,
    sizeUnits: "pixels",
    billboard: true,
    alphaCutoff: 0.05,
    pickable: true,
    transitions,
    // Single revision counter — deck.gl only re-evaluates accessors when
    // this value changes, instead of diffing N-element arrays every frame.
    updateTriggers: {
      getIcon: revision,
      getAngle: revision,
      getSize: revision,
      getColor: revision,
      getPosition: revision,
    },
  });
}

/**
 * @param visibleEntities Pre-filtered array of visible entities.
 * @param revision Monotonic counter for updateTriggers.
 */
export function buildEntityLabelLayer(
  visibleEntities: EntityData[],
  nameMode: "players" | "all" | "none",
  revision: number,
): Layer {
  let data: EntityData[];
  if (nameMode === "none") {
    data = [];
  } else if (nameMode === "players") {
    data = visibleEntities.filter((e) => e.isPlayer);
  } else {
    data = visibleEntities;
  }

  return new TextLayer<EntityData>({
    id: "entity-labels",
    data,
    getPosition: (d) => d.position,
    getText: (d) => d.name,
    getColor: [255, 255, 255, 220],
    getSize: 12,
    sizeUnits: "pixels",
    getPixelOffset: [0, -20],
    billboard: true,
    background: true,
    getBackgroundColor: [0, 0, 0, 160],
    getBorderColor: [0, 0, 0, 0],
    fontFamily: "Arial, sans-serif",
    fontWeight: "normal",
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    pickable: false,
    updateTriggers: {
      getPosition: revision,
      getText: revision,
    },
  });
}

// --------------- Fire lines ---------------

export function buildFireLineLayer(lines: LineData[], revision: number): Layer {
  return new LineLayer<LineData>({
    id: "fire-lines",
    data: lines,
    getSourcePosition: (d) => d.from,
    getTargetPosition: (d) => d.to,
    getColor: (d) => d.color,
    getWidth: (d) => d.width,
    widthUnits: "pixels",
    pickable: false,
    updateTriggers: {
      getSourcePosition: revision,
      getTargetPosition: revision,
      getColor: revision,
    },
  });
}

// --------------- Briefing layers ---------------

export function buildBriefingPolygonLayer(polygons: BriefingPolygonData[], revision: number): Layer {
  return new PolygonLayer<BriefingPolygonData>({
    id: "briefing-polygons",
    data: polygons,
    getPolygon: (d) => d.polygon,
    getFillColor: (d) => d.fillColor,
    getLineColor: (d) => d.lineColor,
    getLineWidth: 2,
    lineWidthUnits: "pixels",
    stroked: true,
    filled: true,
    pickable: false,
    updateTriggers: {
      getPolygon: revision,
      getFillColor: revision,
      getLineColor: revision,
    },
  });
}

export function buildBriefingPathLayer(paths: BriefingPathData[], revision: number): Layer {
  return new PathLayer<BriefingPathData>({
    id: "briefing-paths",
    data: paths,
    getPath: (d) => d.path,
    getColor: (d) => d.color,
    getWidth: (d) => d.width,
    widthUnits: "pixels",
    pickable: false,
    updateTriggers: {
      getPath: revision,
      getColor: revision,
    },
  });
}

export function buildBriefingIconLayer(icons: BriefingIconData[], revision: number): Layer {
  return new IconLayer<BriefingIconData>({
    id: "briefing-icons",
    data: icons,
    getPosition: (d) => d.position,
    getIcon: (d) => ({
      url: d.iconUrl,
      width: d.size[0],
      height: d.size[1],
      anchorY: d.size[1] / 2,
    }),
    getAngle: (d) => -d.angle,
    getSize: (d) => Math.max(d.size[0], d.size[1]),
    getColor: (d) => [255, 255, 255, Math.round(d.opacity * 255)],
    sizeUnits: "pixels",
    billboard: true,
    pickable: false,
    updateTriggers: {
      getPosition: revision,
      getIcon: revision,
      getAngle: revision,
      getColor: revision,
    },
  });
}

// --------------- Pulse effects ---------------

export function buildPulseLayer(pulses: PulseData[], revision: number): Layer {
  return new ScatterplotLayer<PulseData>({
    id: "pulse-effects",
    data: pulses,
    getPosition: (d) => d.position,
    getRadius: (d) => d.radius,
    getFillColor: (d) => d.fillColor,
    getLineColor: (d) => d.color,
    getLineWidth: 2,
    lineWidthUnits: "pixels",
    radiusUnits: "pixels",
    stroked: true,
    filled: true,
    pickable: false,
    updateTriggers: {
      getRadius: revision,
      getFillColor: revision,
    },
  });
}
