import type { EntityManager } from "./entity-manager";
import { Unit } from "./entities/unit";
import { GameEvent } from "./events/game-event";
import { HitKilledEvent } from "./events/hit-killed-event";

/**
 * Manages all mission events for a playback session.
 * Indexes events by frame number for O(1) lookup.
 * Pure data -- NO DOM, NO Leaflet, NO map dependencies.
 */
export class EventManager {
  private events: GameEvent[] = [];
  private frameIndex: Map<number, GameEvent[]> = new Map();

  /** Add an event and index it by frame number. */
  addEvent(event: GameEvent): void {
    this.events.push(event);

    const existing = this.frameIndex.get(event.frameNum);
    if (existing) {
      existing.push(event);
    } else {
      this.frameIndex.set(event.frameNum, [event]);
    }
  }

  /** Return events that occur exactly at the given frame. O(1) lookup. */
  getEventsAtFrame(frame: number): GameEvent[] {
    return this.frameIndex.get(frame) ?? [];
  }

  /** Return all events where frameNum <= frame (for the event log). */
  getActiveEvents(frame: number): GameEvent[] {
    return this.events.filter((event) => event.frameNum <= frame);
  }

  /** Return all registered events. */
  getAll(): GameEvent[] {
    return this.events;
  }

  /**
   * Resolve entity references on HitKilledEvent instances.
   * Populates victimName, causerName, victimSide, and causerSide
   * from the EntityManager.
   */
  resolveReferences(entityManager: EntityManager): void {
    for (const event of this.events) {
      if (event instanceof HitKilledEvent) {
        const victim = entityManager.getEntity(event.victimId);
        if (victim) {
          event.victimName = victim.name;
          if (victim instanceof Unit) {
            event.victimSide = victim.side;
          }
        }

        const causer = entityManager.getEntity(event.causedById);
        if (causer) {
          event.causerName = causer.name;
          if (causer instanceof Unit) {
            event.causerSide = causer.side;
          }
        }
      }
    }
  }

  /** Remove all events and clear the frame index. */
  clear(): void {
    this.events = [];
    this.frameIndex = new Map();
  }
}
