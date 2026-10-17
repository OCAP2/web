import type { ArmaCoord } from "../utils/coordinates";
import type { AliveState, Side } from "../data/types";

/** Snapshot of an entity's visual state at a single frame. */
export interface EntitySnapshot {
  id: number;
  position: ArmaCoord;
  direction: number;
  alive: AliveState;
  side: Side | null;
  name: string;
  iconType: string;
  isPlayer: boolean;
  isInVehicle: boolean;
  /** If the unit fired this frame, all projectile target positions. */
  firedTargets?: ArmaCoord[];
  /** Arma getObjectFOV (tan of half-angle) when this is a flying Zeus camera. */
  fov?: number;
  /** Look-vector Z, used to shorten the FOV cone when looking down. */
  pitch?: number;
  /** Unit being remote-controlled by this Zeus entity, if any. */
  controllingUnitId?: number;
}
