import { describe, expect, it } from "vitest";
import type { MedicalBodyPart } from "../../../../data/types";
import {
  BLOOD_LOSS_COLORS,
  DAMAGE_COLORS,
  TINT,
  bodyPartFillColor,
  colorIndex,
  overlaysForMedical,
  parseBloodLoss,
  rgbaCss,
} from "../bodyImage";

const part = (id: string, items: MedicalBodyPart["items"], damage = 0): MedicalBodyPart => ({
  part: id,
  damage,
  items,
});

describe("ACE body-image colours", () => {
  it("keeps an uninjured part black so only the silhouette shows", () => {
    expect(bodyPartFillColor(part("head", []))).toBe(rgbaCss(DAMAGE_COLORS[0]));
  });

  it("tints bleeding yellow-red using ACE's ceil index", () => {
    expect(colorIndex(0, 0.5)).toBe(0);
    expect(colorIndex(0.01, 0.5)).toBe(1);
    expect(colorIndex(0.5, 0.5)).toBe(9);
    const bleeding = part("leftarm", [
      { kind: "wound", name: "Medium puncture", detail: "bleeding 0.200" },
    ]);
    expect(parseBloodLoss(bleeding)).toBeCloseTo(0.2);
    expect(bodyPartFillColor(bleeding)).toBe(
      rgbaCss(BLOOD_LOSS_COLORS[colorIndex(0.2, 0.5)]),
    );
  });

  it("falls back to the cyan-blue damage ramp when nothing is bleeding", () => {
    expect(bodyPartFillColor(part("body", [], 0.4))).toBe(
      rgbaCss(DAMAGE_COLORS[colorIndex(0.4, 0.8)]),
    );
  });
});

describe("ACE/KAT body overlays", () => {
  it("shows a tourniquet band and hides it under REBOA", () => {
    const withTq = overlaysForMedical([part("rightarm", [{ kind: "tourniquet", name: "Tourniquet" }])]);
    expect(withTq.some((overlay) => overlay.id === "tourniquet:rightarm" && overlay.tint === TINT.tourniquet)).toBe(
      true,
    );

    const blocked = overlaysForMedical([
      part("rightarm", [
        { kind: "tourniquet", name: "Tourniquet" },
        { kind: "reboa", name: "REBOA / surgical block" },
      ]),
    ]);
    expect(blocked.some((overlay) => overlay.id.startsWith("tourniquet:"))).toBe(false);
  });

  it("colours a fracture red and a splint blue", () => {
    const broken = overlaysForMedical([part("leftleg", [{ kind: "fracture", name: "Fracture" }])]);
    expect(broken).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "fracture:leftleg", tint: TINT.fracture })]),
    );
    const splinted = overlaysForMedical([part("leftleg", [{ kind: "splint", name: "Splint" }])]);
    expect(splinted).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "splint:leftleg", tint: TINT.splint })]),
    );
  });

  it("places KAT treatment icons the same way the medical menu does", () => {
    const overlays = overlaysForMedical(
      [
        part("body", [
          { kind: "chestSeal", name: "Chest seal" },
          { kind: "ivAccess", name: "IO access" },
        ]),
        part("head", [
          { kind: "airway", name: "Larynxtubus" },
          { kind: "oxygen", name: "Nasal cannula" },
        ]),
        part("leftarm", [
          { kind: "monitor", name: "Pulse oximeter" },
          { kind: "ivAccess", name: "IV access 16g" },
        ]),
      ],
      { pneumothorax: 2 },
    );

    const ids = overlays.map((overlay) => overlay.id);
    expect(ids).toEqual(
      expect.arrayContaining(["chestSeal", "pneumothorax", "io", "kinglt", "nasal", "pulseOx:leftarm", "iv:leftarm"]),
    );
    expect(ids).not.toContain("guedel");
  });

  it("uses a Guedel tube for a non-King airway and a selection outline", () => {
    const overlays = overlaysForMedical([part("head", [{ kind: "airway", name: "Guedeltubus" }])], undefined, "head");
    expect(overlays.map((overlay) => overlay.id)).toEqual(expect.arrayContaining(["guedel", "selected:head"]));
  });
});
