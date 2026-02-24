import type { EntityType, EntityState } from "../../data/types";
import type { EntitySnapshot } from "../types";

/**
 * Base Entity class -- pure data, NO DOM, NO Leaflet, NO map dependencies.
 *
 * Represents a mission entity (unit or vehicle) with its per-frame state array.
 */
export class Entity {
  readonly id: number;
  name: string;
  readonly type: EntityType;
  readonly startFrame: number;
  readonly endFrame: number;
  positions: EntityState[] | null;
  iconType: string;
  alive: boolean;

  constructor(
    id: number,
    name: string,
    type: EntityType,
    startFrame: number,
    endFrame: number,
    positions: EntityState[] | null = null,
    iconType: string = "unknown",
  ) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.startFrame = startFrame;
    this.endFrame = endFrame;
    this.positions = positions;
    this.iconType = iconType;
    this.alive = true;
  }

  /**
   * Convert an absolute frame number to a relative index into the positions
   * array, accounting for this entity's startFrame.
   *
   * E.g. absolute 31 with startFrame 30 => relative index 1.
   */
  getRelativeFrameIndex(absoluteFrame: number): number {
    return absoluteFrame - this.startFrame;
  }

  /**
   * Returns true if the relative frame index is outside the valid range
   * of the positions array (entity does not exist at this frame).
   */
  isFrameOutOfBounds(relativeFrame: number): boolean {
    if (relativeFrame < 0) return true;
    if (this.positions === null) return true;
    return relativeFrame >= this.positions.length;
  }

  /**
   * Return an EntitySnapshot for the given relative frame, or null if the
   * frame is out of bounds or positions are not loaded.
   */
  getStateAtFrame(relativeFrame: number): EntitySnapshot | null {
    if (this.isFrameOutOfBounds(relativeFrame)) return null;
    const state = this.positions![relativeFrame];
    if (!state) return null;

    return {
      id: this.id,
      position: state.position,
      direction: state.direction,
      alive: state.alive,
      side: state.name ? "CIV" : "CIV", // base entity has no side; subclasses override
      name: state.name ?? this.name,
      iconType: this.iconType,
      isPlayer: false,
      isInVehicle: state.isInVehicle ?? false,
    };
  }
}
