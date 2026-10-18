import { describe, expect, it } from "vitest";
import type { InventorySnapshot } from "../../../data/types";
import { exportAceArsenal, exportVanillaArsenal } from "../arsenalExport";

const inventory: InventorySnapshot = {
  unitId: 1,
  load: 0.5,
  uniform: {
    class: "U_B_CombatUniform_mcam",
    items: [
      { class: "FirstAidKit", count: 2 },
      { class: "30Rnd_65x39_caseless_mag", count: 3 },
    ],
  },
  vest: { class: "V_PlateCarrier1_rgr", items: [] },
  backpack: { class: "", items: [] },
  headgear: { class: "H_HelmetB" },
  goggles: { class: "G_Tactical_Clear" },
  weapons: [{
    class: "arifle_MX_F",
    slot: "primary",
    attachments: [
      { class: "muzzle_snds_H" },
      { class: "optic_Hamr" },
    ],
  }],
  magazines: [{
    class: "30Rnd_65x39_caseless_mag",
    count: 4,
    totalRounds: 107,
    loadedCount: 1,
  }],
  assignedItems: [{ class: "ItemMap" }],
};

describe("Arsenal exports", () => {
  it("builds importable vanilla Arsenal SQF", () => {
    const exported = exportVanillaArsenal(inventory);
    expect(exported).toContain('this forceAddUniform "U_B_CombatUniform_mcam";');
    expect(exported).toContain('for "_i" from 1 to 3 do {this addItemToUniform "30Rnd_65x39_caseless_mag";};');
    expect(exported).toContain('this addMagazine "30Rnd_65x39_caseless_mag";');
    expect(exported).toContain('this addPrimaryWeaponItem "optic_Hamr";');
    expect(exported).toContain('this linkItem "ItemMap";');
  });

  /**
   * The Arsenal's Import accepts this layout and rejected every "closer to what
   * the Arsenal itself exports" variant that was tried. Treat it as fixed: the
   * `Exported from OCAP` header, no blank lines, `addMagazine` for magazines
   * carried in a weapon, and a `linkItem` for every assigned item the recorder saw.
   */
  it("keeps the layout the Arsenal's Import is known to accept", () => {
    const exported = exportVanillaArsenal(inventory);
    const lines = exported.split("\n");
    expect(lines[0]).toBe('comment "Exported from OCAP";');
    expect(lines[1]).toBe('comment "Remove existing items";');
    expect(lines).not.toContain("");
    expect(lines.indexOf('comment "Add containers";')).toBeGreaterThan(0);
    expect(lines.indexOf('comment "Add weapons";')).toBeGreaterThan(0);
    expect(lines.indexOf('comment "Add items";')).toBeGreaterThan(0);
  });

  it("builds an ACE/CBA extended loadout array", () => {
    const exported = exportAceArsenal(inventory);
    expect(exported.startsWith("[[[")).toBe(true);
    expect(exported).toContain('["arifle_MX_F","muzzle_snds_H","","optic_Hamr",["30Rnd_65x39_caseless_mag",27],[],""]');
    expect(exported).toContain('["U_B_CombatUniform_mcam",[["FirstAidKit",2],["30Rnd_65x39_caseless_mag",3,27]]]');
    expect(exported.endsWith(",[\"ItemMap\",\"\",\"\",\"\",\"\",\"\"]],[]]")).toBe(true);
  });

  it("escapes quotes using SQF string rules", () => {
    const exported = exportVanillaArsenal({
      ...inventory,
      headgear: { class: 'Hat_"Quoted"' },
    });
    expect(exported).toContain('this addHeadgear "Hat_""Quoted""";');
  });

  it("assigns an inferred loaded magazine when only a handgun is present", () => {
    const exported = exportAceArsenal({
      ...inventory,
      uniform: { ...inventory.uniform, items: [] },
      weapons: [{ class: "hgun_P07_F", slot: "handgun", attachments: [] }],
      magazines: [{ class: "16Rnd_9x21_Mag", count: 1, totalRounds: 12, loadedCount: 1 }],
    });
    expect(exported).toContain('["hgun_P07_F","","","",["16Rnd_9x21_Mag",12],[],""]');
  });

  it("does not mistake selected throwables for weapon magazines", () => {
    const withGrenades: InventorySnapshot = {
      ...inventory,
      uniform: {
        ...inventory.uniform,
        items: [{ class: "HandGrenade", count: 1 }],
      },
      magazines: [{ class: "HandGrenade", count: 1, totalRounds: 1, loadedCount: 1 }],
    };
    const vanilla = exportVanillaArsenal(withGrenades);
    const ace = exportAceArsenal(withGrenades);
    expect(vanilla).not.toContain('this addMagazine "HandGrenade";');
    expect(ace).not.toContain('["HandGrenade",1],[],""]');
  });

  it("places rifle grenades in the primary weapon's second muzzle", () => {
    const exported = exportAceArsenal({
      ...inventory,
      uniform: { ...inventory.uniform, items: [] },
      weapons: [{ class: "arifle_MX_GL_F", slot: "primary", attachments: [] }],
      magazines: [
        { class: "30Rnd_65x39_caseless_mag", count: 1, totalRounds: 23, loadedCount: 1 },
        { class: "1Rnd_HE_Grenade_shell", count: 1, totalRounds: 1, loadedCount: 1 },
      ],
    });
    expect(exported).toContain(
      '["arifle_MX_GL_F","","","",["30Rnd_65x39_caseless_mag",23],["1Rnd_HE_Grenade_shell",1],""]',
    );
  });

  it("writes assigned items in setUnitLoadout's fixed slot order", () => {
    const exported = exportAceArsenal({
      ...inventory,
      assignedItems: [
        { class: "ItemWatch" },
        { class: "ItemRadio" },
        { class: "NVGoggles" },
        { class: "ItemMap" },
        { class: "ItemCompass" },
        { class: "B_UavTerminal" },
      ],
    });
    expect(exported).toContain(
      '["ItemMap","B_UavTerminal","ItemRadio","ItemCompass","ItemWatch","NVGoggles"]',
    );
  });

  /** The exact assigned items a TFAR + cTab + SIMC recording produced. */
  const moddedAssignedItems: InventorySnapshot = {
    ...inventory,
    weapons: [
      ...inventory.weapons,
      { class: "Rangefinder", slot: "binocular", attachments: [] },
    ],
    assignedItems: [
      { class: "ItemMap" },
      { class: "ItemCompass" },
      { class: "ItemWatch" },
      { class: "TFAR_anprc152_1" },
      { class: "ItemAndroid" },
      { class: "Simc_PVS7" },
      { class: "Rangefinder" },
    ],
  };

  it("puts modded radios and GPS devices in their own slots", () => {
    const exported = exportAceArsenal(moddedAssignedItems);
    expect(exported).toContain(
      '["ItemMap","ItemAndroid","TFAR_anprc152","ItemCompass","ItemWatch","Simc_PVS7"]',
    );
  });

  it("keeps the binocular out of the ACE assigned item slots", () => {
    const exported = exportAceArsenal(moddedAssignedItems);
    expect(exported).not.toContain('"Rangefinder","ItemCompass"');
    // The vanilla side still emits it: `linkItem` ignores a weapon class, and
    // leaving the line out was one of the changes that broke the Arsenal Import.
    const vanilla = exportVanillaArsenal(moddedAssignedItems);
    expect(vanilla).toContain('this linkItem "Rangefinder";');
    expect(vanilla).toContain('this addWeapon "Rangefinder";');
  });

  /**
   * Verified in a live Arsenal: two samples differing only in this class were
   * pasted, and only the one carrying the prototype imported. TFAR's clone is
   * `scope = 1` / `scopeArsenal = 1`, so no Arsenal will ever offer it.
   */
  it("trades TFAR instance classes for the prototype in both exports", () => {
    const withSpareRadio: InventorySnapshot = {
      ...moddedAssignedItems,
      vest: {
        ...inventory.vest,
        items: [{ class: "TFAR_anprc154_12", count: 1 }],
      },
    };
    const vanilla = exportVanillaArsenal(withSpareRadio);
    expect(vanilla).toContain('this linkItem "TFAR_anprc152";');
    expect(vanilla).not.toContain("TFAR_anprc152_1");
    expect(vanilla).toContain('this addItemToVest "TFAR_anprc154";');

    const ace = exportAceArsenal(withSpareRadio);
    expect(ace).toContain("TFAR_anprc152");
    expect(ace).not.toContain("TFAR_anprc152_1");
    expect(ace).toContain('["TFAR_anprc154",1]');
  });

  it("orders unrecognised assigned items by the slots assignedItems walks", () => {
    const exported = exportAceArsenal({
      ...inventory,
      assignedItems: [
        { class: "ItemMap" },
        { class: "mod_thing_a" },
        { class: "mod_thing_b" },
      ],
    });
    // assignedItems reports map, compass, watch, radio, gps, NVG in that order.
    expect(exported).toContain('["ItemMap","","","mod_thing_a","mod_thing_b",""]');
  });
});
