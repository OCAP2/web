import { describe, expect, it } from "vitest";
import type { InventorySnapshot, MedicalSnapshot, RadioSnapshot, StaminaSnapshot } from "../../../data/types";
import {
  diffGear,
  diffMedical,
  diffRadios,
  diffStamina,
  gearDiffIsEmpty,
  medicalDiffIsEmpty,
} from "../profileDiff";

function inventory(overrides: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return {
    unitId: 1,
    load: 0.4,
    weapons: [],
    magazines: [],
    assignedItems: [],
    uniform: { class: "u", items: [] },
    vest: { class: "v", items: [] },
    backpack: { class: "b", items: [] },
    headgear: { class: "" },
    goggles: { class: "" },
    ...overrides,
  };
}

describe("diffGear", () => {
  it("summarizes ammo spent as a net magazine change with round counts", () => {
    const from = inventory({
      magazines: [{ class: "30Rnd", cat: "magazines", count: 5, totalRounds: 120 }],
      vest: {
        class: "v",
        items: [{ class: "30Rnd", count: 4 }],
      },
    });
    const to = inventory({
      magazines: [{ class: "30Rnd", cat: "magazines", count: 3, totalRounds: 47 }],
      vest: {
        class: "v",
        items: [{ class: "30Rnd", count: 2 }],
      },
    });

    const diff = diffGear(from, to);
    expect(diff.net).toEqual([
      expect.objectContaining({
        class: "30Rnd",
        fromCount: 5,
        toCount: 3,
        fromRounds: 120,
        toRounds: 47,
        polarity: "changed",
      }),
    ]);
    expect(diff.moved).toEqual([]);
  });

  it("treats a pocket-to-pocket shuffle with the same count as a move, not a gain/loss", () => {
    const from = inventory({
      vest: {
        class: "v",
        items: [{ class: "ACE_MapTools", count: 1 }],
      },
    });
    const to = inventory({
      backpack: {
        class: "b",
        items: [{ class: "ACE_MapTools", count: 1 }],
      },
    });

    const diff = diffGear(from, to);
    expect(diff.net).toEqual([]);
    expect(diff.moved).toEqual([
      { class: "ACE_MapTools", name: "Map Tools", count: 1, from: "vest", to: "backpack" },
    ]);
    expect(diff.locations.every((location) => location.items.length === 0)).toBe(true);
  });

  it("reports a weapon swap on the same slot", () => {
    const diff = diffGear(
      inventory({
        weapons: [{ class: "arifle_MX", slot: "primary", attachments: [] }],
      }),
      inventory({
        weapons: [{ class: "arifle_AK12", slot: "primary", attachments: [] }],
      }),
    );

    expect(diff.weapons).toEqual([
      expect.objectContaining({
        slot: "primary",
        fromName: "Arifle MX",
        toName: "Arifle AK12",
        polarity: "changed",
      }),
    ]);
  });

  it("is empty when the reconstructed kit did not change", () => {
    const kit = inventory({
      magazines: [{ class: "30Rnd", cat: "magazines", count: 2, totalRounds: 60 }],
      vest: { class: "v", items: [{ class: "30Rnd", count: 2 }] },
    });
    expect(gearDiffIsEmpty(diffGear(kit, kit))).toBe(true);
  });
});

describe("diffMedical", () => {
  it("keeps vitals that only jitter below display precision out of the diff", () => {
    const from: MedicalSnapshot = {
      unitId: 1,
      vanilla: { damage: 0 },
      ace: { bloodVolume: 5.101, heartRate: 80.2, pain: 0.201 },
    };
    const to: MedicalSnapshot = {
      unitId: 1,
      vanilla: { damage: 0 },
      ace: { bloodVolume: 5.104, heartRate: 80.4, pain: 0.204 },
    };
    expect(medicalDiffIsEmpty(diffMedical(from, to))).toBe(true);
  });

  it("surfaces new activity-log lines and body-part treatments", () => {
    const from: MedicalSnapshot = {
      unitId: 1,
      vanilla: { damage: 0 },
      ace: { bloodVolume: 6, heartRate: 80 },
      bodyParts: [{ part: "body", damage: 0.1, items: [] }],
      activity: [{ time: "10:00", text: "Checked pulse" }],
    };
    const to: MedicalSnapshot = {
      unitId: 1,
      vanilla: { damage: 0 },
      ace: { bloodVolume: 5.2, heartRate: 130 },
      bodyParts: [
        {
          part: "body",
          damage: 0.45,
          items: [{ kind: "bandage", name: "Bandaged wound", count: 1 }],
        },
      ],
      activity: [
        { time: "10:00", text: "Checked pulse" },
        { time: "10:02", text: "Applied packing bandage" },
      ],
    };

    const diff = diffMedical(from, to);
    expect(diff.fields.some((field) => field.labelKey === "profile_blood")).toBe(true);
    expect(diff.fields.some((field) => field.labelKey === "profile_heart_rate")).toBe(true);
    expect(diff.bodyParts[0]?.items[0]?.name).toBe("Bandaged wound");
    expect(diff.activity).toEqual([{ time: "10:02", text: "Applied packing bandage" }]);
  });
});

describe("diffStamina", () => {
  it("diffs load-adjusted weight after rounding to one decimal", () => {
    const from: StaminaSnapshot = { unitId: 1, vanilla: { massUnits: 545, load: 0.545 } };
    const to: StaminaSnapshot = { unitId: 1, vanilla: { massUnits: 400, load: 0.4 } };
    const fields = diffStamina(from, to);
    expect(fields.some((field) => field.labelKey === "profile_carried_weight")).toBe(true);
    expect(fields.some((field) => field.labelKey === "profile_load")).toBe(true);
  });
});

describe("diffRadios", () => {
  it("treats a frequency change on the same radio as a change, not a swap", () => {
    const radio = (frequency: number): RadioSnapshot => ({
      unitId: 1,
      radios: [
        {
          class: "TFAR_anprc152_1",
          mod: "TFAR",
          type: "SW",
          channel: 1,
          frequency,
          code: "enc",
          rangeMeters: 5000,
          additional: false,
        },
      ],
    });

    const diff = diffRadios(radio(472.8), radio(101));
    expect(diff.radios).toHaveLength(1);
    expect(diff.radios[0]?.polarity).toBe("changed");
    expect(diff.radios[0]?.fields.some((field) => field.labelKey === "profile_diff_frequency")).toBe(true);
  });
});
