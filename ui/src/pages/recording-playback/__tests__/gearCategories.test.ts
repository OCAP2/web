import { describe, expect, it } from "vitest";
import type { GearItem } from "../../../data/types";
import {
  categorizeGearItems,
  classifyGearItem,
  carriedMagazineRounds,
  filledGearCategories,
  isGrenadeItem,
  isMedicalItem,
  shouldLabelGearCategory,
  sortGearItems,
  weaponsInSlotOrder,
} from "../gearCategories";

describe("gearCategories", () => {
  it("takes the category the recorder resolved from config", () => {
    expect(isMedicalItem({ class: "ACE_packingBandage", cat: "medical" })).toBe(true);
    expect(isGrenadeItem({ class: "HandGrenade", cat: "grenades" })).toBe(true);
    expect(classifyGearItem({ class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", cat: "magazines" })).toBe(
      "magazines",
    );
  });

  it("treats an item without a category as a leftover item", () => {
    expect(classifyGearItem({ class: "ACE_CableTie" })).toBe("items");
    expect(isMedicalItem({ class: "ACE_MapTools" })).toBe(false);
    expect(isGrenadeItem({ class: "ACE_EarPlugs" })).toBe(false);
  });

  it("splits a vest into magazines, grenades, medical and leftover items in that order", () => {
    const items: GearItem[] = [
      { class: "ACE_CableTie", count: 2 },
      { class: "HandGrenade", cat: "grenades", count: 1 },
      { class: "ACE_packingBandage", cat: "medical", count: 8 },
      { class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", cat: "magazines", count: 4 },
      { class: "SmokeShell", cat: "grenades", count: 2 },
      { class: "ACE_16Rnd_9x19_mag", cat: "magazines", count: 2 },
    ];
    const groups = categorizeGearItems(items);

    expect(filledGearCategories(groups)).toEqual(["magazines", "grenades", "medical", "items"]);
    expect(groups.magazines.map((item) => item.class)).toEqual([
      "ACE_16Rnd_9x19_mag",
      "rhs_mag_30Rnd_556x45_Mk318_PMAG",
    ]);
    expect(groups.grenades.map((item) => item.class)).toEqual(["HandGrenade", "SmokeShell"]);
    expect(groups.medical.map((item) => item.class)).toEqual(["ACE_packingBandage"]);
    expect(groups.items.map((item) => item.class)).toEqual(["ACE_CableTie"]);
  });

  it("sorts chips alphabetically by the label shown, recorded name included", () => {
    expect(
      sortGearItems([
        { class: "ACE_splint" },
        { class: "ACE_packingBandage" },
        { class: "ACE_adenosine" },
      ]).map((item) => item.class),
    ).toEqual(["ACE_adenosine", "ACE_packingBandage", "ACE_splint"]);

    // "Bandage (Packing)" sorts before "Splint" on the recorded name, not on the
    // label the class would otherwise be reduced to.
    expect(
      sortGearItems([
        { class: "ACE_splint", name: "Splint" },
        { class: "ACE_packingBandage", name: "Bandage (Packing)" },
        { class: "ACE_adenosine", name: "Adenosine Autoinjector" },
      ]).map((item) => item.name),
    ).toEqual(["Adenosine Autoinjector", "Bandage (Packing)", "Splint"]);
  });

  it("only labels leftover items when another group is present", () => {
    expect(shouldLabelGearCategory("items", ["items"])).toBe(false);
    expect(shouldLabelGearCategory("items", ["magazines", "items"])).toBe(true);
    expect(shouldLabelGearCategory("magazines", ["magazines"])).toBe(true);
    expect(shouldLabelGearCategory("grenades", ["grenades"])).toBe(true);
  });

  it("sums totalRounds from ammo magazines and skips grenades and medical", () => {
    expect(
      carriedMagazineRounds([
        { class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", cat: "magazines", totalRounds: 120 },
        { class: "ACE_16Rnd_9x19_mag", cat: "magazines", totalRounds: 34 },
        { class: "HandGrenade", cat: "grenades", totalRounds: 1 },
        { class: "kat_Painkiller", cat: "medical", totalRounds: 20 },
      ]),
    ).toBe(154);
    expect(carriedMagazineRounds([])).toBeUndefined();
    expect(
      carriedMagazineRounds([{ class: "SmokeShell", cat: "grenades", totalRounds: 2 }]),
    ).toBeUndefined();
  });

  it("restores the recorder's weapon order after a keyed diff appended a pickup", () => {
    expect(
      weaponsInSlotOrder([
        { class: "a", slot: "handgun" },
        { class: "b", slot: "binocular" },
        { class: "c", slot: "primary" },
        { class: "d", slot: "launcher" },
      ]).map((weapon) => weapon.slot),
    ).toEqual(["primary", "handgun", "launcher", "binocular"]);
  });
});
