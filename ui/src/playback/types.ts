import type { ArmaCoord } from "../utils/coordinates";
import type { AliveState, Side } from "../data/types";

/** Snapshot of an entity's visual state at a single frame. */
export interface EntitySnapshot {
  id: number;
  position: ArmaCoord;
  direction: number;
  alive: AliveState;
  /** Altitude in meters (from Arma Z coordinate). */
  elevation?: number;
  side: Side | null;
  name: string;
  iconType: string;
  isPlayer: boolean;
  isInVehicle: boolean;
  /** If the unit fired this frame, the projectile target position. */
  firedTarget?: ArmaCoord;
}
