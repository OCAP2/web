import L from "leaflet";
import type { Side, AliveState } from "../../data/types";
import { SIDE_CLASS, SIDE_COLORS_DARK } from "../../config/side-colors";

// --------------- Side → CSS class / colour mapping ---------------

export interface SideStyle {
  cssClass: string;
  colour: string;
}

export function sideStyle(side: Side): SideStyle {
  return {
    cssClass: SIDE_CLASS[side] ?? "unknown",
    colour: SIDE_COLORS_DARK[side] ?? "#b29900",
  };
}

// --------------- Icon sizes per entity type ---------------

const ICON_SIZES: Record<string, [number, number]> = {
  man: [16, 16],
  ship: [28, 28],
  parachute: [20, 20],
  heli: [32, 32],
  plane: [32, 32],
  truck: [28, 28],
  car: [24, 24],
  apc: [28, 28],
  tank: [28, 28],
  staticMortar: [20, 20],
  staticWeapon: [20, 20],
  unknown: [28, 28],
};

/** Image path directory per entity type. */
const ICON_PATHS: Record<string, string> = {
  man: "images/markers/man/",
  ship: "images/markers/ship/",
  parachute: "images/markers/parachute/",
  heli: "images/markers/heli/",
  plane: "images/markers/plane/",
  truck: "images/markers/truck/",
  car: "images/markers/car/",
  apc: "images/markers/apc/",
  tank: "images/markers/tank/",
  staticMortar: "images/markers/static-mortar/",
  staticWeapon: "images/markers/static-weapon/",
  unknown: "images/markers/unknown/",
};

/**
 * Map the alive-state variant name used in icon filenames.
 * Alive uses the side-class name (e.g. "blufor"), dead/unconscious are fixed.
 */
function aliveVariant(alive: AliveState, sideClass: string): string {
  switch (alive) {
    case 0:
      return "dead";
    case 2:
      return "unconscious";
    default:
      return sideClass;
  }
}

// --------------- Public API ---------------

export interface EntityIcon {
  icon: L.Icon;
  opacity: number;
}

/**
 * Build a Leaflet L.icon for a given entity type, side, and alive state.
 */
export function entityIcon(
  iconType: string,
  side: Side | null,
  alive: AliveState,
): EntityIcon {
  const type = ICON_PATHS[iconType] ? iconType : "unknown";
  const size = ICON_SIZES[type];
  const style = side ? sideStyle(side) : { cssClass: "dead", colour: "#000000" };
  const variant = aliveVariant(alive, style.cssClass);
  const path = ICON_PATHS[type];

  return {
    icon: L.icon({
      className: "animation",
      iconSize: size,
      iconAnchor: [size[0] / 2, size[1] / 2],
      iconUrl: `${path}${variant}.svg`,
    }),
    opacity: alive === 0 ? 0.4 : 1,
  };
}

/**
 * Build the "hit flash" icon for an entity type.
 */
export function hitIcon(iconType: string): L.Icon {
  const type = ICON_PATHS[iconType] ? iconType : "unknown";
  const size = ICON_SIZES[type];
  const path = ICON_PATHS[type];
  return L.icon({
    className: "animation",
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1] / 2],
    iconUrl: `${path}hit.svg`,
  });
}

/**
 * Returns the icon size for a given entity type (used for marker anchoring).
 */
export function iconSize(iconType: string): [number, number] {
  return ICON_SIZES[iconType] ?? ICON_SIZES.unknown;
}

// --------------- Icon atlas: entityType × state string ---------------

/**
 * All visual states an entity icon can be in.
 * Side states use the side CSS class name; others are fixed filenames.
 */
export const ICON_STATES = [
  "blufor",
  "opfor",
  "ind",
  "civ",
  "logic",
  "unknown",
  "dead",
  "hit",
  "follow",
  "unconscious",
] as const;

export type IconState = (typeof ICON_STATES)[number];

/**
 * Build a Leaflet L.Icon for a given entity type and string-based state.
 *
 * This is the atlas-style API matching the legacy icon creation where every
 * combination of entity type and visual state (blufor, opfor, dead, hit, etc.)
 * gets its own pre-built L.Icon instance.
 *
 * @param iconType  One of the entity type keys (man, car, tank, ...).
 * @param state     One of the ICON_STATES values.
 */
export function getEntityIcon(iconType: string, state: string): L.Icon {
  const type = ICON_PATHS[iconType] ? iconType : "unknown";
  const size = ICON_SIZES[type];
  const path = ICON_PATHS[type];
  const variant = ICON_STATES.includes(state as IconState) ? state : "unknown";

  return L.icon({
    className: "animation",
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1] / 2],
    iconUrl: `${path}${variant}.svg`,
  });
}
