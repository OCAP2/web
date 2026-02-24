/**
 * Base event type for all mission events.
 * Pure data -- NO DOM, NO Leaflet, NO map dependencies.
 */
export class GameEvent {
  constructor(
    public readonly frameNum: number,
    public readonly type: string,
    public readonly id: number,
  ) {}
}
