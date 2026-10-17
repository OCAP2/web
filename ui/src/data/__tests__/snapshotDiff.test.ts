import { describe, expect, it } from "vitest";
import { applySnapshotDiff, isSnapshotDiff } from "../snapshotDiff";
import type { InventorySnapshot, MedicalSnapshot, PlayerSnapshotDiff } from "../types";

const base = (): MedicalSnapshot => ({
  unitId: 3,
  playerUid: "76561198000000000",
  reason: "periodic",
  vanilla: { damage: 0, lifeState: "HEALTHY" },
  bodyParts: [{ part: "head", damage: 0, items: [] }],
  ace: { bloodVolume: 6, heartRate: 80, pain: 0 },
});

describe("isSnapshotDiff", () => {
  it("recognises a diff by its base frame", () => {
    expect(isSnapshotDiff({ unitId: 3, diffOf: 40, set: {} })).toBe(true);
  });

  it("treats a full snapshot as a full snapshot", () => {
    expect(isSnapshotDiff(base())).toBe(false);
  });
});

describe("applySnapshotDiff", () => {
  it("merges nested changes without touching untouched keys", () => {
    const diff: PlayerSnapshotDiff = {
      unitId: 3,
      diffOf: 40,
      set: { ace: { heartRate: 120 } },
    };

    const result = applySnapshotDiff(base(), diff) as MedicalSnapshot;

    expect(result.ace).toEqual({ bloodVolume: 6, heartRate: 120, pain: 0 });
    expect(result.vanilla).toEqual({ damage: 0, lifeState: "HEALTHY" });
    expect(result.playerUid).toBe("76561198000000000");
  });

  it("replaces an array wholesale when the diff carries a plain array", () => {
    const diff: PlayerSnapshotDiff = {
      unitId: 3,
      diffOf: 40,
      set: {
        bodyParts: [
          { part: "head", damage: 0, items: [] },
          { part: "body", damage: 0.4, items: [{ kind: "bandage", name: "Bandaged wound", count: 2 }] },
        ],
      },
    };

    const result = applySnapshotDiff(base(), diff) as MedicalSnapshot;

    expect(result.bodyParts).toHaveLength(2);
    expect(result.bodyParts?.[1].items[0].name).toBe("Bandaged wound");
  });

  it("patches an array entry by entry when the diff names a key", () => {
    const inventory: InventorySnapshot = {
      unitId: 3,
      load: 0.5,
      uniform: { class: "u", items: [] },
      vest: { class: "v", items: [] },
      backpack: { class: "b", items: [] },
      headgear: { class: "" },
      goggles: { class: "" },
      weapons: [],
      assignedItems: [],
      magazines: [
        { class: "30Rnd", cat: "magazines", count: 5, totalRounds: 150 },
        { class: "Chemlight_green", cat: "grenades", count: 1, totalRounds: 1 },
        { class: "9Rnd", cat: "magazines", count: 2, totalRounds: 18 },
      ],
    };

    const result = applySnapshotDiff(inventory, {
      unitId: 3,
      diffOf: 40,
      set: {
        magazines: {
          $key: "class",
          put: [
            { class: "30Rnd", totalRounds: 149 },
            { class: "SmokeShell", cat: "grenades", count: 1, totalRounds: 1 },
          ],
          del: ["Chemlight_green"],
        },
      },
    }) as InventorySnapshot;

    expect(result.magazines).toEqual([
      // Untouched fields survive; the dropped entry is gone; the new one is appended.
      { class: "30Rnd", cat: "magazines", count: 5, totalRounds: 149 },
      { class: "9Rnd", cat: "magazines", count: 2, totalRounds: 18 },
      { class: "SmokeShell", cat: "grenades", count: 1, totalRounds: 1 },
    ]);
    // The snapshot the diff was built on is left alone.
    expect(inventory.magazines[0].totalRounds).toBe(150);
    expect(inventory.magazines).toHaveLength(3);
  });

  it("restores the sampled order when ord is present", () => {
    const inventory: InventorySnapshot = {
      unitId: 3,
      load: 0.5,
      uniform: { class: "u", items: [] },
      vest: { class: "v", items: [] },
      backpack: { class: "b", items: [] },
      headgear: { class: "" },
      goggles: { class: "" },
      weapons: [],
      magazines: [],
      // assignedItems is read positionally by the Arsenal export, so a radio
      // swapped in has to land where the engine walks that slot, not at the end.
      assignedItems: [
        { class: "ItemMap", count: 1 },
        { class: "ItemCompass", count: 1 },
        { class: "ItemRadio", count: 1 },
        { class: "ItemGPS", count: 1 },
      ],
    };

    const result = applySnapshotDiff(inventory, {
      unitId: 3,
      diffOf: 40,
      set: {
        assignedItems: {
          $key: "class",
          put: [{ class: "TFAR_anprc152_3", count: 1 }],
          del: ["ItemRadio"],
          ord: ["ItemMap", "ItemCompass", "TFAR_anprc152_3", "ItemGPS"],
        },
      },
    }) as InventorySnapshot;

    expect(result.assignedItems.map((item) => item.class)).toEqual([
      "ItemMap",
      "ItemCompass",
      "TFAR_anprc152_3",
      "ItemGPS",
    ]);
  });

  it("patches an array nested inside an object", () => {
    const inventory: InventorySnapshot = {
      unitId: 3,
      load: 0.5,
      uniform: { class: "u", items: [{ class: "ACE_CableTie", count: 2 }] },
      vest: { class: "v", items: [] },
      backpack: { class: "b", items: [] },
      headgear: { class: "" },
      goggles: { class: "" },
      weapons: [{ class: "arifle_MX", slot: "primary", attachments: [] }],
      assignedItems: [],
      magazines: [],
    };

    const result = applySnapshotDiff(inventory, {
      unitId: 3,
      diffOf: 40,
      set: {
        uniform: { items: { $key: "class", put: [{ class: "ACE_CableTie", count: 1 }] } },
        weapons: {
          $key: "slot",
          put: [{ slot: "primary", attachments: [{ class: "optic_Hamr" }] }],
        },
      },
    }) as InventorySnapshot;

    expect(result.uniform.items).toEqual([{ class: "ACE_CableTie", count: 1 }]);
    expect(result.uniform.class).toBe("u");
    expect(result.weapons).toEqual([
      { class: "arifle_MX", slot: "primary", attachments: [{ class: "optic_Hamr" }] },
    ]);
  });

  it("removes keys listed in unset, including nested paths", () => {
    const diff: PlayerSnapshotDiff = {
      unitId: 3,
      diffOf: 40,
      set: {},
      unset: ["ace.pain", "reason"],
    };

    const result = applySnapshotDiff(base(), diff) as MedicalSnapshot;

    expect(result.ace).toEqual({ bloodVolume: 6, heartRate: 80 });
    expect("reason" in result).toBe(false);
  });

  it("never mutates the snapshot it builds on", () => {
    const previous = base();
    const diff: PlayerSnapshotDiff = {
      unitId: 3,
      diffOf: 40,
      set: { ace: { pain: 0.8 } },
      unset: ["vanilla.lifeState"],
    };

    applySnapshotDiff(previous, diff);

    expect(previous.ace).toEqual({ bloodVolume: 6, heartRate: 80, pain: 0 });
    expect(previous.vanilla.lifeState).toBe("HEALTHY");
  });

  it("ignores unset paths that do not exist", () => {
    const result = applySnapshotDiff(base(), {
      unitId: 3,
      diffOf: 40,
      set: {},
      unset: ["kat.spo2", "ace.missing"],
    }) as MedicalSnapshot;

    expect(result.ace).toEqual({ bloodVolume: 6, heartRate: 80, pain: 0 });
  });
});
