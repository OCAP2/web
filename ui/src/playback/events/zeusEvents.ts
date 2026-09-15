import { GameEvent } from "./gameEvent";
import type {
  ZeusCameraPayload,
  ZeusEntityPayload,
  ZeusModulePayload,
  ZeusPingPayload,
  ZeusRemoteControlPayload,
} from "../../data/types";

export class ZeusEntityEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: ZeusEntityPayload,
  ) {
    super(frameNum, "zeusEntity", id);
  }

  get curatorId(): number {
    return this.payload.curatorId;
  }
}

export class ZeusRemoteControlEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: ZeusRemoteControlPayload,
  ) {
    super(frameNum, "zeusRemoteControl", id);
  }
}

export class ZeusCameraEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: ZeusCameraPayload,
  ) {
    super(frameNum, "zeusCamera", id);
  }
}

/**
 * A player pinged Zeus. Unlike the other Zeus events this one is also a
 * human-readable mission event, so it stays in the normal event log.
 */
export class ZeusPingEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: ZeusPingPayload,
  ) {
    super(frameNum, "zeusPing", id);
  }

  get unitId(): number {
    return this.payload.unitId;
  }

  get position(): [number, number] {
    return [this.payload.x, this.payload.y];
  }
}

/**
 * A Zeus placed a module. Human-readable mission event: stays in the event
 * log forever, and is drawn on the map for a short fade like a ping.
 */
export class ZeusModuleEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: ZeusModulePayload,
  ) {
    super(frameNum, "zeusModule", id);
  }

  get curatorId(): number {
    return this.payload.curatorId;
  }

  get position(): [number, number] {
    return [this.payload.x, this.payload.y];
  }
}
