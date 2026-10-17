import type { EntityState, EntityType, Side } from "../../data/types";
import type { ArmaCoord } from "../../utils/coordinates";
import type { EntitySnapshot } from "../types";
import { Entity } from "./entity";
import { SIDE_CLASS, SIDE_COLORS_DARK } from "../../config/sideColors";

/**
 * A human unit entity -- pure data, NO DOM, NO Leaflet, NO map dependencies.
 */
export class Unit extends Entity {
  readonly side: Side;
  readonly role: string;
  readonly isPlayer: boolean;
  readonly groupName: string;
  killCount: number;
  teamKillCount: number;
  deathCount: number;
  isInVehicle: boolean;
  private _framesFired: Array<[number, ArmaCoord]> | null;

  constructor(
    id: number,
    name: string,
    type: EntityType,
    startFrame: number,
    endFrame: number,
    side: Side,
    isPlayer: boolean,
    groupName: string,
    role: string = "",
    positions: EntityState[] | null = null,
    iconType: string = "man",
    framesFired: Array<[number, ArmaCoord]> | null = null,
  ) {
    super(id, name, type, startFrame, endFrame, positions, iconType);
    this.side = side;
    this.role = role;
    this.isPlayer = isPlayer;
    this.groupName = groupName;
    this.killCount = 0;
    this.teamKillCount = 0;
    this.deathCount = 0;
    this.isInVehicle = false;
    this._framesFired = framesFired;
  }

  /** Return all projectile target positions if this unit fired on the given absolute frame. */
  firedOnFrame(frame: number): ArmaCoord[] | null {
    if (!this._framesFired) return null;
    let targets: ArmaCoord[] | null = null;
    for (const [f, pos] of this._framesFired) {
      if (f === frame) {
        if (!targets) targets = [];
        targets.push(pos);
      }
    }
    return targets;
  }

  /** Number of recorded shots at or before this absolute frame. */
  firedCountThrough(frame: number): number {
    if (!this._framesFired) return 0;
    let count = 0;
    for (const [f] of this._framesFired) {
      if (f <= frame) count++;
    }
    return count;
  }

  /**
   * Combat side at an absolute playback frame.
   * Prefers the per-frame position side (Zeus group-side switches, etc.)
   * and falls back to the entity's spawn-time side so recordings without
   * that field keep working.
   */
  sideAtFrame(absoluteFrame: number): Side {
    const relative = this.getRelativeFrameIndex(absoluteFrame);
    if (!this.isFrameOutOfBounds(relative)) {
      const state = this.positions![relative];
      if (state?.side) return state.side;
    }
    return this.side;
  }

  /**
   * Unit type at an absolute playback frame.
   * Prefers the per-frame getUnitType (Man, MG, AT, …) and falls back to
   * the CREATE roleDescription so recordings without that field keep working.
   */
  roleAtFrame(absoluteFrame: number): string {
    const relative = this.getRelativeFrameIndex(absoluteFrame);
    if (!this.isFrameOutOfBounds(relative)) {
      const state = this.positions![relative];
      if (state?.role) return state.role;
    }
    return this.role;
  }

  /** CSS class for the unit's side: WEST->'blufor', EAST->'opfor', etc. */
  get sideClass(): string {
    return SIDE_CLASS[this.side] ?? "unknown";
  }

  /** Hex colour for the unit's side. */
  get sideColour(): string {
    return SIDE_COLORS_DARK[this.side] ?? "#000000";
  }

  override getStateAtFrame(relativeFrame: number): EntitySnapshot | null {
    if (this.isFrameOutOfBounds(relativeFrame)) return null;
    const state = this.positions![relativeFrame];
    if (!state) return null;

    return {
      id: this.id,
      position: state.position,
      direction: state.direction,
      alive: state.alive,
      side: state.side ?? this.side,
      name: state.name ?? this.name,
      iconType: this.iconType,
      isPlayer: this.isPlayer,
      isInVehicle: state.isInVehicle ?? false,
    };
  }
}
