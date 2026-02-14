import type { EntityState, EntityType, Side } from "../../data/types";
import type { EntitySnapshot } from "../types";
import { Entity } from "./entity";
import { Unit } from "./unit";

/**
 * A vehicle entity -- pure data, NO DOM, NO Leaflet, NO map dependencies.
 */
export class Vehicle extends Entity {
  readonly vehicleType: string;
  crew: number[];

  constructor(
    id: number,
    name: string,
    type: EntityType,
    startFrame: number,
    endFrame: number,
    vehicleType: string,
    positions: EntityState[] | null = null,
    iconType: string = "unknown",
  ) {
    super(id, name, type, startFrame, endFrame, positions, iconType);
    this.vehicleType = vehicleType;
    this.crew = [];
  }

  /** Update the crew list (array of unit IDs). */
  setCrew(ids: number[]): void {
    this.crew = ids;
  }

  /**
   * Derive the vehicle's effective side from its first crew member that
   * is a Unit. Returns null if there is no crew or no crew member is a Unit.
   *
   * @param getEntity  Lookup function to resolve entity IDs.
   */
  getSideFromCrew(getEntity: (id: number) => Entity | null): Side | null {
    for (const id of this.crew) {
      const entity = getEntity(id);
      if (entity instanceof Unit) {
        return entity.side;
      }
    }
    return null;
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
      side: null, // vehicles derive side from crew at render time
      name: state.name ?? this.name,
      iconType: this.iconType,
      isPlayer: false,
      isInVehicle: false,
    };
  }
}
