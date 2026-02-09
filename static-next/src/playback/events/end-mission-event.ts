import { GameEvent } from "./game-event";

/**
 * Represents a mission end event (victory/defeat message with side).
 */
export class EndMissionEvent extends GameEvent {
  readonly side: string;
  readonly message: string;

  constructor(
    frameNum: number,
    id: number,
    side: string,
    message: string,
  ) {
    super(frameNum, "endMission", id);
    this.side = side;
    this.message = message;
  }
}
