import { GameEvent } from "./game-event";

/**
 * Represents a hit or killed event during mission playback.
 * After entity resolution, victimName/causerName/victimSide/causerSide are populated.
 */
export class HitKilledEvent extends GameEvent {
  readonly victimId: number;
  readonly causedById: number;
  readonly distance: number;
  readonly weapon: string;

  /** Resolved after entity manager is populated. */
  victimName?: string;
  causerName?: string;
  victimSide?: string;
  causerSide?: string;

  constructor(
    frameNum: number,
    type: "hit" | "killed",
    id: number,
    victimId: number,
    causedById: number,
    distance: number,
    weapon: string,
  ) {
    super(frameNum, type, id);
    this.victimId = victimId;
    this.causedById = causedById;
    this.distance = distance;
    this.weapon = weapon;
  }
}
