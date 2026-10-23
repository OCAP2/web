import { GameEvent } from "./gameEvent";

/**
 * A chat message, typed by a player or sent by a script in a player's name
 * (an engine start-up mod writing "Engine starting..." to the vehicle channel).
 */
export class ChatEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    readonly channel: string,
    readonly fromName: string,
    readonly message: string,
  ) {
    super(frameNum, "chat", id);
  }
}
