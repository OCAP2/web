import { GameEvent } from "./gameEvent";

/**
 * Represents a general mission event (custom message from the mission).
 */
export class GeneralMissionEvent extends GameEvent {
  readonly message: string;

  constructor(
    frameNum: number,
    id: number,
    message: string,
  ) {
    super(frameNum, "generalEvent", id);
    this.message = message;
  }
}
