import { describe, it, expect, beforeEach } from "vitest";
import { GameEvent } from "../events/game-event";
import { HitKilledEvent } from "../events/hit-killed-event";
import { ConnectEvent } from "../events/connect-event";
import {
  getCounterStateAtFrame,
  type CounterState,
} from "../events/counter-event";
import { EventManager } from "../event-manager";
import { EntityManager } from "../entity-manager";
import type { EntityDef } from "../../data/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal EntityDef for a unit. */
function unitDef(overrides: Partial<EntityDef> = {}): EntityDef {
  return {
    id: 1,
    type: "man",
    name: "Rifleman",
    side: "WEST",
    groupName: "Alpha 1-1",
    isPlayer: true,
    startFrame: 0,
    endFrame: 100,
    role: "Rifleman",
    ...overrides,
  };
}

/** Build a minimal EntityDef for a vehicle. */
function vehicleDef(overrides: Partial<EntityDef> = {}): EntityDef {
  return {
    id: 10,
    type: "car",
    name: "HMMWV",
    side: "WEST",
    groupName: "",
    isPlayer: false,
    startFrame: 0,
    endFrame: 200,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GameEvent (base class)
// ---------------------------------------------------------------------------
describe("GameEvent", () => {
  it("stores frameNum, type, and id", () => {
    const event = new GameEvent(42, "hit", 1);
    expect(event.frameNum).toBe(42);
    expect(event.type).toBe("hit");
    expect(event.id).toBe(1);
  });

  it("preserves values after construction", () => {
    const event = new GameEvent(10, "killed", 5);
    // readonly is a compile-time TypeScript guard; verify values persist
    expect(event.frameNum).toBe(10);
    expect(event.type).toBe("killed");
    expect(event.id).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// HitKilledEvent
// ---------------------------------------------------------------------------
describe("HitKilledEvent", () => {
  it("extends GameEvent", () => {
    const event = new HitKilledEvent(100, "killed", 1, 2, 3, 150, "M4A1");
    expect(event).toBeInstanceOf(GameEvent);
    expect(event).toBeInstanceOf(HitKilledEvent);
  });

  it("stores hit/killed specific properties", () => {
    const event = new HitKilledEvent(50, "hit", 1, 10, 20, 300, "AK-74");
    expect(event.frameNum).toBe(50);
    expect(event.type).toBe("hit");
    expect(event.id).toBe(1);
    expect(event.victimId).toBe(10);
    expect(event.causedById).toBe(20);
    expect(event.distance).toBe(300);
    expect(event.weapon).toBe("AK-74");
  });

  it("starts with undefined resolved references", () => {
    const event = new HitKilledEvent(10, "killed", 1, 2, 3, 50, "RPG");
    expect(event.victimName).toBeUndefined();
    expect(event.causerName).toBeUndefined();
    expect(event.victimSide).toBeUndefined();
    expect(event.causerSide).toBeUndefined();
  });

  it("allows setting resolved references", () => {
    const event = new HitKilledEvent(10, "killed", 1, 2, 3, 50, "RPG");
    event.victimName = "Player1";
    event.causerName = "Player2";
    event.victimSide = "WEST";
    event.causerSide = "EAST";

    expect(event.victimName).toBe("Player1");
    expect(event.causerName).toBe("Player2");
    expect(event.victimSide).toBe("WEST");
    expect(event.causerSide).toBe("EAST");
  });
});

// ---------------------------------------------------------------------------
// ConnectEvent
// ---------------------------------------------------------------------------
describe("ConnectEvent", () => {
  it("extends GameEvent", () => {
    const event = new ConnectEvent(20, "connected", 1, "PlayerOne");
    expect(event).toBeInstanceOf(GameEvent);
    expect(event).toBeInstanceOf(ConnectEvent);
  });

  it("stores connect-specific properties", () => {
    const event = new ConnectEvent(30, "disconnected", 5, "SomePlayer");
    expect(event.frameNum).toBe(30);
    expect(event.type).toBe("disconnected");
    expect(event.id).toBe(5);
    expect(event.unitName).toBe("SomePlayer");
  });

  it("distinguishes connected from disconnected", () => {
    const conn = new ConnectEvent(10, "connected", 1, "Player1");
    const disc = new ConnectEvent(20, "disconnected", 2, "Player2");
    expect(conn.type).toBe("connected");
    expect(disc.type).toBe("disconnected");
  });
});

// ---------------------------------------------------------------------------
// Type discrimination
// ---------------------------------------------------------------------------
describe("Type discrimination", () => {
  it("instanceof distinguishes HitKilledEvent from ConnectEvent", () => {
    const events: GameEvent[] = [
      new HitKilledEvent(10, "killed", 1, 2, 3, 100, "M4A1"),
      new ConnectEvent(20, "connected", 2, "Player2"),
      new HitKilledEvent(30, "hit", 3, 4, 5, 50, "AK-74"),
      new ConnectEvent(40, "disconnected", 4, "Player3"),
    ];

    const hitKilled = events.filter((e) => e instanceof HitKilledEvent);
    const connects = events.filter((e) => e instanceof ConnectEvent);

    expect(hitKilled).toHaveLength(2);
    expect(connects).toHaveLength(2);
    hitKilled.forEach((e) => expect(e).toBeInstanceOf(HitKilledEvent));
    connects.forEach((e) => expect(e).toBeInstanceOf(ConnectEvent));
  });

  it("type field discriminates within HitKilledEvent", () => {
    const hit = new HitKilledEvent(10, "hit", 1, 2, 3, 100, "M4A1");
    const killed = new HitKilledEvent(20, "killed", 2, 3, 4, 200, "RPG");
    expect(hit.type).toBe("hit");
    expect(killed.type).toBe("killed");
  });
});

// ---------------------------------------------------------------------------
// CounterState
// ---------------------------------------------------------------------------
describe("CounterState / getCounterStateAtFrame", () => {
  it("returns null for empty events", () => {
    const state: CounterState = {
      active: true,
      type: "respawnTickets",
      sides: ["WEST", "EAST"],
      events: [],
    };
    expect(getCounterStateAtFrame(state, 100)).toBeNull();
  });

  it("returns null when frame is before all events", () => {
    const state: CounterState = {
      active: true,
      type: "respawnTickets",
      sides: ["WEST", "EAST"],
      events: [{ frameNum: 50, values: { WEST: 10, EAST: 10 } }],
    };
    expect(getCounterStateAtFrame(state, 49)).toBeNull();
  });

  it("returns exact match when frame equals event frameNum", () => {
    const state: CounterState = {
      active: true,
      type: "respawnTickets",
      sides: ["WEST", "EAST"],
      events: [{ frameNum: 50, values: { WEST: 10, EAST: 8 } }],
    };
    const result = getCounterStateAtFrame(state, 50);
    expect(result).toEqual({ WEST: 10, EAST: 8 });
  });

  it("returns last event before or at frame", () => {
    const state: CounterState = {
      active: true,
      type: "respawnTickets",
      sides: ["WEST", "EAST"],
      events: [
        { frameNum: 0, values: { WEST: 20, EAST: 20 } },
        { frameNum: 100, values: { WEST: 18, EAST: 17 } },
        { frameNum: 200, values: { WEST: 15, EAST: 14 } },
      ],
    };

    // Before second event
    expect(getCounterStateAtFrame(state, 50)).toEqual({
      WEST: 20,
      EAST: 20,
    });

    // Exactly at second event
    expect(getCounterStateAtFrame(state, 100)).toEqual({
      WEST: 18,
      EAST: 17,
    });

    // Between second and third
    expect(getCounterStateAtFrame(state, 150)).toEqual({
      WEST: 18,
      EAST: 17,
    });

    // At third event
    expect(getCounterStateAtFrame(state, 200)).toEqual({
      WEST: 15,
      EAST: 14,
    });

    // Past all events
    expect(getCounterStateAtFrame(state, 999)).toEqual({
      WEST: 15,
      EAST: 14,
    });
  });

  it("binary search works with many events", () => {
    const events = [];
    for (let i = 0; i < 1000; i++) {
      events.push({
        frameNum: i * 10,
        values: { WEST: 1000 - i, EAST: 1000 - i * 2 },
      });
    }
    const state: CounterState = {
      active: true,
      type: "respawnTickets",
      sides: ["WEST", "EAST"],
      events,
    };

    // Frame 5005 should pick event at frame 5000 (index 500)
    expect(getCounterStateAtFrame(state, 5005)).toEqual({
      WEST: 500,
      EAST: 0,
    });

    // First event
    expect(getCounterStateAtFrame(state, 0)).toEqual({
      WEST: 1000,
      EAST: 1000,
    });

    // Last event
    expect(getCounterStateAtFrame(state, 9990)).toEqual({
      WEST: 1,
      EAST: -998,
    });
  });

  it("returns a copy of values (not a reference)", () => {
    const state: CounterState = {
      active: true,
      type: "respawnTickets",
      sides: ["WEST"],
      events: [{ frameNum: 0, values: { WEST: 10 } }],
    };
    const result = getCounterStateAtFrame(state, 0)!;
    result.WEST = 999;

    // Original should be unchanged
    expect(state.events[0].values.WEST).toBe(10);
  });

  it("handles single event at frame 0", () => {
    const state: CounterState = {
      active: false,
      type: "custom",
      sides: ["WEST"],
      events: [{ frameNum: 0, values: { WEST: 42 } }],
    };
    expect(getCounterStateAtFrame(state, 0)).toEqual({ WEST: 42 });
    expect(getCounterStateAtFrame(state, 1000)).toEqual({ WEST: 42 });
  });
});

// ---------------------------------------------------------------------------
// EventManager
// ---------------------------------------------------------------------------
describe("EventManager", () => {
  let mgr: EventManager;

  beforeEach(() => {
    mgr = new EventManager();
  });

  describe("addEvent / getAll", () => {
    it("stores and returns events in insertion order", () => {
      const e1 = new GameEvent(10, "hit", 1);
      const e2 = new GameEvent(20, "connected", 2);
      const e3 = new GameEvent(10, "killed", 3);

      mgr.addEvent(e1);
      mgr.addEvent(e2);
      mgr.addEvent(e3);

      expect(mgr.getAll()).toEqual([e1, e2, e3]);
    });

    it("returns empty array when no events added", () => {
      expect(mgr.getAll()).toEqual([]);
    });
  });

  describe("getEventsAtFrame", () => {
    it("returns events exactly at the given frame", () => {
      const e1 = new HitKilledEvent(10, "killed", 1, 2, 3, 100, "M4A1");
      const e2 = new ConnectEvent(10, "connected", 2, "Player1");
      const e3 = new HitKilledEvent(20, "hit", 3, 4, 5, 50, "AK-74");

      mgr.addEvent(e1);
      mgr.addEvent(e2);
      mgr.addEvent(e3);

      const atFrame10 = mgr.getEventsAtFrame(10);
      expect(atFrame10).toHaveLength(2);
      expect(atFrame10).toContain(e1);
      expect(atFrame10).toContain(e2);
    });

    it("returns empty array for frames with no events", () => {
      mgr.addEvent(new GameEvent(10, "hit", 1));
      expect(mgr.getEventsAtFrame(5)).toEqual([]);
      expect(mgr.getEventsAtFrame(15)).toEqual([]);
    });

    it("performs O(1) lookup via frame index", () => {
      // Add many events at different frames
      for (let i = 0; i < 1000; i++) {
        mgr.addEvent(new GameEvent(i, "hit", i));
      }

      // Lookup should still work correctly (verifying index, not timing)
      const events = mgr.getEventsAtFrame(500);
      expect(events).toHaveLength(1);
      expect(events[0].frameNum).toBe(500);
    });
  });

  describe("getActiveEvents", () => {
    it("returns all events where frameNum <= given frame", () => {
      mgr.addEvent(new GameEvent(10, "hit", 1));
      mgr.addEvent(new GameEvent(20, "killed", 2));
      mgr.addEvent(new GameEvent(30, "connected", 3));
      mgr.addEvent(new GameEvent(40, "disconnected", 4));

      const active = mgr.getActiveEvents(25);
      expect(active).toHaveLength(2);
      expect(active.every((e) => e.frameNum <= 25)).toBe(true);
    });

    it("returns empty array when frame is before all events", () => {
      mgr.addEvent(new GameEvent(10, "hit", 1));
      mgr.addEvent(new GameEvent(20, "killed", 2));
      expect(mgr.getActiveEvents(5)).toEqual([]);
    });

    it("returns all events when frame is past all events", () => {
      mgr.addEvent(new GameEvent(10, "hit", 1));
      mgr.addEvent(new GameEvent(20, "killed", 2));
      expect(mgr.getActiveEvents(100)).toHaveLength(2);
    });

    it("includes events exactly at the given frame", () => {
      mgr.addEvent(new GameEvent(10, "hit", 1));
      mgr.addEvent(new GameEvent(20, "killed", 2));
      const active = mgr.getActiveEvents(10);
      expect(active).toHaveLength(1);
      expect(active[0].frameNum).toBe(10);
    });
  });

  describe("resolveReferences", () => {
    it("populates victim and causer names/sides for HitKilledEvent", () => {
      const entityMgr = new EntityManager();
      entityMgr.addEntity(
        unitDef({ id: 1, name: "Attacker", side: "WEST" }),
      );
      entityMgr.addEntity(
        unitDef({ id: 2, name: "Victim", side: "EAST" }),
      );

      const event = new HitKilledEvent(50, "killed", 1, 2, 1, 200, "M4A1");
      mgr.addEvent(event);

      mgr.resolveReferences(entityMgr);

      expect(event.victimName).toBe("Victim");
      expect(event.causerName).toBe("Attacker");
      expect(event.victimSide).toBe("EAST");
      expect(event.causerSide).toBe("WEST");
    });

    it("handles unknown entity IDs gracefully", () => {
      const entityMgr = new EntityManager();
      entityMgr.addEntity(
        unitDef({ id: 1, name: "Known", side: "WEST" }),
      );

      const event = new HitKilledEvent(50, "hit", 1, 999, 1, 100, "AK");
      mgr.addEvent(event);

      mgr.resolveReferences(entityMgr);

      // Causer is known
      expect(event.causerName).toBe("Known");
      expect(event.causerSide).toBe("WEST");
      // Victim is unknown
      expect(event.victimName).toBeUndefined();
      expect(event.victimSide).toBeUndefined();
    });

    it("sets name but not side for vehicle entities", () => {
      const entityMgr = new EntityManager();
      entityMgr.addEntity(
        unitDef({ id: 1, name: "Shooter", side: "WEST" }),
      );
      entityMgr.addEntity(
        vehicleDef({ id: 10, name: "HMMWV" }),
      );

      const event = new HitKilledEvent(50, "killed", 1, 10, 1, 50, "RPG");
      mgr.addEvent(event);

      mgr.resolveReferences(entityMgr);

      expect(event.victimName).toBe("HMMWV");
      expect(event.victimSide).toBeUndefined(); // vehicles have no side
      expect(event.causerName).toBe("Shooter");
      expect(event.causerSide).toBe("WEST");
    });

    it("does not affect ConnectEvent instances", () => {
      const entityMgr = new EntityManager();
      entityMgr.addEntity(unitDef({ id: 1 }));

      const event = new ConnectEvent(10, "connected", 1, "SomePlayer");
      mgr.addEvent(event);

      mgr.resolveReferences(entityMgr);

      // ConnectEvent should be unchanged
      expect(event.unitName).toBe("SomePlayer");
    });

    it("resolves multiple events at once", () => {
      const entityMgr = new EntityManager();
      entityMgr.addEntity(
        unitDef({ id: 1, name: "Alpha", side: "WEST" }),
      );
      entityMgr.addEntity(
        unitDef({ id: 2, name: "Bravo", side: "EAST" }),
      );
      entityMgr.addEntity(
        unitDef({ id: 3, name: "Charlie", side: "GUER" }),
      );

      const e1 = new HitKilledEvent(10, "killed", 1, 2, 1, 100, "M4");
      const e2 = new HitKilledEvent(20, "hit", 2, 3, 2, 50, "AK");
      mgr.addEvent(e1);
      mgr.addEvent(e2);

      mgr.resolveReferences(entityMgr);

      expect(e1.victimName).toBe("Bravo");
      expect(e1.causerName).toBe("Alpha");
      expect(e2.victimName).toBe("Charlie");
      expect(e2.causerName).toBe("Bravo");
    });
  });

  describe("getKillDeathCounts", () => {
    let entityMgr: EntityManager;

    beforeEach(() => {
      entityMgr = new EntityManager();
      entityMgr.addEntity(unitDef({ id: 1, name: "Alpha", side: "WEST" }));
      entityMgr.addEntity(unitDef({ id: 2, name: "Bravo", side: "EAST" }));
      entityMgr.addEntity(unitDef({ id: 3, name: "Charlie", side: "WEST" }));
      entityMgr.addEntity(vehicleDef({ id: 10, name: "HMMWV" }));
    });

    it("returns empty maps when no events exist", () => {
      const { kills, deaths } = mgr.getKillDeathCounts(100);
      expect(kills.size).toBe(0);
      expect(deaths.size).toBe(0);
    });

    it("counts kills and deaths up to the given frame", () => {
      // Unit 1 kills Unit 2 at frame 50
      mgr.addEvent(new HitKilledEvent(50, "killed", 1, 2, 1, 200, "M4A1"));
      mgr.resolveReferences(entityMgr);

      // Before the kill
      const before = mgr.getKillDeathCounts(49);
      expect(before.kills.get(1)).toBeUndefined();
      expect(before.deaths.get(2)).toBeUndefined();

      // At the kill frame
      const at = mgr.getKillDeathCounts(50);
      expect(at.kills.get(1)).toBe(1);
      expect(at.deaths.get(2)).toBe(1);

      // After the kill
      const after = mgr.getKillDeathCounts(100);
      expect(after.kills.get(1)).toBe(1);
      expect(after.deaths.get(2)).toBe(1);
    });

    it("accumulates multiple kills by the same unit", () => {
      mgr.addEvent(new HitKilledEvent(50, "killed", 1, 2, 1, 200, "M4A1"));
      mgr.addEvent(new HitKilledEvent(80, "killed", 2, 3, 1, 150, "M4A1"));
      mgr.resolveReferences(entityMgr);

      const midway = mgr.getKillDeathCounts(60);
      expect(midway.kills.get(1)).toBe(1);

      const end = mgr.getKillDeathCounts(100);
      expect(end.kills.get(1)).toBe(2);
      expect(end.deaths.get(2)).toBe(1);
      expect(end.deaths.get(3)).toBe(1);
    });

    it("does not count self-kills as kills but counts them as deaths", () => {
      // Unit 1 kills self at frame 30
      mgr.addEvent(new HitKilledEvent(30, "killed", 1, 1, 1, 0, "Grenade"));
      mgr.resolveReferences(entityMgr);

      const { kills, deaths } = mgr.getKillDeathCounts(100);
      expect(kills.get(1)).toBeUndefined();
      expect(deaths.get(1)).toBe(1);
    });

    it("skips vehicle victims", () => {
      // Unit 1 destroys vehicle 10 at frame 40
      mgr.addEvent(new HitKilledEvent(40, "killed", 1, 10, 1, 100, "RPG"));
      mgr.resolveReferences(entityMgr);

      const { kills, deaths } = mgr.getKillDeathCounts(100);
      expect(kills.get(1)).toBeUndefined();
      expect(deaths.get(10)).toBeUndefined();
    });

    it("ignores hit events (only counts killed)", () => {
      mgr.addEvent(new HitKilledEvent(20, "hit", 1, 2, 1, 100, "M4A1"));
      mgr.resolveReferences(entityMgr);

      const { kills, deaths } = mgr.getKillDeathCounts(100);
      expect(kills.size).toBe(0);
      expect(deaths.size).toBe(0);
    });

    it("ignores non-HitKilledEvent events", () => {
      mgr.addEvent(new ConnectEvent(10, "connected", 1, "Alpha"));
      mgr.addEvent(new GameEvent(20, "endMission", 1));

      const { kills, deaths } = mgr.getKillDeathCounts(100);
      expect(kills.size).toBe(0);
      expect(deaths.size).toBe(0);
    });

    it("works correctly when events are not sorted by frame", () => {
      // Add events out of frame order (the bug that was fixed)
      mgr.addEvent(new HitKilledEvent(80, "killed", 2, 3, 1, 150, "M4A1"));
      mgr.addEvent(new ConnectEvent(10, "connected", 1, "Alpha"));
      mgr.addEvent(new HitKilledEvent(50, "killed", 1, 2, 1, 200, "M4A1"));
      mgr.resolveReferences(entityMgr);

      // At frame 60: only the frame-50 kill should count
      const at60 = mgr.getKillDeathCounts(60);
      expect(at60.kills.get(1)).toBe(1);
      expect(at60.deaths.get(2)).toBe(1);
      expect(at60.deaths.get(3)).toBeUndefined();

      // At frame 100: both kills should count
      const at100 = mgr.getKillDeathCounts(100);
      expect(at100.kills.get(1)).toBe(2);
      expect(at100.deaths.get(2)).toBe(1);
      expect(at100.deaths.get(3)).toBe(1);
    });
  });

  describe("clear", () => {
    it("removes all events", () => {
      mgr.addEvent(new GameEvent(10, "hit", 1));
      mgr.addEvent(new HitKilledEvent(20, "killed", 2, 3, 4, 100, "M4"));
      mgr.addEvent(new ConnectEvent(30, "connected", 3, "Player"));

      mgr.clear();

      expect(mgr.getAll()).toEqual([]);
      expect(mgr.getEventsAtFrame(10)).toEqual([]);
      expect(mgr.getEventsAtFrame(20)).toEqual([]);
      expect(mgr.getEventsAtFrame(30)).toEqual([]);
      expect(mgr.getActiveEvents(100)).toEqual([]);
    });

    it("allows re-adding events after clear", () => {
      mgr.addEvent(new GameEvent(10, "hit", 1));
      mgr.clear();

      const newEvent = new GameEvent(50, "killed", 5);
      mgr.addEvent(newEvent);

      expect(mgr.getAll()).toHaveLength(1);
      expect(mgr.getEventsAtFrame(50)).toEqual([newEvent]);
      // Old frame should still be empty
      expect(mgr.getEventsAtFrame(10)).toEqual([]);
    });
  });
});
