import { GameEvent } from "./gameEvent";

/**
 * Represents a capture event (flag capture or object capture).
 */
export class CapturedEvent extends GameEvent {
  readonly unitName: string;
  readonly objectType: string;
  readonly position?: [number, number];

  constructor(
    frameNum: number,
    type: "captured" | "capturedFlag",
    id: number,
    unitName: string,
    objectType: string,
    position?: [number, number],
  ) {
    super(frameNum, type, id);
    this.unitName = unitName;
    this.objectType = objectType;
    this.position = position;
  }
}
