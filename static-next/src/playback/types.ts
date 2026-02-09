import type { ArmaCoord } from "../utils/coordinates";
import type { AliveState, Side } from "../data/types";

/** Snapshot of an entity's visual state at a single frame. */
export interface EntitySnapshot {
  id: number;
  position: ArmaCoord;
  direction: number;
  alive: AliveState;
  side: Side;
  name: string;
  iconType: string;
  isInVehicle: boolean;
}
