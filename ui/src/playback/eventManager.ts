import type { EntityManager } from "./entityManager";
import { Unit } from "./entities/unit";
import { Vehicle } from "./entities/vehicle";
import { GameEvent } from "./events/gameEvent";
import { HitKilledEvent } from "./events/hitKilledEvent";

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

  /** Return all events where frameNum <= frame (for the event log), sorted ascending by frame. */
  getActiveEvents(frame: number): GameEvent[] {
    return this.events
      .filter((event) => event.frameNum <= frame)
      .sort((a, b) => a.frameNum - b.frameNum);
  }

  /** Return all registered events. */
  getAll(): GameEvent[] {
    return this.events;
  }

  /**
   * Resolve entity references on HitKilledEvent instances.
   * Populates names, sides, and computes kill counts.
   *
   * Kill score formula (matching old frontend):
   *   killCount - (teamKillCount * 2)
   * Only "killed" events with a Unit victim (not Vehicle) increment counts.
   */
  resolveReferences(entityManager: EntityManager): void {
    // First pass: resolve names/sides
    for (const event of this.events) {
      if (event instanceof HitKilledEvent) {
        const victim = entityManager.getEntity(event.victimId);
        if (victim) {
          event.victimName = victim.name;
          event.victimIsVehicle = victim instanceof Vehicle;
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

    // Second pass: compute kill counts (events are already sorted by frame)
    for (const event of this.events) {
      if (!(event instanceof HitKilledEvent)) continue;
      if (event.type !== "killed") continue;

      const victim = entityManager.getEntity(event.victimId);
      const causer = entityManager.getEntity(event.causedById);

      // Only count kills on Unit victims (not vehicles), skip self-kills.
      // killCount tracks ALL non-self kills (including team kills).
      // teamKillCount additionally tracks same-side kills.
      // Score = killCount - teamKillCount * 2 (matching old frontend).
      if (victim instanceof Unit && causer instanceof Unit) {
        if (event.victimId !== event.causedById) {
          causer.killCount++;
          if (victim.side === causer.side) {
            causer.teamKillCount++;
          }
        }
        // Attach current score to the event (even for self-kills)
        event.causerKillScore = causer.killCount - causer.teamKillCount * 2;
      }

      // Increment death count for the victim
      if (victim instanceof Unit) {
        victim.deathCount++;
      }
    }
  }

  /**
   * Compute per-unit kill and death counts up to (and including) the given frame.
   * Only counts "killed" events on Unit victims (not vehicles), matching resolveReferences logic.
   */
  getKillDeathCounts(frame: number): {
    kills: Map<number, number>;
    deaths: Map<number, number>;
    vehicleKills: Map<number, number>;
  } {
    const kills = new Map<number, number>();
    const deaths = new Map<number, number>();
    const vehicleKills = new Map<number, number>();

    for (const event of this.events) {
      if (event.frameNum > frame) continue;
      if (!(event instanceof HitKilledEvent)) continue;
      if (event.type !== "killed") continue;

      if (event.victimIsVehicle) {
        // Vehicle kill for causer (non-self kills only)
        if (event.causedById !== event.victimId) {
          vehicleKills.set(event.causedById, (vehicleKills.get(event.causedById) ?? 0) + 1);
        }
        continue;
      }

      // Death for victim
      deaths.set(event.victimId, (deaths.get(event.victimId) ?? 0) + 1);

      // Kill for causer (non-self kills only)
      if (event.causedById !== event.victimId) {
        kills.set(event.causedById, (kills.get(event.causedById) ?? 0) + 1);
      }
    }

    return { kills, deaths, vehicleKills };
  }

  /** Remove all events and clear the frame index. */
  clear(): void {
    this.events = [];
    this.frameIndex = new Map();
  }
}
