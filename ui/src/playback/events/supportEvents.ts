import { GameEvent } from "./gameEvent";
import type {
  ExplosionPayload,
  RadioTransmissionPayload,
  ServiceEventPayload,
  StaticWeaponPayload,
} from "../../data/types";

/**
 * A detonation, drawn on the map as the area its blast covered and listed in the
 * event log like any other mission event.
 */
export class ExplosionEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: ExplosionPayload,
  ) {
    super(frameNum, "explosion", id);
  }

  get position(): [number, number] {
    return [this.payload.x, this.payload.y];
  }

  /** Blast radius in metres, straight from the ammo's indirectHitRange. */
  get radius(): number {
    return this.payload.radius;
  }
}

/** A vehicle was repaired, refuelled or rearmed. */
export class ServiceEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: ServiceEventPayload,
  ) {
    super(frameNum, "serviceEvent", id);
  }

  get position(): [number, number] {
    return [this.payload.x, this.payload.y];
  }

  /**
   * How much of the job this event covers, 0-1, or null when the kind has no
   * meaningful span. A repair counts damage removed, a refuel fuel added.
   */
  get progress(): number | null {
    if (this.payload.kind === "rearm") return null;
    return Math.abs(this.payload.to - this.payload.from);
  }
}

/**
 * One push-to-talk. Start and Stop arrive as separate events; `comms.ts` folds
 * the pair into a transmission with a duration.
 */
export class RadioTransmissionEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: RadioTransmissionPayload,
  ) {
    super(frameNum, "radioTransmission", id);
  }

  get unitId(): number {
    return this.payload.unitId;
  }

  get isStart(): boolean {
    return this.payload.action === "Start";
  }
}

/** A static weapon was assembled from bags, or taken apart again. */
export class StaticWeaponEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: StaticWeaponPayload,
  ) {
    super(frameNum, "staticWeapon", id);
  }

  get position(): [number, number] {
    return [this.payload.x, this.payload.y];
  }

  get assembled(): boolean {
    return this.payload.action === "assembled";
  }
}
