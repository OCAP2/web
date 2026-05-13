import { GameEvent } from "./gameEvent";

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
  /** Causer's kill score at the time of this event: killCount - (teamKillCount * 2). */
  causerKillScore?: number;
  /** True if victim is a vehicle (no kill score shown for vehicle kills). */
  victimIsVehicle?: boolean;

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

  /**
   * True if this is a friendly-fire (team kill / team hit) event:
   * causer and victim share a side, the event is not a suicide, and
   * the victim is a unit (not a vehicle). Requires resolveReferences()
   * to have populated victimSide, causerSide, and victimIsVehicle.
   */
  isFriendlyFire(): boolean {
    return (
      this.causerSide !== undefined &&
      this.victimSide !== undefined &&
      this.causerSide === this.victimSide &&
      this.victimId !== this.causedById &&
      !this.victimIsVehicle
    );
  }
}
