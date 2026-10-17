import { describe, expect, it } from "vitest";
import { baseGearClass, gearDisplayName, gearItemName } from "../gearDisplayName";

describe("gearDisplayName", () => {
  it("splits camelCase class names into English words", () => {
    expect(gearDisplayName("ACE_elasticBandage")).toBe("Elastic Bandage");
    expect(gearDisplayName("ACE_packingBandage")).toBe("Packing Bandage");
    expect(gearDisplayName("ACE_EntrenchingTool")).toBe("Entrenching Tool");
    expect(gearDisplayName("FirstAidKit")).toBe("First Aid Kit");
    expect(gearDisplayName("SmokeShell")).toBe("Smoke Shell");
    expect(gearDisplayName("HandGrenade")).toBe("Hand Grenade");
  });

  it("keeps an existing acronym as one word", () => {
    expect(gearDisplayName("ACE_salineIV_500")).toBe("Saline IV 500");
    expect(gearDisplayName("ItemGPS")).toBe("GPS");
  });

  it("drops the engine's Item prefix from vanilla assigned items", () => {
    expect(gearDisplayName("ItemMap")).toBe("Map");
    expect(gearDisplayName("ItemCompass")).toBe("Compass");
    expect(gearDisplayName("ItemWatch")).toBe("Watch");
    expect(gearDisplayName("ItemRadio")).toBe("Radio");
    expect(gearDisplayName("Binocular")).toBe("Binocular");
  });

  it("never splits a designator between its letters and its digits", () => {
    expect(gearDisplayName("UK3CB_BAF_L85A2_UGLLAD_LDSR2D_IR")).toBe("L85A2 UGLLAD LDSR2D IR");
    expect(gearDisplayName("UK3CB_BAF_556_30Rnd_T")).toBe("556 30Rnd T");
  });

  it("trades a TFAR per-instance radio clone for its prototype", () => {
    expect(baseGearClass("TFAR_anprc152_54")).toBe("TFAR_anprc152");
    expect(baseGearClass("TFAR_anprc152")).toBe("TFAR_anprc152");
    expect(baseGearClass("ACE_salineIV_500")).toBe("ACE_salineIV_500");
    expect(gearDisplayName("TFAR_anprc152_54")).toBe("ANPRC152");
  });

  it("falls back to the class when nothing is left to show", () => {
    expect(gearDisplayName("")).toBe("");
    expect(gearDisplayName(undefined)).toBe("");
    expect(gearDisplayName("_")).toBe("_");
    expect(gearDisplayName("ACE_")).toBe("ACE");
  });

  it("prefers the display name the recorder read from config", () => {
    expect(gearItemName({ class: "UK3CB_BAF_556_30Rnd_T", name: "5.56mm 30rnd Tracer Mag" }))
      .toBe("5.56mm 30rnd Tracer Mag");
    expect(gearItemName({ class: "TFAR_anprc152_54", name: "AN/PRC-152" })).toBe("AN/PRC-152");
  });

  it("derives one for an entry that carries no name", () => {
    // The recorder applies the same derivation when config only had a
    // "$STR_..." reference, so this is what such an item is named there too.
    expect(gearItemName({ class: "ACE_elasticBandage" })).toBe("Elastic Bandage");
    expect(gearItemName({ class: "ItemMap", name: "   " })).toBe("Map");
    expect(gearItemName(undefined)).toBe("");
  });

  it("gives the same label to a class regardless of the recording server's language", () => {
    // The point of the whole exercise: a Czech server used to write "Mapa" here.
    expect(gearDisplayName("ItemMap")).toBe(gearDisplayName("ItemMap"));
    expect(gearDisplayName("kat_Pulseoximeter")).toBe("Pulseoximeter");
    expect(gearDisplayName("ACE_morphine")).toBe("Morphine");
  });
});
