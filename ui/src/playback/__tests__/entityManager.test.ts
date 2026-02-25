import { describe, it, expect, beforeEach } from "vitest";
import { Entity } from "../entities/entity";
import { Unit } from "../entities/unit";
import { Vehicle } from "../entities/vehicle";
import { Group } from "../entities/group";
import { EntityManager } from "../entityManager";
import type { EntityDef, EntityState, Side } from "../../data/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal EntityState for testing. */
function makeState(
  x: number,
  y: number,
  dir: number,
  alive: 0 | 1 | 2 = 1,
  isInVehicle = false,
): EntityState {
  return {
    position: [x, y],
    direction: dir,
    alive,
    isInVehicle,
  };
}

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
// Entity (base class)
// ---------------------------------------------------------------------------
describe("Entity", () => {
  const positions: EntityState[] = [
    makeState(100, 200, 90, 1),
    makeState(110, 210, 95, 1),
    makeState(120, 220, 100, 0),
  ];

  describe("getRelativeFrameIndex", () => {
    it("returns 0 when absoluteFrame equals startFrame", () => {
      const e = new Entity(1, "Test", "man", 10, 20, positions);
      expect(e.getRelativeFrameIndex(10)).toBe(0);
    });

    it("returns positive offset for frames after startFrame", () => {
      const e = new Entity(1, "Test", "man", 10, 20, positions);
      expect(e.getRelativeFrameIndex(12)).toBe(2);
    });

    it("returns negative offset for frames before startFrame", () => {
      const e = new Entity(1, "Test", "man", 10, 20, positions);
      expect(e.getRelativeFrameIndex(5)).toBe(-5);
    });

    it("accounts for startFrame=0", () => {
      const e = new Entity(1, "Test", "man", 0, 10, positions);
      expect(e.getRelativeFrameIndex(2)).toBe(2);
    });
  });

  describe("isFrameOutOfBounds", () => {
    it("returns true for negative relative frame", () => {
      const e = new Entity(1, "Test", "man", 0, 10, positions);
      expect(e.isFrameOutOfBounds(-1)).toBe(true);
    });

    it("returns false for frame 0", () => {
      const e = new Entity(1, "Test", "man", 0, 10, positions);
      expect(e.isFrameOutOfBounds(0)).toBe(false);
    });

    it("returns false for last valid frame", () => {
      const e = new Entity(1, "Test", "man", 0, 10, positions);
      expect(e.isFrameOutOfBounds(2)).toBe(false); // positions.length = 3
    });

    it("returns true for frame equal to positions.length", () => {
      const e = new Entity(1, "Test", "man", 0, 10, positions);
      expect(e.isFrameOutOfBounds(3)).toBe(true);
    });

    it("returns true when positions is null", () => {
      const e = new Entity(1, "Test", "man", 0, 10, null);
      expect(e.isFrameOutOfBounds(0)).toBe(true);
    });
  });

  describe("getStateAtFrame", () => {
    it("returns snapshot for valid frame", () => {
      const e = new Entity(1, "Test", "man", 0, 10, positions);
      const snap = e.getStateAtFrame(0);
      expect(snap).not.toBeNull();
      expect(snap!.id).toBe(1);
      expect(snap!.position).toEqual([100, 200]);
      expect(snap!.direction).toBe(90);
      expect(snap!.alive).toBe(1);
      expect(snap!.isInVehicle).toBe(false);
    });

    it("returns snapshot with dead state", () => {
      const e = new Entity(1, "Test", "man", 0, 10, positions);
      const snap = e.getStateAtFrame(2);
      expect(snap).not.toBeNull();
      expect(snap!.alive).toBe(0);
    });

    it("returns null for out-of-bounds frame", () => {
      const e = new Entity(1, "Test", "man", 0, 10, positions);
      expect(e.getStateAtFrame(-1)).toBeNull();
      expect(e.getStateAtFrame(3)).toBeNull();
    });

    it("returns null when positions is null", () => {
      const e = new Entity(1, "Test", "man", 0, 10, null);
      expect(e.getStateAtFrame(0)).toBeNull();
    });

    it("uses entity name when state has no name", () => {
      const e = new Entity(1, "Fallback Name", "man", 0, 10, positions);
      const snap = e.getStateAtFrame(0);
      expect(snap!.name).toBe("Fallback Name");
    });

    it("uses state name when present", () => {
      const stateWithName: EntityState[] = [
        { position: [0, 0], direction: 0, alive: 1, name: "State Name" },
      ];
      const e = new Entity(1, "Entity Name", "man", 0, 10, stateWithName);
      const snap = e.getStateAtFrame(0);
      expect(snap!.name).toBe("State Name");
    });
  });
});

// ---------------------------------------------------------------------------
// Unit
// ---------------------------------------------------------------------------
describe("Unit", () => {
  describe("sideClass", () => {
    it("WEST -> blufor", () => {
      const u = new Unit(1, "Test", "man", 0, 10, "WEST", true, "G1");
      expect(u.sideClass).toBe("blufor");
    });

    it("EAST -> opfor", () => {
      const u = new Unit(1, "Test", "man", 0, 10, "EAST", true, "G1");
      expect(u.sideClass).toBe("opfor");
    });

    it("GUER -> ind", () => {
      const u = new Unit(1, "Test", "man", 0, 10, "GUER", true, "G1");
      expect(u.sideClass).toBe("ind");
    });

    it("CIV -> civ", () => {
      const u = new Unit(1, "Test", "man", 0, 10, "CIV", true, "G1");
      expect(u.sideClass).toBe("civ");
    });
  });

  describe("sideColour", () => {
    it("WEST -> #004d99", () => {
      const u = new Unit(1, "Test", "man", 0, 10, "WEST", true, "G1");
      expect(u.sideColour).toBe("#004d99");
    });

    it("EAST -> #800000", () => {
      const u = new Unit(1, "Test", "man", 0, 10, "EAST", true, "G1");
      expect(u.sideColour).toBe("#800000");
    });

    it("GUER -> #007f00", () => {
      const u = new Unit(1, "Test", "man", 0, 10, "GUER", true, "G1");
      expect(u.sideColour).toBe("#007f00");
    });

    it("CIV -> #650080", () => {
      const u = new Unit(1, "Test", "man", 0, 10, "CIV", true, "G1");
      expect(u.sideColour).toBe("#650080");
    });
  });

  describe("properties", () => {
    it("stores role, isPlayer, groupName", () => {
      const u = new Unit(
        1,
        "Player1",
        "man",
        5,
        50,
        "WEST",
        true,
        "Alpha 1-1",
        "Squad Leader",
      );
      expect(u.role).toBe("Squad Leader");
      expect(u.isPlayer).toBe(true);
      expect(u.groupName).toBe("Alpha 1-1");
      expect(u.side).toBe("WEST");
    });

    it("initializes kill counts to zero", () => {
      const u = new Unit(1, "Test", "man", 0, 10, "WEST", false, "G1");
      expect(u.killCount).toBe(0);
      expect(u.teamKillCount).toBe(0);
    });

    it("initializes isInVehicle to false", () => {
      const u = new Unit(1, "Test", "man", 0, 10, "WEST", false, "G1");
      expect(u.isInVehicle).toBe(false);
    });
  });

  describe("getStateAtFrame", () => {
    it("returns snapshot with correct side from the unit", () => {
      const positions: EntityState[] = [
        makeState(100, 200, 90, 1),
      ];
      const u = new Unit(1, "Test", "man", 0, 10, "EAST", true, "G1", "", positions);
      const snap = u.getStateAtFrame(0);
      expect(snap).not.toBeNull();
      expect(snap!.side).toBe("EAST");
    });

    it("returns null when position entry is undefined (sparse array)", () => {
      // Sparse positions array — slot 1 is undefined
      const positions: EntityState[] = [
        makeState(100, 200, 90, 1),
      ];
      positions.length = 3; // creates undefined slots at index 1 and 2
      const u = new Unit(1, "Test", "man", 0, 10, "WEST", false, "G1", "", positions);
      expect(u.getStateAtFrame(1)).toBeNull();
    });
  });

  describe("firedOnFrame", () => {
    it("returns target position when unit fired on the given frame", () => {
      const framesFired: Array<[number, [number, number]]> = [
        [5, [500, 600]],
        [10, [700, 800]],
      ];
      const u = new Unit(1, "Test", "man", 0, 20, "WEST", true, "G1", "", null, "man", framesFired);
      expect(u.firedOnFrame(5)).toEqual([500, 600]);
      expect(u.firedOnFrame(10)).toEqual([700, 800]);
    });

    it("returns null when unit did not fire on the given frame", () => {
      const framesFired: Array<[number, [number, number]]> = [
        [5, [500, 600]],
      ];
      const u = new Unit(1, "Test", "man", 0, 20, "WEST", true, "G1", "", null, "man", framesFired);
      expect(u.firedOnFrame(6)).toBeNull();
    });

    it("returns null when framesFired is null", () => {
      const u = new Unit(1, "Test", "man", 0, 20, "WEST", true, "G1", "", null, "man", null);
      expect(u.firedOnFrame(5)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------
describe("Vehicle", () => {
  describe("crew management", () => {
    it("starts with empty crew", () => {
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car");
      expect(v.crew).toEqual([]);
    });

    it("setCrew updates crew list", () => {
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car");
      v.setCrew([1, 2, 3]);
      expect(v.crew).toEqual([1, 2, 3]);
    });

    it("setCrew replaces previous crew", () => {
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car");
      v.setCrew([1, 2]);
      v.setCrew([3, 4, 5]);
      expect(v.crew).toEqual([3, 4, 5]);
    });

    it("setCrew with empty array clears crew", () => {
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car");
      v.setCrew([1, 2]);
      v.setCrew([]);
      expect(v.crew).toEqual([]);
    });
  });

  describe("getSideFromCrew", () => {
    it("returns side of first crew member that is a Unit", () => {
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car");
      v.setCrew([1, 2]);

      const unit1 = new Unit(1, "Driver", "man", 0, 100, "EAST", true, "G1");
      const unit2 = new Unit(2, "Gunner", "man", 0, 100, "WEST", true, "G1");

      const lookup = (id: number) => {
        if (id === 1) return unit1;
        if (id === 2) return unit2;
        return null;
      };

      expect(v.getSideFromCrew(lookup)).toBe("EAST");
    });

    it("returns null when crew is empty", () => {
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car");
      const lookup = () => null;
      expect(v.getSideFromCrew(lookup)).toBeNull();
    });

    it("returns null when no crew member is a Unit", () => {
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car");
      v.setCrew([20, 30]);

      // Return non-Unit entities
      const vehicle20 = new Vehicle(20, "Trailer", "car", 0, 100, "car");
      const lookup = (id: number) => {
        if (id === 20) return vehicle20;
        return null;
      };

      expect(v.getSideFromCrew(lookup)).toBeNull();
    });

    it("skips non-Unit entities and finds first Unit", () => {
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car");
      v.setCrew([20, 2]);

      const vehicle20 = new Vehicle(20, "Trailer", "car", 0, 100, "car");
      const unit2 = new Unit(2, "Gunner", "man", 0, 100, "GUER", false, "G2");

      const lookup = (id: number) => {
        if (id === 20) return vehicle20;
        if (id === 2) return unit2;
        return null;
      };

      expect(v.getSideFromCrew(lookup)).toBe("GUER");
    });
  });

  describe("vehicleType", () => {
    it("stores the vehicle type", () => {
      const v = new Vehicle(10, "Chinook", "heli", 0, 100, "heli");
      expect(v.vehicleType).toBe("heli");
    });
  });

  describe("getStateAtFrame", () => {
    it("returns snapshot for valid frame", () => {
      const positions: EntityState[] = [
        makeState(300, 400, 90, 1),
      ];
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car", positions);
      const snap = v.getStateAtFrame(0);
      expect(snap).not.toBeNull();
      expect(snap!.id).toBe(10);
      expect(snap!.position).toEqual([300, 400]);
      expect(snap!.side).toBeNull();
      expect(snap!.isPlayer).toBe(false);
    });

    it("returns null when position entry is undefined (sparse array)", () => {
      const positions: EntityState[] = [
        makeState(300, 400, 90, 1),
      ];
      positions.length = 3; // creates undefined slots at index 1 and 2
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car", positions);
      expect(v.getStateAtFrame(1)).toBeNull();
    });

    it("returns null for out-of-bounds frame", () => {
      const positions: EntityState[] = [
        makeState(300, 400, 90, 1),
      ];
      const v = new Vehicle(10, "HMMWV", "car", 0, 100, "car", positions);
      expect(v.getStateAtFrame(5)).toBeNull();
      expect(v.getStateAtFrame(-1)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------
describe("Group", () => {
  it("stores name and side", () => {
    const g = new Group("Alpha 1-1", "WEST");
    expect(g.name).toBe("Alpha 1-1");
    expect(g.side).toBe("WEST");
  });
});

// ---------------------------------------------------------------------------
// EntityManager
// ---------------------------------------------------------------------------
describe("EntityManager", () => {
  let mgr: EntityManager;

  beforeEach(() => {
    mgr = new EntityManager();
  });

  describe("addEntity", () => {
    it("creates a Unit for type 'man'", () => {
      const entity = mgr.addEntity(unitDef({ id: 1 }));
      expect(entity).toBeInstanceOf(Unit);
      expect(entity.id).toBe(1);
      expect(entity.name).toBe("Rifleman");
    });

    it("creates a Vehicle for type 'car'", () => {
      const entity = mgr.addEntity(vehicleDef({ id: 10, type: "car" }));
      expect(entity).toBeInstanceOf(Vehicle);
      expect(entity.id).toBe(10);
    });

    it("creates a Vehicle for type 'heli'", () => {
      const entity = mgr.addEntity(vehicleDef({ id: 11, type: "heli", name: "Chinook" }));
      expect(entity).toBeInstanceOf(Vehicle);
      expect((entity as Vehicle).vehicleType).toBe("heli");
    });

    it("creates a Vehicle for type 'tank'", () => {
      const entity = mgr.addEntity(vehicleDef({ id: 12, type: "tank" }));
      expect(entity).toBeInstanceOf(Vehicle);
    });

    it("passes Unit properties correctly", () => {
      const entity = mgr.addEntity(
        unitDef({
          id: 5,
          side: "EAST",
          isPlayer: false,
          groupName: "Bravo",
          role: "Medic",
        }),
      );
      const unit = entity as Unit;
      expect(unit.side).toBe("EAST");
      expect(unit.isPlayer).toBe(false);
      expect(unit.groupName).toBe("Bravo");
      expect(unit.role).toBe("Medic");
    });
  });

  describe("getEntity", () => {
    it("returns entity by ID", () => {
      mgr.addEntity(unitDef({ id: 1 }));
      const found = mgr.getEntity(1);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(1);
    });

    it("returns null for unknown ID", () => {
      expect(mgr.getEntity(999)).toBeNull();
    });
  });

  describe("getAll", () => {
    it("returns all entities", () => {
      mgr.addEntity(unitDef({ id: 1 }));
      mgr.addEntity(unitDef({ id: 2, name: "Medic" }));
      mgr.addEntity(vehicleDef({ id: 10 }));
      expect(mgr.getAll()).toHaveLength(3);
    });

    it("returns empty array when no entities", () => {
      expect(mgr.getAll()).toEqual([]);
    });
  });

  describe("getUnits", () => {
    it("returns only Unit instances", () => {
      mgr.addEntity(unitDef({ id: 1 }));
      mgr.addEntity(unitDef({ id: 2 }));
      mgr.addEntity(vehicleDef({ id: 10 }));
      const units = mgr.getUnits();
      expect(units).toHaveLength(2);
      units.forEach((u) => expect(u).toBeInstanceOf(Unit));
    });
  });

  describe("getVehicles", () => {
    it("returns only Vehicle instances", () => {
      mgr.addEntity(unitDef({ id: 1 }));
      mgr.addEntity(vehicleDef({ id: 10 }));
      mgr.addEntity(vehicleDef({ id: 11, type: "heli" }));
      const vehicles = mgr.getVehicles();
      expect(vehicles).toHaveLength(2);
      vehicles.forEach((v) => expect(v).toBeInstanceOf(Vehicle));
    });
  });

  describe("getBySide", () => {
    it("filters units by side", () => {
      mgr.addEntity(unitDef({ id: 1, name: "Alpha1", side: "WEST" }));
      mgr.addEntity(unitDef({ id: 2, name: "Bravo1", side: "EAST" }));
      mgr.addEntity(unitDef({ id: 3, name: "Alpha2", side: "WEST" }));
      mgr.addEntity(unitDef({ id: 4, name: "Guer1", side: "GUER" }));

      const west = mgr.getBySide("WEST");
      expect(west).toHaveLength(2);
      expect(west.every((u) => u.side === "WEST")).toBe(true);

      const east = mgr.getBySide("EAST");
      expect(east).toHaveLength(1);
      expect(east[0].side).toBe("EAST");

      const guer = mgr.getBySide("GUER");
      expect(guer).toHaveLength(1);

      const civ = mgr.getBySide("CIV");
      expect(civ).toHaveLength(0);
    });

    it("deduplicates respawned players by name+group, keeping longest-lived", () => {
      // Same player "Hioshi" in group "Hades", 3 lives (respawns)
      mgr.addEntity(unitDef({ id: 10, name: "Hioshi", groupName: "Hades", side: "GUER", startFrame: 100, endFrame: 200 }));
      mgr.addEntity(unitDef({ id: 20, name: "Hioshi", groupName: "Hades", side: "GUER", startFrame: 300, endFrame: 900 })); // longest
      mgr.addEntity(unitDef({ id: 30, name: "Hioshi", groupName: "Hades", side: "GUER", startFrame: 950, endFrame: 1000 }));
      // Different player in same group
      mgr.addEntity(unitDef({ id: 40, name: "Nika", groupName: "Hades", side: "GUER", startFrame: 0, endFrame: 500 }));

      const guer = mgr.getBySide("GUER");
      expect(guer).toHaveLength(2); // Hioshi (deduped) + Nika
      const hioshi = guer.find((u) => u.name === "Hioshi")!;
      expect(hioshi.id).toBe(20); // longest life (600 frames)
    });

    it("does not deduplicate units with empty names", () => {
      mgr.addEntity(unitDef({ id: 1, name: "", groupName: "Alpha", side: "WEST", startFrame: 0, endFrame: 100 }));
      mgr.addEntity(unitDef({ id: 2, name: "", groupName: "Alpha", side: "WEST", startFrame: 0, endFrame: 200 }));
      // Named units still dedup
      mgr.addEntity(unitDef({ id: 3, name: "Bob", groupName: "Alpha", side: "WEST", startFrame: 0, endFrame: 50 }));
      mgr.addEntity(unitDef({ id: 4, name: "Bob", groupName: "Alpha", side: "WEST", startFrame: 60, endFrame: 300 }));

      const west = mgr.getBySide("WEST");
      expect(west).toHaveLength(3); // 2 unnamed + 1 Bob (deduped)
    });

    it("does not return vehicles", () => {
      mgr.addEntity(vehicleDef({ id: 10, side: "WEST" }));
      expect(mgr.getBySide("WEST")).toHaveLength(0);
    });
  });

  describe("group management", () => {
    it("addGroup creates and returns a Group", () => {
      const group = mgr.addGroup("Alpha", "WEST");
      expect(group).toBeInstanceOf(Group);
      expect(group.name).toBe("Alpha");
      expect(group.side).toBe("WEST");
    });

    it("findGroup locates by name and side", () => {
      mgr.addGroup("Alpha", "WEST");
      mgr.addGroup("Bravo", "EAST");

      const found = mgr.findGroup("Alpha", "WEST");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Alpha");
      expect(found!.side).toBe("WEST");
    });

    it("findGroup returns null for non-existent group", () => {
      mgr.addGroup("Alpha", "WEST");
      expect(mgr.findGroup("Charlie", "WEST")).toBeNull();
    });

    it("findGroup distinguishes by side", () => {
      mgr.addGroup("Alpha", "WEST");
      mgr.addGroup("Alpha", "EAST");

      const west = mgr.findGroup("Alpha", "WEST");
      const east = mgr.findGroup("Alpha", "EAST");
      expect(west).not.toBeNull();
      expect(east).not.toBeNull();
      expect(west!.side).toBe("WEST");
      expect(east!.side).toBe("EAST");
    });
  });

  describe("clear", () => {
    it("removes all entities and groups", () => {
      mgr.addEntity(unitDef({ id: 1 }));
      mgr.addEntity(vehicleDef({ id: 10 }));
      mgr.addGroup("Alpha", "WEST");

      mgr.clear();

      expect(mgr.getAll()).toEqual([]);
      expect(mgr.getEntity(1)).toBeNull();
      expect(mgr.getEntity(10)).toBeNull();
      expect(mgr.findGroup("Alpha", "WEST")).toBeNull();
    });

    it("allows re-adding entities after clear", () => {
      mgr.addEntity(unitDef({ id: 1 }));
      mgr.clear();
      mgr.addEntity(unitDef({ id: 2, name: "New Unit" }));

      expect(mgr.getAll()).toHaveLength(1);
      expect(mgr.getEntity(2)!.name).toBe("New Unit");
    });
  });
});
