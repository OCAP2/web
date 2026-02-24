import { GameEvent } from "./gameEvent";

/**
 * Represents a capture event (flag capture or object capture).
 */
export class CapturedEvent extends GameEvent {
  readonly unitName: string;
  readonly objectType: string;

  constructor(
    frameNum: number,
    type: "captured" | "capturedFlag",
    id: number,
    unitName: string,
    objectType: string,
  ) {
    super(frameNum, type, id);
    this.unitName = unitName;
    this.objectType = objectType;
  }
}
