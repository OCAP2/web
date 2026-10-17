import type { WeatherPayload } from "../../data/types";
import { GameEvent } from "./gameEvent";

/** One global weather sample embedded in the mission recording. */
export class WeatherEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: WeatherPayload,
  ) {
    super(frameNum, "weather", id);
  }
}
