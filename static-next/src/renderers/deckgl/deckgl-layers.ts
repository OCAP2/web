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

export function buildEntityIconLayer(
  entities: EntityData[],
  atlas: IconAtlas,
  transitions?: { getPosition?: { duration: number } },
): Layer {
  const visible = entities.filter((e) => e.visible);
  return new IconLayer<EntityData>({
    id: "entity-icons",
    data: visible,
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
    transitions: transitions,
    updateTriggers: {
      getIcon: visible.map((e) => e.iconKey),
      getAngle: visible.map((e) => e.angle),
      getSize: visible.map((e) => e.iconType),
      getColor: visible.map((e) => e.opacity),
    },
  });
}

export function buildEntityLabelLayer(
  entities: EntityData[],
  nameMode: "players" | "all" | "none",
): Layer {
  let visible: EntityData[];
  if (nameMode === "none") {
    visible = [];
  } else if (nameMode === "players") {
    visible = entities.filter((e) => e.visible && e.isPlayer);
  } else {
    visible = entities.filter((e) => e.visible);
  }

  return new TextLayer<EntityData>({
    id: "entity-labels",
    data: visible,
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
  });
}

// --------------- Fire lines ---------------

export function buildFireLineLayer(lines: LineData[]): Layer {
  return new LineLayer<LineData>({
    id: "fire-lines",
    data: lines,
    getSourcePosition: (d) => d.from,
    getTargetPosition: (d) => d.to,
    getColor: (d) => d.color,
    getWidth: (d) => d.width,
    widthUnits: "pixels",
    pickable: false,
  });
}

// --------------- Briefing layers ---------------

export function buildBriefingPolygonLayer(polygons: BriefingPolygonData[]): Layer {
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
  });
}

export function buildBriefingPathLayer(paths: BriefingPathData[]): Layer {
  return new PathLayer<BriefingPathData>({
    id: "briefing-paths",
    data: paths,
    getPath: (d) => d.path,
    getColor: (d) => d.color,
    getWidth: (d) => d.width,
    widthUnits: "pixels",
    pickable: false,
  });
}

export function buildBriefingIconLayer(icons: BriefingIconData[]): Layer {
  // Each briefing icon has a unique URL, so use individual icon atlases
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
  });
}

// --------------- Pulse effects ---------------

export function buildPulseLayer(pulses: PulseData[]): Layer {
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
  });
}
