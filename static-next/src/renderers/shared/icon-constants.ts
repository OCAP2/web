import type { AliveState } from "../../data/types";

// --------------- Icon sizes per entity type ---------------

export const ICON_SIZES: Record<string, [number, number]> = {
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
export const ICON_PATHS: Record<string, string> = {
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
 * Map the alive-state variant name used in icon filenames.
 * Alive uses the side-class name (e.g. "blufor"), dead/unconscious are fixed.
 */
export function aliveVariant(alive: AliveState, sideClass: string): string {
  switch (alive) {
    case 0:
      return "dead";
    case 2:
      return "unconscious";
    default:
      return sideClass;
  }
}
