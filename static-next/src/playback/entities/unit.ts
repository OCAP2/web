import type { EntityState, EntityType, Side } from "../../data/types";
import type { EntitySnapshot } from "../types";
import { Entity } from "./entity";
import { SIDE_CLASS, SIDE_COLORS_DARK } from "../../config/side-colors";

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
  isInVehicle: boolean;

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
  ) {
    super(id, name, type, startFrame, endFrame, positions, iconType);
    this.side = side;
    this.role = role;
    this.isPlayer = isPlayer;
    this.groupName = groupName;
    this.killCount = 0;
    this.teamKillCount = 0;
    this.isInVehicle = false;
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
      side: this.side,
      name: state.name ?? this.name,
      iconType: this.iconType,
      isInVehicle: state.isInVehicle ?? false,
    };
  }
}
