import { GameEvent } from "./gameEvent";

/**
 * Represents a player connect or disconnect event during mission playback.
 */
export class ConnectEvent extends GameEvent {
  readonly unitName: string;

  constructor(
    frameNum: number,
    type: "connected" | "disconnected",
    id: number,
    unitName: string,
  ) {
    super(frameNum, type, id);
    this.unitName = unitName;
  }
}
