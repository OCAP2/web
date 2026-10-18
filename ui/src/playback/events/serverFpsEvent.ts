import { GameEvent } from "./gameEvent";

/** One server FPS sample embedded in the mission recording. */
export class ServerFpsEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly fps: number,
  ) {
    super(frameNum, "serverFps", id);
  }
}
