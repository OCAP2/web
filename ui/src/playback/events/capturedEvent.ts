import { GameEvent } from "./gameEvent";

/**
 * Represents a capture or contested event (flag capture, object capture, or sector contested).
 */
export class CapturedEvent extends GameEvent {
  readonly unitName: string;
  readonly objectType: string;
  readonly side?: string;
  readonly position?: [number, number];

  constructor(
    frameNum: number,
    type: "captured" | "capturedFlag" | "contested",
    id: number,
    unitName: string,
    objectType: string,
    side?: string,
    position?: [number, number],
  ) {
    super(frameNum, type, id);
    this.unitName = unitName;
    this.objectType = objectType;
    this.side = side;
    this.position = position;
  }
}
