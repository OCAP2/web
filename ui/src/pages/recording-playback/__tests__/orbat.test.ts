import { describe, it, expect } from "vitest";

import { buildOrbat, buildVehicleOccupancy, isLeader } from "../orbat";
import { buildMovementStats, formatDistance } from "../movement";
import { Unit } from "../../../playback/entities/unit";
import { Vehicle } from "../../../playback/entities/vehicle";
import type { PlaybackEngine } from "../../../playback/engine";
import type { EntityState, Side } from "../../../data/types";

function state(over: Partial<EntityState> = {}): EntityState {
  return {
    position: [0, 0, 0],
    direction: 0,
    alive: 1,
    ...over,
  } as EntityState;
}

/**
 * Dense JSON state for focused calculation tests. The real bounded chunk cache
 * is covered separately by wholeMissionAnalysis.test.ts.
 */
function fakeEngine(entities: Array<Unit | Vehicle>, endFrame: number, captureDelayMs = 1000) {
  const byId = new Map<number, Unit | Vehicle>(entities.map((e) => [e.id, e]));
  const manager = {
    getAll: () => entities,
    getEntity: (id: number) => byId.get(id) ?? null,
  };

  return {
    entityManager: manager,
    endFrame: () => endFrame,
    captureDelayMs: () => captureDelayMs,
    async visitAllFrames(this: PlaybackEngine, visit: Parameters<PlaybackEngine["visitAllFrames"]>[0]) {
      visit(0, endFrame, (id, frame) => this.getStateAt(id, frame));
    },
    getStateAt(entityId: number, frame: number): EntityState | null {
      const entity = manager.getEntity(entityId);
      if (!entity) return null;
      if (frame < entity.startFrame || frame > entity.endFrame) return null;
      return entity.positions?.[frame - entity.startFrame] ?? null;
    },
  } as unknown as PlaybackEngine;
}

function unit(
  id: number,
  name: string,
  side: Side,
  groupName: string,
  states: EntityState[],
  opts: { role?: string; isPlayer?: boolean } = {},
): Unit {
  return new Unit(
    id, name, "man", 0, states.length - 1, side,
    opts.isPlayer ?? true, groupName, opts.role ?? "", states,
  );
}

describe("isLeader", () => {
  it("recognises the roles the recorder writes for a leader", () => {
    expect(isLeader("Leader")).toBe(true);
    expect(isLeader("Squad Leader")).toBe(true);
    expect(isLeader("team_leader")).toBe(true);
    expect(isLeader("Rifleman")).toBe(false);
    expect(isLeader("")).toBe(false);
  });
});

describe("buildOrbat", () => {
  it("groups by the group at that frame, not the one the unit started in", () => {
    // A survivor folded into Bravo halfway through must appear under Bravo.
    const survivor = unit(1, "Survivor", "WEST", "Alpha", [
      state({ groupName: "Alpha" }),
      state({ groupName: "Bravo" }),
    ]);
    const bravo = unit(2, "Local", "WEST", "Bravo", [
      state({ groupName: "Bravo" }),
      state({ groupName: "Bravo" }),
    ]);
    const engine = fakeEngine([survivor, bravo], 1);

    const atStart = buildOrbat(engine, "WEST", 0);
    expect(atStart.map((g) => g.name)).toEqual(["Alpha", "Bravo"]);

    const later = buildOrbat(engine, "WEST", 1);
    expect(later.map((g) => g.name)).toEqual(["Bravo"]);
    expect(later[0].members.map((m) => m.unitId).sort()).toEqual([1, 2]);
  });

  it("flags a unit that changed group", () => {
    const survivor = unit(1, "Survivor", "WEST", "Alpha", [
      state({ groupName: "Alpha" }),
      state({ groupName: "Bravo" }),
    ]);
    const engine = fakeEngine([survivor], 1);

    expect(buildOrbat(engine, "WEST", 0)[0].members[0].regrouped).toBe(false);
    expect(buildOrbat(engine, "WEST", 1)[0].members[0].regrouped).toBe(true);
  });

  it("sorts leaders first, then players, then by name", () => {
    const states = [state({ groupName: "Alpha" })];
    const engine = fakeEngine(
      [
        unit(1, "Mike", "WEST", "Alpha", states, { role: "Rifleman" }),
        unit(2, "Alpha AI", "WEST", "Alpha", states, { role: "Rifleman", isPlayer: false }),
        unit(3, "Zulu", "WEST", "Alpha", states, { role: "Squad Leader" }),
      ],
      0,
    );

    // playersOnly is off here so the player/AI tiebreaker is actually exercised;
    // the default roster would drop the AI before the sort ever saw it.
    const members = buildOrbat(engine, "WEST", 0, { playersOnly: false })[0].members;
    expect(members.map((m) => m.name)).toEqual(["Zulu", "Mike", "Alpha AI"]);
  });

  it("uses per-frame roles for promotions and demotions ahead of recorded roles", () => {
    const promoted = unit(1, "Aaron", "WEST", "Alpha", [
      state({ role: "Rifleman" }), state({ role: "Squad Leader" }),
    ], { role: "Rifleman" });
    const demoted = unit(2, "Zulu", "WEST", "Alpha", [
      state(), state({ role: "Rifleman" }),
    ], { role: "Squad Leader" });
    const engine = fakeEngine([promoted, demoted], 1);
    expect(buildOrbat(engine, "WEST", 0)[0].members.map((member) => [member.name, member.role]))
      .toEqual([["Zulu", "Squad Leader"], ["Aaron", "Rifleman"]]);
    expect(buildOrbat(engine, "WEST", 1)[0].members.map((member) => [member.name, member.role]))
      .toEqual([["Aaron", "Squad Leader"], ["Zulu", "Rifleman"]]);
  });

  // ── Players only ──
  //
  // An ORBAT is read to find out who was where and under whom. On a populated
  // mission the AI outnumbers the players enough to bury that, so the roster is
  // the players by default.

  it("lists only players by default", () => {
    const states = [state({ groupName: "Alpha" })];
    const engine = fakeEngine(
      [
        unit(1, "Player", "WEST", "Alpha", states),
        unit(2, "Alpha AI", "WEST", "Alpha", states, { isPlayer: false }),
      ],
      0,
    );

    expect(buildOrbat(engine, "WEST", 0)[0].members.map((m) => m.name)).toEqual(["Player"]);
  });

  it("drops a group that is all AI rather than showing it empty", () => {
    const states = [state({ groupName: "Alpha" })];
    const engine = fakeEngine(
      [
        unit(1, "Player", "WEST", "Alpha", states),
        unit(2, "Filler One", "WEST", "Bravo", states, { isPlayer: false }),
        unit(3, "Filler Two", "WEST", "Bravo", states, { isPlayer: false }),
      ],
      0,
    );

    expect(buildOrbat(engine, "WEST", 0).map((g) => g.name)).toEqual(["Alpha"]);
  });

  it("counts only players as alive, so the roster and the count agree", () => {
    const states = [state({ groupName: "Alpha" })];
    const dead = [state({ groupName: "Alpha", alive: 0 })];
    const engine = fakeEngine(
      [
        unit(1, "Player", "WEST", "Alpha", states),
        unit(2, "Dead AI", "WEST", "Alpha", dead, { isPlayer: false }),
        unit(3, "Live AI", "WEST", "Alpha", states, { isPlayer: false }),
      ],
      0,
    );

    const group = buildOrbat(engine, "WEST", 0)[0];
    expect(group.members).toHaveLength(1);
    expect(group.alive).toBe(1);
  });

  it("keeps a player whose per-frame flag drops when they die or disconnect", () => {
    // The recorder keeps writing the body as an AI-flagged unit, and a squad
    // that empties out over the mission is exactly what the ORBAT must not do.
    const casualty = unit(1, "Player", "WEST", "Alpha", [
      state({ groupName: "Alpha", isPlayer: true }),
      state({ groupName: "Alpha", isPlayer: false, alive: 0 }),
    ]);
    const engine = fakeEngine([casualty], 1);

    const group = buildOrbat(engine, "WEST", 1)[0];
    expect(group.members.map((m) => m.name)).toEqual(["Player"]);
    expect(group.alive).toBe(0);
  });

  it("lists a player once when a respawn left two live entities", () => {
    const abandoned = unit(1, "Player", "WEST", "Alpha", [
      state({ groupName: "Alpha" }),
      state({ groupName: "Alpha" }),
      state({ groupName: "Alpha" }),
    ]);
    const respawned = unit(2, "Player", "WEST", "Alpha", [
      state({ groupName: "Alpha" }),
      state({ groupName: "Alpha" }),
    ]);
    const engine = fakeEngine([abandoned, respawned], 2);

    const group = buildOrbat(engine, "WEST", 1)[0];
    expect(group.members).toHaveLength(1);
    // Without per-frame control flags or a later start, lifespan breaks the tie.
    expect(group.members[0].unitId).toBe(1);
  });

  it.each([false, true])("prefers the current player over their longer-recorded corpse (reversed: %s)", (reversed) => {
    const corpse = unit(1, "Player", "WEST", "Alpha", Array.from({ length: 101 }, (_, frame) =>
      state({ isPlayer: frame < 50, alive: frame < 50 ? 1 : 0 })));
    const replacement = new Unit(2, "Player", "man", 50, 100, "WEST", true, "Alpha", "",
      Array.from({ length: 51 }, () => state({ isPlayer: true })));
    const entities = [corpse, replacement];
    const engine = fakeEngine(reversed ? entities.reverse() : entities, 100);

    expect(buildOrbat(engine, "WEST", 40)[0].members[0].unitId).toBe(1);
    const group = buildOrbat(engine, "WEST", 60)[0];
    expect(group.members).toHaveLength(1);
    expect(group.members[0]).toMatchObject({ unitId: 2, isPlayer: true, alive: true });
    expect(group.alive).toBe(1);
  });

  it("prefers a controlled replacement over an abandoned living body", () => {
    const abandoned = unit(1, "Player", "WEST", "Alpha", [state({ isPlayer: false }), state({ isPlayer: false })]);
    const controlled = unit(2, "Player", "WEST", "Alpha", [state({ isPlayer: true })]);
    const group = buildOrbat(fakeEngine([abandoned, controlled], 1), "WEST", 0)[0];
    expect(group.members[0].unitId).toBe(2);
  });

  it("prefers the living, later-started respawn when legacy states omit control flags", () => {
    const corpse = unit(1, "Player", "WEST", "Alpha", Array.from({ length: 101 }, () => state({ alive: 0 })));
    const replacement = new Unit(2, "Player", "man", 50, 100, "WEST", true, "Alpha", "",
      Array.from({ length: 51 }, () => state()));
    const group = buildOrbat(fakeEngine([corpse, replacement], 100), "WEST", 60)[0];
    expect(group.members[0].unitId).toBe(2);
    expect(group.alive).toBe(1);
  });

  it("uses the most recently spawned entity when legacy bodies both remain alive", () => {
    const abandoned = unit(1, "Player", "WEST", "Alpha", Array.from({ length: 101 }, () => state()));
    const replacement = new Unit(2, "Player", "man", 50, 100, "WEST", true, "Alpha", "",
      Array.from({ length: 51 }, () => state()));
    const group = buildOrbat(fakeEngine([abandoned, replacement], 100), "WEST", 60)[0];
    expect(group.members[0].unitId).toBe(2);
  });

  it("comes back empty for a side that has only AI", () => {
    const states = [state({ groupName: "Alpha" })];
    const engine = fakeEngine(
      [
        unit(1, "Player", "WEST", "Alpha", states),
        unit(2, "AI One", "EAST", "Bravo", states, { isPlayer: false }),
        unit(3, "AI Two", "EAST", "Bravo", states, { isPlayer: false }),
      ],
      0,
    );

    expect(buildOrbat(engine, "EAST", 0)).toEqual([]);
  });

  it("keeps the full roster when playersOnly is off", () => {
    const states = [state({ groupName: "Alpha" })];
    const engine = fakeEngine(
      [
        unit(1, "Player", "WEST", "Alpha", states),
        unit(2, "Alpha AI", "WEST", "Alpha", states, { isPlayer: false }),
      ],
      0,
    );

    expect(buildOrbat(engine, "WEST", 0, { playersOnly: false })[0].members).toHaveLength(2);
  });

  it("keeps someone who is a player at this frame but not at the start", () => {
    // Taking over an AI slot mid-mission makes them a player from that point,
    // and the per-frame flag is what has to decide it.
    const takenOver = unit(1, "Slot", "WEST", "Alpha", [
      state({ groupName: "Alpha", isPlayer: false }),
      state({ groupName: "Alpha", isPlayer: true }),
    ], { isPlayer: false });
    const engine = fakeEngine([takenOver], 1);

    expect(buildOrbat(engine, "WEST", 0)).toEqual([]);
    expect(buildOrbat(engine, "WEST", 1)[0].members[0].name).toBe("Slot");
  });

  it("counts the living separately from the roster", () => {
    const states = [state({ groupName: "Alpha" })];
    const dead = [state({ groupName: "Alpha", alive: 0 })];
    const engine = fakeEngine(
      [unit(1, "Alive", "WEST", "Alpha", states), unit(2, "Dead", "WEST", "Alpha", dead)],
      0,
    );

    const group = buildOrbat(engine, "WEST", 0)[0];
    expect(group.members).toHaveLength(2);
    expect(group.alive).toBe(1);
  });

  it("uses the per-frame side, so a side switch moves the unit", () => {
    const defector = unit(1, "Defector", "WEST", "Alpha", [
      state({ groupName: "Alpha", side: "WEST" }),
      state({ groupName: "Alpha", side: "EAST" }),
    ]);
    const engine = fakeEngine([defector], 1);

    expect(buildOrbat(engine, "WEST", 1)).toEqual([]);
    expect(buildOrbat(engine, "EAST", 1)[0].members[0].name).toBe("Defector");
  });
});

describe("buildVehicleOccupancy", () => {
  it("drops vehicles nobody ever boarded", async () => {
    const parked = new Vehicle(9, "Parked", "car", 0, 3, "car", [
      state({ crewIds: [] }),
      state({ crewIds: [] }),
      state({ crewIds: [] }),
      state({ crewIds: [] }),
    ]);
    expect(await buildVehicleOccupancy(fakeEngine([parked], 3, 1000), 0, 4)).toEqual([]);
  });

  it("records crew over time and the peak that sizes the strip", async () => {
    const truck = new Vehicle(9, "Truck", "truck", 0, 3, "truck", [
      state({ crewIds: [] }),
      state({ crewIds: [1, 2] }),
      state({ crewIds: [1, 2, 3] }),
      state({ crewIds: [] }),
    ]);
    const [occupancy] = await buildVehicleOccupancy(fakeEngine([truck], 3, 1000), 0, 4);

    expect(occupancy.name).toBe("Truck");
    expect(occupancy.peak).toBe(3);
    expect(occupancy.samples.map((s) => s.crewIds.length)).toEqual([0, 2, 3, 0]);
  });

  it("keeps only what a player of that side crewed when asked", async () => {
    const truck = new Vehicle(9, "Player Truck", "truck", 0, 1, "truck", [
      state({ crewIds: [1] }),
      state({ crewIds: [1] }),
    ]);
    const aiTruck = new Vehicle(10, "AI Truck", "truck", 0, 1, "truck", [
      state({ crewIds: [2] }),
      state({ crewIds: [2] }),
    ]);
    const enemyTruck = new Vehicle(11, "Enemy Truck", "truck", 0, 1, "truck", [
      state({ crewIds: [3] }),
      state({ crewIds: [3] }),
    ]);
    const driver = unit(1, "Driver", "WEST", "Alpha", [state(), state()]);
    const ai = unit(2, "AI", "WEST", "Alpha", [state(), state()], { isPlayer: false });
    const enemy = unit(3, "Enemy", "EAST", "Bravo", [state(), state()]);
    const engine = fakeEngine([truck, aiTruck, enemyTruck, driver, ai, enemy], 1);

    const names = (await buildVehicleOccupancy(engine, 0, 2, {
      side: "WEST",
      playersOnly: true,
    })).map((v) => v.name);
    expect(names).toEqual(["Player Truck"]);
  });

  it("reports whether it is occupied at the playhead", async () => {
    const truck = new Vehicle(9, "Truck", "truck", 0, 3, "truck", [
      state({ crewIds: [] }),
      state({ crewIds: [1] }),
      state({ crewIds: [1] }),
      state({ crewIds: [] }),
    ]);
    const engine = fakeEngine([truck], 3, 1000);

    expect((await buildVehicleOccupancy(engine, 1, 4))[0].occupiedNow).toBe(true);
    expect((await buildVehicleOccupancy(engine, 3, 4))[0].occupiedNow).toBe(false);
  });
});

describe("buildMovementStats", () => {
  it("splits distance between on foot and mounted", async () => {
    const walker = unit(1, "Walker", "WEST", "Alpha", [
      state({ position: [0, 0, 0] }),
      state({ position: [100, 0, 0] }),
      state({ position: [200, 0, 0], isInVehicle: true }),
    ]);
    const [stats] = await buildMovementStats(fakeEngine([walker], 2, 1000), { step: 1 });

    expect(Math.round(stats.onFoot)).toBe(100);
    expect(Math.round(stats.mounted)).toBe(100);
    expect(Math.round(stats.total)).toBe(200);
    expect(stats.mountedFrames).toBe(1);
  });

  it("ignores a teleport, which is Zeus or a respawn rather than travel", async () => {
    const teleported = unit(1, "Zeus bait", "WEST", "Alpha", [
      state({ position: [0, 0, 0] }),
      state({ position: [5000, 0, 0] }),
      state({ position: [5050, 0, 0] }),
    ]);
    const [stats] = await buildMovementStats(fakeEngine([teleported], 2, 1000), { step: 1 });

    expect(Math.round(stats.total)).toBe(50);
  });

  it("breaks the chain over a gap instead of bridging it", async () => {
    // Frame 1 is missing, which is what an unloaded chunk looks like; bridging
    // it would invent the whole distance across the gap.
    const gapped = unit(1, "Gapped", "WEST", "Alpha", [
      state({ position: [0, 0, 0] }),
      null as unknown as EntityState,
      state({ position: [300, 0, 0] }),
      state({ position: [310, 0, 0] }),
    ]);
    const [stats] = await buildMovementStats(fakeEngine([gapped], 3, 1000), { step: 1 });

    expect(Math.round(stats.total)).toBe(10);
  });

  it("skips units that never moved", async () => {
    const still = unit(1, "Statue", "WEST", "Alpha", [
      state({ position: [0, 0, 0] }),
      state({ position: [0, 0, 0] }),
    ]);
    expect(await buildMovementStats(fakeEngine([still], 1, 1000), { step: 1 })).toEqual([]);
  });

  it("ranks by total distance, furthest first", async () => {
    const near = unit(1, "Near", "WEST", "Alpha", [
      state({ position: [0, 0, 0] }),
      state({ position: [50, 0, 0] }),
    ]);
    const far = unit(2, "Far", "WEST", "Alpha", [
      state({ position: [0, 0, 0] }),
      state({ position: [300, 0, 0] }),
    ]);
    const ranked = await buildMovementStats(fakeEngine([near, far], 1, 1000), { step: 1 });

    expect(ranked.map((s) => s.name)).toEqual(["Far", "Near"]);
  });

  it("leaves AI out unless asked for", async () => {
    const ai = unit(1, "AI", "WEST", "Alpha", [
      state({ position: [0, 0, 0] }),
      state({ position: [200, 0, 0] }),
    ], { isPlayer: false });
    const engine = fakeEngine([ai], 1, 1000);

    expect(await buildMovementStats(engine, { step: 1 })).toEqual([]);
    expect(await buildMovementStats(engine, { step: 1, playersOnly: false })).toHaveLength(1);
  });
});

describe("formatDistance", () => {
  it("switches to kilometres past a thousand metres", () => {
    expect(formatDistance(840)).toBe("840 m");
    expect(formatDistance(1240)).toBe("1.2 km");
    expect(formatDistance(Number.NaN)).toBe("-");
  });
});
