import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventManager } from "../eventManager";
import { EntityManager } from "../entityManager";
import { PlaybackEngine } from "../engine";
import { HitKilledEvent } from "../events/hitKilledEvent";
import {
  ZeusCameraEvent,
  ZeusEntityEvent,
  ZeusModuleEvent,
  ZeusPingEvent,
  ZeusRemoteControlEvent,
} from "../events/zeusEvents";
import { Unit } from "../entities/unit";
import {
  ZEUS_MODULE_MAP_SECONDS,
  ZEUS_PING_MAP_SECONDS,
  armaFovToDegrees,
  formatUnitTypeLabel,
  formatZeusOccupancyName,
  groupZeusModules,
  groupZeusPings,
  zeusModuleAlpha,
  zeusModuleFadeFrames,
  zeusModuleLifetimeFrames,
  zeusPingAlpha,
  zeusPingLifetimeFrames,
} from "../zeus";
import { MockRenderer } from "../../renderers/mockRenderer";
import type { EntityDef, Manifest } from "../../data/types";

function unitDef(overrides: Partial<EntityDef> = {}): EntityDef {
  return {
    id: 1,
    type: "man",
    name: "Rifleman",
    side: "WEST",
    groupName: "Alpha",
    isPlayer: false,
    startFrame: 0,
    endFrame: 200,
    ...overrides,
  };
}

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    worldName: "Altis",
    missionName: "Zeus",
    endFrame: 200,
    chunkSize: 300,
    captureDelayMs: 1000,
    chunkCount: 1,
    entities: [],
    events: [],
    markers: [],
    times: [],
    ...overrides,
  };
}

describe("formatUnitTypeLabel", () => {
  it("maps recorded getUnitType codes to infantry labels", () => {
    expect(formatUnitTypeLabel("Man")).toBe("Rifleman");
    expect(formatUnitTypeLabel("MG")).toBe("Autorifleman");
    expect(formatUnitTypeLabel("Sniper")).toBe("Marksman");
    expect(formatUnitTypeLabel("ExplosiveSpecialist")).toBe("Explosive Specialist");
  });

  it("strips mission slot suffixes and passes unknown roles through", () => {
    expect(formatUnitTypeLabel("SL@Vova")).toBe("SL");
    expect(formatUnitTypeLabel("Spotter")).toBe("Spotter");
    expect(formatUnitTypeLabel("")).toBe("");
    expect(formatUnitTypeLabel(undefined)).toBe("");
  });
});

describe("formatZeusOccupancyName", () => {
  it("appends unit type when the recording has one", () => {
    expect(formatZeusOccupancyName("Danny", "Bakunin", "Man")).toBe(
      "Danny controlling Bakunin (Rifleman)",
    );
  });

  it("omits parentheses when no unit type was recorded", () => {
    expect(formatZeusOccupancyName("Danny", "Bakunin", "")).toBe(
      "Danny controlling Bakunin",
    );
  });
});

describe("armaFovToDegrees", () => {
  it("converts the default Arma FOV of 0.75 to about 74 degrees", () => {
    expect(armaFovToDegrees(0.75)).toBeCloseTo(73.74, 1);
  });

  it("falls back when the value is unusable", () => {
    expect(armaFovToDegrees(0)).toBe(75);
    expect(armaFovToDegrees(Number.NaN)).toBe(75);
  });
});

describe("EventManager Zeus occupancy", () => {
  let mgr: EventManager;

  beforeEach(() => {
    mgr = new EventManager();
    mgr.addEvent(new ZeusEntityEvent(2, 1, {
      curatorId: 90,
      name: "Danny",
      playerUid: "7656",
      bodyUnitId: -1,
    }));
    mgr.addEvent(new ZeusRemoteControlEvent(10, 2, {
      curatorId: 90,
      unitId: 7,
      active: true,
      playerName: "Danny",
    }));
    mgr.addEvent(new ZeusRemoteControlEvent(40, 3, {
      curatorId: 90,
      unitId: 7,
      active: false,
    }));
    mgr.addEvent(new ZeusCameraEvent(5, 4, {
      curatorId: 90,
      x: 1000,
      y: 2000,
      dir: 90,
      fov: 0.75,
      pitch: 0.1,
    }));
  });

  it("lists discovered Zeus identities", () => {
    expect(mgr.getZeusEntities()).toEqual([
      expect.objectContaining({ curatorId: 90, name: "Danny", startFrame: 2 }),
    ]);
  });

  it("is hidden before the first entity event", () => {
    expect(mgr.getZeusState(90, 1)).toBeNull();
  });

  it("returns the camera while flying and not possessing", () => {
    const state = mgr.getZeusState(90, 8);
    expect(state?.camera).toEqual({ x: 1000, y: 2000, dir: 90, fov: 0.75, pitch: 0.1 });
    expect(state?.controllingUnitId).toBeNull();
  });

  it("tracks remote-control occupancy by frame", () => {
    expect(mgr.getZeusState(90, 10)?.controllingUnitId).toBe(7);
    expect(mgr.getZeusControllingUnit(7, 10)).toBe(90);
    expect(mgr.getZeusState(90, 40)?.controllingUnitId).toBeNull();
    expect(mgr.getZeusControllingUnit(7, 40)).toBeNull();
  });

  it("attributes possessed-unit kills to the Zeus entity", () => {
    const entities = new EntityManager();
    entities.addEntity(unitDef({ id: 7, name: "AI", side: "EAST" }));
    entities.addEntity(unitDef({ id: 8, name: "Victim", side: "WEST" }));
    entities.addEntity(unitDef({
      id: 90,
      type: "zeus",
      name: "Danny",
      side: "VIRTUAL",
      groupName: "Zeus",
      role: "Zeus",
    }));

    mgr.addEvent(new HitKilledEvent(20, "killed", 1, 8, 7, 40, "AK"));
    mgr.resolveReferences(entities);

    const zeus = entities.getEntity(90) as Unit;
    expect(zeus.killCount).toBe(1);
    expect(mgr.getKillDeathCounts(20).kills.get(90)).toBe(1);
    expect(mgr.getKillDeathCounts(9).kills.get(90)).toBeUndefined();
  });

  it("attributes a possessed-unit kill shortly after remote-control stop", () => {
    const entities = new EntityManager();
    entities.addEntity(unitDef({ id: 5, name: "Marek", side: "WEST" }));
    entities.addEntity(unitDef({ id: 6, name: "Tung", side: "EAST" }));
    entities.addEntity(unitDef({
      id: 90,
      type: "zeus",
      name: "YetheSamartaka",
      side: "VIRTUAL",
      groupName: "Zeus",
      role: "Zeus",
      isPlayer: true,
    }));

    mgr.addEvent(new ZeusRemoteControlEvent(123, 5, {
      curatorId: 90,
      unitId: 5,
      active: true,
      playerName: "YetheSamartaka",
    }));
    mgr.addEvent(new ZeusRemoteControlEvent(149, 6, {
      curatorId: 90,
      unitId: 5,
      active: false,
    }));
    mgr.addEvent(new HitKilledEvent(166, "killed", 1, 6, 5, 43, "CZ BREN 2"));
    mgr.resolveReferences(entities);

    expect((entities.getEntity(90) as Unit).killCount).toBe(1);
    expect(mgr.getKillDeathCounts(166).kills.get(90)).toBe(1);
    expect(mgr.getZeusControllingUnit(5, 166)).toBeNull();
    expect(mgr.getKillDeathCounts(200).kills.get(90)).toBe(1);

    mgr.addEvent(new HitKilledEvent(200, "killed", 2, 6, 5, 10, "CZ BREN 2"));
    expect(mgr.getKillDeathCounts(200).kills.get(90)).toBe(1);
    expect(mgr.getKillDeathCounts(200).kills.get(5)).toBe(2);
  });
});

describe("EventManager Zeus body kill attribution", () => {
  it("attributes the Zeus player's body kills to the VIRTUAL curator", () => {
    const mgr = new EventManager();
    const entities = new EntityManager();
    entities.addEntity(unitDef({
      id: 0,
      name: "YetheSamartaka",
      side: "CIV",
      isPlayer: true,
    }));
    entities.addEntity(unitDef({ id: 2, name: "Horacek", side: "WEST" }));
    entities.addEntity(unitDef({ id: 3, name: "Hall", side: "WEST" }));
    entities.addEntity(unitDef({
      id: 1,
      type: "zeus",
      name: "YetheSamartaka",
      side: "VIRTUAL",
      groupName: "Zeus",
      role: "Zeus",
      isPlayer: true,
    }));

    mgr.addEvent(new ZeusEntityEvent(1, 1, {
      curatorId: 1,
      name: "YetheSamartaka",
      playerUid: "7656",
      bodyUnitId: 0,
    }));
    mgr.addEvent(new HitKilledEvent(91, "killed", 1, 2, 0, 2, "L85A2"));
    mgr.addEvent(new HitKilledEvent(120, "killed", 2, 3, 0, 26, "L85A2"));
    mgr.resolveReferences(entities);

    const zeus = entities.getEntity(1) as Unit;
    const body = entities.getEntity(0) as Unit;
    expect(zeus.killCount).toBe(2);
    expect(body.killCount).toBe(2);
    expect(mgr.getKillDeathCounts(91).kills.get(1)).toBe(1);
    expect(mgr.getKillDeathCounts(120).kills.get(1)).toBe(2);
    expect(mgr.getKillDeathCounts(90).kills.get(1)).toBeUndefined();
  });

  it("does not double-count when curatorId and bodyUnitId are the same", () => {
    const mgr = new EventManager();
    const entities = new EntityManager();
    entities.addEntity(unitDef({
      id: 0,
      type: "zeus",
      name: "Danny",
      side: "VIRTUAL",
      isPlayer: true,
    }));
    entities.addEntity(unitDef({ id: 2, name: "Victim", side: "EAST" }));

    mgr.addEvent(new ZeusEntityEvent(1, 1, {
      curatorId: 0,
      name: "Danny",
      playerUid: "7656",
      bodyUnitId: 0,
    }));
    mgr.addEvent(new HitKilledEvent(10, "killed", 1, 2, 0, 5, "L85A2"));
    mgr.resolveReferences(entities);

    expect((entities.getEntity(0) as Unit).killCount).toBe(1);
    expect(mgr.getKillDeathCounts(10).kills.get(0)).toBe(1);
  });
});

describe("PlaybackEngine Zeus synthesis", () => {
  let engine: PlaybackEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new PlaybackEngine(new MockRenderer());
  });

  it("creates a VIRTUAL Zeus unit and follows camera then the possessed unit", () => {
    engine.loadRecording(makeManifest({
      entities: [
        unitDef({
          id: 7,
          name: "Bakunin",
          side: "EAST",
          role: "Man",
          positions: [
            { position: [0, 0], direction: 0, alive: 1, role: "Man" },
            { position: [10, 20], direction: 45, alive: 1, role: "MG" },
          ],
        }),
      ],
      events: [
        {
          frameNum: 0,
          type: "zeusEntity",
          payload: { curatorId: 90, name: "Danny", playerUid: "7656", bodyUnitId: -1 },
        },
        {
          frameNum: 0,
          type: "zeusCamera",
          payload: { curatorId: 90, x: 500, y: 600, dir: 180, fov: 0.75, pitch: 0 },
        },
        {
          frameNum: 1,
          type: "zeusRemoteControl",
          payload: { curatorId: 90, unitId: 7, active: true, playerName: "Danny" },
        },
      ],
    }));

    const zeus = engine.entityManager.getEntity(90);
    expect(zeus).toBeInstanceOf(Unit);
    expect((zeus as Unit).side).toBe("VIRTUAL");
    expect(engine.entityManager.getBySide("VIRTUAL")).toHaveLength(1);

    engine.seekTo(0);
    const flying = engine.entitySnapshots().get(90);
    expect(flying?.position).toEqual([500, 600]);
    expect(flying?.iconType).toBe("zeus");
    expect(flying?.fov).toBe(0.75);
    expect(flying?.side).toBe("VIRTUAL");

    engine.seekTo(1);
    const possessing = engine.entitySnapshots().get(90);
    expect(possessing?.position).toEqual([10, 20]);
    expect(possessing?.side).toBe("EAST");
    expect(possessing?.controllingUnitId).toBe(7);
    expect(possessing?.name).toBe("Danny controlling Bakunin (Autorifleman)");
    expect(possessing?.fov).toBeUndefined();
  });

  it.each([0, 1])("synthesizes VIRTUAL Zeus starting at frame %s when curatorId 0 is an empty entity hole", (startFrame) => {
    engine.loadRecording(makeManifest({
      entities: [
        unitDef({
          id: 0,
          name: "",
          type: "unknown",
          side: "CIV",
        }),
        unitDef({
          id: 1,
          name: "Horacek",
          side: "WEST",
        }),
      ],
      events: [
        {
          frameNum: startFrame,
          type: "zeusEntity",
          payload: { curatorId: 0, name: "YetheSamartaka", playerUid: "7656", bodyUnitId: -1 },
        },
        {
          frameNum: startFrame,
          type: "zeusCamera",
          payload: { curatorId: 0, x: 8504, y: -902, dir: 0, fov: 1 },
        },
      ],
    }));

    const zeus = engine.entityManager.getEntity(0);
    expect(zeus).toBeInstanceOf(Unit);
    expect(zeus?.type).toBe("zeus");
    expect((zeus as Unit).side).toBe("VIRTUAL");
    expect(zeus?.name).toBe("YetheSamartaka");
    expect(zeus?.startFrame).toBe(startFrame);
    expect(engine.entityManager.getEntity(1)?.name).toBe("Horacek");
    expect(engine.entityManager.getBySide("VIRTUAL")).toHaveLength(1);

    engine.seekTo(1);
    expect(engine.entitySnapshots().get(0)?.iconType).toBe("zeus");
    expect(engine.entitySnapshots().get(0)?.position).toEqual([8504, -902]);
  });

  it.each([
    { type: "man" as const, name: "Real Player" },
    { type: "car" as const, name: "" },
  ])("preserves a real $type entity when a Zeus event reuses its ID", ({ type, name }) => {
    engine.loadRecording(makeManifest({
      entities: [unitDef({ id: 0, type, name })],
      events: [{ frameNum: 1, type: "zeusEntity",
        payload: { curatorId: 0, name: "Curator", playerUid: "7656", bodyUnitId: -1 } }],
    }));
    expect(engine.entityManager.getEntity(0)?.type).toBe(type);
    expect(engine.entityManager.getEntity(0)?.name).toBe(name);
    expect(engine.entityManager.getAll()).toHaveLength(1);
  });
});

describe("Zeus pings", () => {
  const ping = (frameNum: number, overrides: Record<string, unknown> = {}) =>
    new ZeusPingEvent(frameNum, frameNum, {
      curatorId: 90,
      unitId: 7,
      name: "Danny",
      side: "WEST",
      x: 3411,
      y: 9002,
      ...overrides,
    });

  describe("zeusPingLifetimeFrames", () => {
    it("is 180 frames at the default 1 s capture delay", () => {
      expect(zeusPingLifetimeFrames(1000)).toBe(ZEUS_PING_MAP_SECONDS);
    });

    it("scales with a non-default capture delay", () => {
      expect(zeusPingLifetimeFrames(500)).toBe(360);
      expect(zeusPingLifetimeFrames(2000)).toBe(90);
    });

    it("falls back rather than dividing by zero", () => {
      expect(zeusPingLifetimeFrames(0)).toBe(ZEUS_PING_MAP_SECONDS);
    });
  });

  describe("getActivePings", () => {
    let events: EventManager;

    beforeEach(() => {
      events = new EventManager();
      events.addEvent(ping(100));
    });

    it("shows the ping on its own frame and until the lifetime elapses", () => {
      expect(events.getActivePings(100, 180)).toHaveLength(1);
      expect(events.getActivePings(279, 180)).toHaveLength(1);
    });

    it("drops the ping exactly at the end of its lifetime", () => {
      expect(events.getActivePings(280, 180)).toEqual([]);
    });

    it("does not show a ping before it happened", () => {
      expect(events.getActivePings(99, 180)).toEqual([]);
    });

    it("keeps the ping in the event log after it leaves the map", () => {
      expect(events.getActiveEvents(5000)).toHaveLength(1);
      expect(events.getActivePings(5000, 180)).toEqual([]);
    });
  });

  describe("groupZeusPings", () => {
    it("collapses co-located pings from one player and lists times newest first", () => {
      const groups = groupZeusPings([ping(100), ping(160, { x: 3420, y: 9010 })]);
      expect(groups).toHaveLength(1);
      expect(groups[0].frames).toEqual([160, 100]);
      expect(groups[0].latestFrame).toBe(160);
      expect(groups[0].position).toEqual([3420, 9010]);
    });

    it("keeps pings from the same player far apart separate", () => {
      const groups = groupZeusPings([ping(100), ping(160, { x: 5000, y: 9002 })]);
      expect(groups).toHaveLength(2);
    });

    it("keeps different players separate even at the same spot", () => {
      const groups = groupZeusPings([ping(100), ping(100, { unitId: 8, name: "Horacek" })]);
      expect(groups).toHaveLength(2);
    });
  });

  describe("zeusPingAlpha", () => {
    it("is solid for most of the lifetime and fades at the end", () => {
      expect(zeusPingAlpha(100, 100, 180)).toBe(1);
      expect(zeusPingAlpha(240, 100, 180)).toBe(1);
      expect(zeusPingAlpha(275, 100, 180)).toBeLessThan(1);
    });

    it("is zero outside the lifetime", () => {
      expect(zeusPingAlpha(280, 100, 180)).toBe(0);
      expect(zeusPingAlpha(99, 100, 180)).toBe(0);
    });
  });
});

describe("Zeus modules", () => {
  const placed = (frameNum: number, overrides: Record<string, unknown> = {}) =>
    new ZeusModuleEvent(frameNum, frameNum, {
      curatorId: 90,
      curatorName: "Danny",
      className: "zen_modules_moduleHeal",
      displayName: "Heal",
      x: 3411,
      y: 9002,
      ...overrides,
    });

  describe("zeusModuleLifetimeFrames", () => {
    it("is 30 frames at the default 1 s capture delay", () => {
      expect(zeusModuleLifetimeFrames(1000)).toBe(ZEUS_MODULE_MAP_SECONDS);
    });

    it("scales with a non-default capture delay", () => {
      expect(zeusModuleLifetimeFrames(500)).toBe(60);
      expect(zeusModuleLifetimeFrames(2000)).toBe(15);
    });
  });

  describe("getActiveZeusModules", () => {
    let events: EventManager;

    beforeEach(() => {
      events = new EventManager();
      events.addEvent(placed(100));
    });

    it("shows the module on its own frame and until the lifetime elapses", () => {
      expect(events.getActiveZeusModules(100, 30)).toHaveLength(1);
      expect(events.getActiveZeusModules(129, 30)).toHaveLength(1);
    });

    it("drops the module exactly at the end of its 30 s map life", () => {
      expect(events.getActiveZeusModules(130, 30)).toEqual([]);
    });

    it("keeps the module in the event log after it leaves the map", () => {
      expect(events.getActiveEvents(5000)).toHaveLength(1);
      expect(events.getActiveZeusModules(5000, 30)).toEqual([]);
    });
  });

  describe("groupZeusModules", () => {
    it("collapses co-located uses of the same module by one Zeus", () => {
      const groups = groupZeusModules([placed(100), placed(110, { x: 3420, y: 9010 })]);
      expect(groups).toHaveLength(1);
      expect(groups[0].frames).toEqual([110, 100]);
      expect(groups[0].displayName).toBe("Heal");
    });

    it("keeps different module names separate even at the same spot", () => {
      const groups = groupZeusModules([
        placed(100),
        placed(100, { displayName: "Earthquake", className: "zen_modules_moduleEarthquake" }),
      ]);
      expect(groups).toHaveLength(2);
    });
  });

  describe("zeusModuleAlpha", () => {
    it("is solid for most of the 30 s life and fades in the last 5 s", () => {
      expect(zeusModuleAlpha(100, 100, 30, 5)).toBe(1);
      expect(zeusModuleAlpha(124, 100, 30, 5)).toBe(1);
      expect(zeusModuleAlpha(128, 100, 30, 5)).toBeLessThan(1);
      expect(zeusModuleFadeFrames(1000)).toBe(5);
    });

    it("is zero outside the lifetime", () => {
      expect(zeusModuleAlpha(130, 100, 30, 5)).toBe(0);
      expect(zeusModuleAlpha(99, 100, 30, 5)).toBe(0);
    });
  });
});
