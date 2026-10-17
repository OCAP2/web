import { describe, expect, it } from "vitest";
import { diffTraits, formatMultiplier, traitGroups, traitLevelKey } from "../traits";

describe("traitGroups", () => {
  it("groups engine flags, ACE levels, coefficients and custom traits", () => {
    const groups = traitGroups({
      medic: true,
      engineer: false,
      explosiveSpecialist: true,
      uavHacker: false,
      camouflageCoef: 1,
      audibleCoef: 0.5,
      loadCoef: 1.2,
      custom: { pilot: true, rank: "Sgt", score: 3 },
      ace: { medic: 2, engineer: 1, eod: false },
    });
    expect(groups.map((g) => g.id)).toEqual(["engine", "ace", "coefficients", "custom"]);
    expect(groups[0].fields.map((f) => [f.id, f.value])).toEqual([
      ["medic", true],
      ["engineer", false],
      ["explosiveSpecialist", true],
      ["uavHacker", false],
    ]);
    expect(groups[1].fields.map((f) => [f.id, f.kind, f.value])).toEqual([
      ["ace.medic", "level", 2],
      ["ace.engineer", "level", 1],
      ["ace.eod", "bool", false],
    ]);
    expect(groups[2].fields.map((f) => [f.id, f.value])).toEqual([
      ["loadCoef", 1.2],
      ["camouflageCoef", 1],
      ["audibleCoef", 0.5],
    ]);
    expect(groups[3].fields.map((f) => [f.labelKey, f.kind, f.value])).toEqual([
      ["pilot", "bool", true],
      ["rank", "text", "Sgt"],
      ["score", "number", 3],
    ]);
  });

  it("omits groups the recording does not carry", () => {
    const groups = traitGroups({ medic: false, loadCoef: 1 });
    expect(groups.map((g) => g.id)).toEqual(["engine", "coefficients"]);
    expect(traitGroups(undefined)).toEqual([]);
  });

  it("resolves ACE levels to labels", () => {
    const [ace] = traitGroups({ ace: { medic: 0, engineer: 2 } });
    expect(traitLevelKey(ace.fields[0], 0)).toBe("profile_none");
    expect(traitLevelKey(ace.fields[0], 2)).toBe("profile_trait_doctor");
    expect(traitLevelKey(ace.fields[1], 2)).toBe("profile_trait_engineer_advanced");
    expect(traitLevelKey(ace.fields[1], 9)).toBe("profile_trait_engineer_advanced");
  });

  it("formats multipliers", () => {
    expect(formatMultiplier(1)).toBe("×1");
    expect(formatMultiplier(0.8)).toBe("×0.8");
    expect(formatMultiplier(1.25)).toBe("×1.25");
    expect(formatMultiplier(1 / 3)).toBe("×0.33");
  });
});

describe("diffTraits", () => {
  it("lists only fields whose value changed, plus fields that disappeared", () => {
    const result = diffTraits(
      { medic: true, uavHacker: true, loadCoef: 1, custom: { pilot: true }, ace: { engineer: 1 } },
      { medic: true, uavHacker: false, loadCoef: 0.9, ace: { engineer: 2 } },
    );
    expect(result.map((d) => [d.id, d.from, d.to])).toEqual([
      ["uavHacker", true, false],
      ["ace.engineer", 1, 2],
      ["loadCoef", 1, 0.9],
      ["custom:pilot", true, undefined],
    ]);
  });

  it("is empty when nothing changed", () => {
    const traits = { medic: true, ace: { medic: 1 } };
    expect(diffTraits(traits, { ...traits })).toEqual([]);
  });
});
