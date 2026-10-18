import { describe, expect, it } from "vitest";
import {
  ACRE_DEFAULT_SIGNAL_MODEL,
  ACRE_DEFAULT_TERRAIN_LOSS,
  TFAR_DEFAULT_GLOBAL_RANGE_COEF,
  TFAR_DEFAULT_TERRAIN_COEFFICIENT,
  extractRadioPropagation,
  parseAcreSettingsPayload,
  parseTfarSettingsPayload,
  resolveAcrePropagation,
  resolveTfarPropagation,
} from "../radioPropagation";

describe("resolveTfarPropagation", () => {
  it("bakes the TFAR repo defaults", () => {
    const resolved = resolveTfarPropagation();
    expect(resolved.terrainInterceptionCoefficient).toBe(TFAR_DEFAULT_TERRAIN_COEFFICIENT);
    expect(resolved.globalRadioRangeCoef).toBe(TFAR_DEFAULT_GLOBAL_RANGE_COEF);
    expect(resolved.source).toBe("default");
  });

  it("keeps live CBA values from a recording", () => {
    const resolved = resolveTfarPropagation({
      terrainInterceptionCoefficient: 12,
      globalRadioRangeCoef: 0.5,
      tfarLoaded: true,
      source: "cba",
    });
    expect(resolved.terrainInterceptionCoefficient).toBe(12);
    expect(resolved.globalRadioRangeCoef).toBe(0.5);
    expect(resolved.tfarLoaded).toBe(true);
    expect(resolved.source).toBe("cba");
  });
});

describe("parseTfarSettingsPayload", () => {
  it("parses a JSON string the same way as an object", () => {
    const fromObject = parseTfarSettingsPayload({
      terrainInterceptionCoefficient: 9,
      globalRadioRangeCoef: 1.5,
    });
    const fromString = parseTfarSettingsPayload(
      '{"terrainInterceptionCoefficient":9,"globalRadioRangeCoef":1.5}',
    );
    expect(fromObject).toEqual(fromString);
  });
});

describe("extractRadioPropagation", () => {
  it("strips tfarSettings from the event feed and stamps the manifest values", () => {
    const extracted = extractRadioPropagation([
      { type: "killed", payload: { unitId: 1 } },
      {
        type: "tfarSettings",
        payload: { terrainInterceptionCoefficient: 4, globalRadioRangeCoef: 2, source: "cba" },
      },
      { type: "radioSnapshot", payload: { unitId: 1 } },
    ]);
    expect(extracted.events.map((event) => event.type)).toEqual(["killed", "radioSnapshot"]);
    expect(extracted.radioPropagation).toMatchObject({
      terrainInterceptionCoefficient: 4,
      globalRadioRangeCoef: 2,
      source: "cba",
    });
    expect(extracted.acrePropagation).toBeUndefined();
  });

  it("strips acreSettings separately so ACRE does not inherit TFAR coefficients", () => {
    const extracted = extractRadioPropagation([
      {
        type: "tfarSettings",
        payload: { terrainInterceptionCoefficient: 12, globalRadioRangeCoef: 0.5, source: "cba" },
      },
      {
        type: "acreSettings",
        payload: { terrainLoss: 0.4, signalModel: 1, acreLoaded: true, source: "cba" },
      },
      { type: "radioSnapshot", payload: { unitId: 1 } },
    ]);
    expect(extracted.events.map((event) => event.type)).toEqual(["radioSnapshot"]);
    expect(extracted.radioPropagation).toMatchObject({
      terrainInterceptionCoefficient: 12,
      globalRadioRangeCoef: 0.5,
    });
    expect(extracted.acrePropagation).toMatchObject({
      terrainLoss: 0.4,
      signalModel: 1,
      acreLoaded: true,
      source: "cba",
    });
  });
});

describe("resolveAcrePropagation", () => {
  it("bakes the ACRE repo defaults", () => {
    const resolved = resolveAcrePropagation();
    expect(resolved.terrainLoss).toBe(ACRE_DEFAULT_TERRAIN_LOSS);
    expect(resolved.signalModel).toBe(ACRE_DEFAULT_SIGNAL_MODEL);
    expect(resolved.source).toBe("default");
  });

  it("keeps live CBA values from a recording", () => {
    const resolved = resolveAcrePropagation({
      terrainLoss: 0.4,
      signalModel: 1,
      ignoreAntennaDirection: true,
      acreLoaded: true,
      source: "cba",
    });
    expect(resolved.terrainLoss).toBe(0.4);
    expect(resolved.signalModel).toBe(1);
    expect(resolved.ignoreAntennaDirection).toBe(true);
    expect(resolved.acreLoaded).toBe(true);
    expect(resolved.source).toBe("cba");
  });
});

describe("parseAcreSettingsPayload", () => {
  it("parses a JSON string the same way as an object", () => {
    const fromObject = parseAcreSettingsPayload({
      terrainLoss: 0.25,
      signalModel: 0,
    });
    const fromString = parseAcreSettingsPayload('{"terrainLoss":0.25,"signalModel":0}');
    expect(fromObject).toEqual(fromString);
  });
});
