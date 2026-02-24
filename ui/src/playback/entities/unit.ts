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

  /** Return projectile target position if this unit fired on the given absolute frame. */
  firedOnFrame(frame: number): ArmaCoord | null {
    if (!this._framesFired) return null;
    for (const [f, pos] of this._framesFired) {
      if (f === frame) return pos;
    }
    return null;
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
