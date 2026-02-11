import { GameEvent } from "./game-event";

/**
 * Represents a terminal hack event (started or canceled).
 */
export class TerminalHackEvent extends GameEvent {
  readonly unitName: string;

  constructor(
    frameNum: number,
    type: "terminalHackStarted" | "terminalHackCanceled",
    id: number,
    unitName: string,
  ) {
    super(frameNum, type, id);
    this.unitName = unitName;
  }
}
