import { describe, it, expect } from "vitest";

import {
  FALLBACK_RANGE_LR,
  FALLBACK_RANGE_SW,
  TRANSMISSION_MAX_FRAMES,
  buildNets,
  fallbackRange,
  formatFrequency,
  formatNet,
  matchTransmissionRadio,
  netKey,
  pairTransmissions,
  reachability,
  transmissionsAtFrame,
  type CommsUnitRadios,
} from "../comms";
import { makeFlatDem } from "../radioRange/demGrid";
import type { RadioSnapshotEntry, RadioTransmissionPayload } from "../../data/types";

const TFAR = { terrainInterceptionCoefficient: 7, globalRadioRangeCoef: 1 };
const ACRE = { terrainLoss: 1, signalModel: 2, ignoreAntennaDirection: false };

function radio(over: Partial<RadioSnapshotEntry> = {}): RadioSnapshotEntry {
  return {
    class: "TFAR_anprc152",
    name: "AN/PRC-152",
    count: 1,
    mod: "TFAR",
    type: "SW",
    channel: 1,
    frequency: 69.9,
    code: "",
    rangeMeters: 5000,
    additional: false,
    active: true,
    ...over,
  } as RadioSnapshotEntry;
}

function unit(unitId: number, radios: RadioSnapshotEntry[]): CommsUnitRadios {
  return { unitId, name: `Unit ${unitId}`, side: "WEST", radios };
}

describe("netKey", () => {
  it("normalises the float32 a transmission arrives as against the snapshot float", () => {
    // A transmission's frequency is rounded to 3 decimals in SQF, sent as a
    // string and stored as float32; the snapshot keeps the raw value.
    const fromTransmission = Math.fround(69.9);
    expect(fromTransmission).not.toBe(69.9);
    expect(netKey(fromTransmission, "")).toBe(netKey(69.9, ""));
  });

  it("separates nets by encryption code on the same frequency", () => {
    expect(netKey(69.9, "0451")).not.toBe(netKey(69.9, "1234"));
  });

  it("does not split a net by SW versus LR, which interoperate in TFAR", () => {
    expect(netKey(69.9, "")).toBe(netKey(69.9, ""));
  });

  it("survives a missing frequency without collapsing every net into one", () => {
    expect(netKey(Number.NaN, "a")).not.toBe(netKey(Number.NaN, "b"));
  });
});

describe("formatFrequency", () => {
  it("writes a TFAR frequency the way TFAR does", () => {
    // TFAR_FREQ_ROUND_POWER is 10, and its string form drops the decimal when
    // the value is whole: "100", not "100.0" and certainly not "100.000".
    expect(formatFrequency(100)).toBe("100");
    expect(formatFrequency(69.9)).toBe("69.9");
    expect(formatFrequency(295.8)).toBe("295.8");
  });

  it("keeps the decimals ACRE actually uses", () => {
    // PRC-152 presets walk (950 + 2i) * 0.0625, so 59.375 is a real channel.
    expect(formatFrequency(59.375)).toBe("59.375");
    expect(formatFrequency(2400.01)).toBe("2400.01");
  });

  it("survives a missing frequency", () => {
    expect(formatFrequency(Number.NaN)).toBe("unknown");
  });
});

describe("formatNet", () => {
  it("shows the frequency, and the code only when one is set", () => {
    expect(formatNet(69.9, "")).toBe("69.9 MHz");
    expect(formatNet(69.9, "0451")).toBe("69.9 MHz · 0451");
  });
});

describe("frequency precision against the real mods", () => {
  // Every net frequency from the No Wonder Convoy recording, which is what the
  // recorder actually writes: TFAR rounds to one decimal and whole numbers keep
  // none. Each has to survive the float32 a transmission arrives as.
  const RECORDED = [100, 84, 200, 295.8, 201, 47.3, 202];

  it("joins a transmission to a snapshot for every recorded TFAR frequency", () => {
    for (const frequency of RECORDED) {
      expect(netKey(Math.fround(frequency), "")).toBe(netKey(frequency, ""));
    }
  });

  it("joins the finest ACRE steps too", () => {
    for (const frequency of [59.375, 59.5, 400.63, 2400.01, 2402.55]) {
      expect(netKey(Math.fround(frequency), "")).toBe(netKey(frequency, ""));
    }
  });

  it("still separates adjacent TFAR channels, which are 0.1 apart", () => {
    expect(netKey(69.9, "")).not.toBe(netKey(70.0, ""));
    expect(netKey(Math.fround(69.9), "")).not.toBe(netKey(Math.fround(70.0), ""));
  });

  it("separates adjacent ACRE channels, which are 0.01 apart", () => {
    expect(netKey(Math.fround(2400.01), "")).not.toBe(netKey(Math.fround(2400.02), ""));
  });
});

describe("buildNets", () => {
  it("puts units sharing a frequency and code on one net", () => {
    const nets = buildNets([
      unit(1, [radio()]),
      unit(2, [radio()]),
      unit(3, [radio({ frequency: 40.5 })]),
    ]);

    expect(nets.map((n) => n.frequency)).toEqual([40.5, 69.9]);
    expect(nets[1].members.map((m) => m.unitId)).toEqual([1, 2]);
    expect(nets[0].members.map((m) => m.unitId)).toEqual([3]);
  });

  it("counts a monitored additional channel as membership", () => {
    const nets = buildNets([
      unit(1, [radio()]),
      unit(2, [radio({ frequency: 40.5 }), radio({ frequency: 69.9, additional: true, active: false })]),
    ]);

    const company = nets.find((n) => n.frequency === 69.9)!;
    expect(company.members.map((m) => m.unitId)).toEqual([1, 2]);
    expect(company.members.find((m) => m.unitId === 2)!.monitoring).toBe(true);
  });

  it("keeps one entry per unit per net, preferring the longer-ranged radio", () => {
    const nets = buildNets([
      unit(1, [radio({ rangeMeters: 5000 }), radio({ type: "LR", rangeMeters: 20000 })]),
    ]);

    expect(nets).toHaveLength(1);
    expect(nets[0].members).toHaveLength(1);
    expect(nets[0].members[0].entry.rangeMeters).toBe(20000);
  });

  it("ignores radios with no frequency", () => {
    expect(buildNets([unit(1, [radio({ frequency: Number.NaN })])])).toEqual([]);
  });
});

describe("matchTransmissionRadio", () => {
  const tx = { frequency: Math.fround(69.9), code: "", type: "SW" };

  it("finds the radio the transmission was made on", () => {
    const sw = radio({ rangeMeters: 5000 });
    const lr = radio({ type: "LR", frequency: 40.5, rangeMeters: 20000 });
    expect(matchTransmissionRadio([lr, sw], tx)).toBe(sw);
  });

  it("prefers the active radio when two of the same type sit on the net", () => {
    const idle = radio({ active: false, rangeMeters: 3000 });
    const active = radio({ active: true, rangeMeters: 5000 });
    expect(matchTransmissionRadio([idle, active], tx)).toBe(active);
  });

  it("falls back to any radio on the net when the type does not match", () => {
    const lr = radio({ type: "LR", active: false });
    expect(matchTransmissionRadio([lr], tx)).toBe(lr);
  });

  it("returns null when the player carries nothing on that net", () => {
    expect(matchTransmissionRadio([radio({ frequency: 40.5 })], tx)).toBeNull();
  });
});

describe("fallbackRange", () => {
  it("uses the addon's own defaults when there is no snapshot to join", () => {
    expect(fallbackRange("SW")).toBe(FALLBACK_RANGE_SW);
    expect(fallbackRange("LR")).toBe(FALLBACK_RANGE_LR);
  });
});

describe("reachability", () => {
  const peers = [
    { unitId: 2, name: "Near", side: "WEST", position: [1100, 1000, 0] as [number, number, number], monitoring: false },
    { unitId: 3, name: "Far", side: "WEST", position: [9000, 1000, 0] as [number, number, number], monitoring: false },
  ];

  it("splits the net by range and reports distance nearest first", () => {
    const result = reachability({
      origin: [1000, 1000, 0],
      peers,
      rangeMeters: 5000,
      mod: "TFAR",
      grid: null,
      tfar: TFAR,
      acre: ACRE,
    });

    expect(result.map((r) => r.unitId)).toEqual([2, 3]);
    expect(result[0].inRange).toBe(true);
    expect(Math.round(result[0].distance)).toBe(100);
    expect(result[1].inRange).toBe(false);
  });

  it("uses straight-line distance when no terrain grid is loaded", () => {
    const result = reachability({
      origin: [1000, 1000, 0],
      peers: [peers[0]],
      rangeMeters: 50,
      mod: "TFAR",
      grid: null,
      tfar: TFAR,
      acre: ACRE,
    });
    expect(result[0].inRange).toBe(false);
  });

  it.each([
    { coefficient: 0.5, distances: [2500, 2501, 3000], expected: [true, false, false] },
    { coefficient: 1, distances: [3000, 5000, 5001], expected: [true, true, false] },
    { coefficient: 2, distances: [6000, 10000, 10001], expected: [true, true, false] },
  ])("uses TFAR range coefficient $coefficient with or without flat terrain", ({ coefficient, distances, expected }) => {
    const input = {
      origin: [1000, 1000, 0] as [number, number, number],
      peers: distances.map((distance, index) => ({
        unitId: index + 2, name: `Receiver ${index}`, side: "WEST",
        position: [1000 + distance, 1000, 0] as [number, number, number], monitoring: false,
      })),
      rangeMeters: 5000, mod: "TFAR",
      tfar: { ...TFAR, globalRadioRangeCoef: coefficient }, acre: ACRE,
    };
    const withoutTerrain = reachability({ ...input, grid: null });
    expect(withoutTerrain.map((peer) => peer.inRange)).toEqual(expected);
    // Loading unobstructed terrain cannot change the recorded range settings.
    expect(reachability({ ...input, grid: makeFlatDem(20000, 0, 100) })).toEqual(withoutTerrain);
    expect(withoutTerrain.map((peer) => peer.distance)).toEqual(distances);
  });

  it("keeps ACRE's no-terrain range independent of TFAR settings", () => {
    const result = reachability({
      origin: [1000, 1000, 0],
      peers: [{ ...peers[0], position: [4000, 1000, 0] }],
      rangeMeters: 5000, mod: "ACRE", grid: null,
      tfar: { ...TFAR, globalRadioRangeCoef: 0.5 }, acre: ACRE,
    });
    expect(result[0].inRange).toBe(true);
  });

  it("agrees with the terrain model over flat ground", () => {
    const grid = makeFlatDem(10000, 0, 100);
    const result = reachability({
      origin: [1000, 1000, 0],
      peers,
      rangeMeters: 5000,
      mod: "TFAR",
      grid,
      tfar: TFAR,
      acre: ACRE,
    });
    expect(result[0].inRange).toBe(true);
    expect(result[1].inRange).toBe(false);
  });

  it("carries the monitoring flag through, so a listener is distinguishable", () => {
    const result = reachability({
      origin: [1000, 1000, 0],
      peers: [{ ...peers[0], monitoring: true }],
      rangeMeters: 5000,
      mod: "TFAR",
      grid: null,
      tfar: TFAR,
      acre: ACRE,
    });
    expect(result[0].monitoring).toBe(true);
  });
});

describe("pairTransmissions", () => {
  function tx(frameNum: number, over: Partial<RadioTransmissionPayload>): { frameNum: number; payload: RadioTransmissionPayload } {
    return {
      frameNum,
      payload: {
        unitId: 1,
        radio: "AN/PRC-152",
        type: "SW",
        action: "Start",
        channel: 1,
        additional: false,
        frequency: 69.9,
        code: "",
        ...over,
      },
    };
  }

  it("folds a Start and its Stop into one transmission", () => {
    const result = pairTransmissions([tx(10, {}), tx(14, { action: "Stop" })]);

    expect(result).toHaveLength(1);
    expect(result[0].startFrame).toBe(10);
    expect(result[0].endFrame).toBe(14);
    expect(result[0].openEnded).toBe(false);
  });

  it("caps a Start whose Stop never arrived rather than dropping it", () => {
    const result = pairTransmissions([tx(10, {})]);

    expect(result).toHaveLength(1);
    expect(result[0].endFrame).toBe(10 + TRANSMISSION_MAX_FRAMES);
    expect(result[0].openEnded).toBe(true);
  });

  it("ignores a Stop for a transmission that began before the recording", () => {
    expect(pairTransmissions([tx(10, { action: "Stop" })])).toEqual([]);
  });

  it("pairs per net, so keying a second radio does not close the first", () => {
    const result = pairTransmissions([
      tx(10, { frequency: 69.9 }),
      tx(12, { frequency: 40.5 }),
      tx(14, { action: "Stop", frequency: 69.9 }),
      tx(20, { action: "Stop", frequency: 40.5 }),
    ]);

    expect(result).toHaveLength(2);
    const company = result.find((r) => r.frequency === 69.9)!;
    const squad = result.find((r) => r.frequency === 40.5)!;
    expect(company.endFrame).toBe(14);
    expect(squad.endFrame).toBe(20);
  });

  it("closes an unreleased transmission when the same net is keyed again", () => {
    const result = pairTransmissions([tx(10, {}), tx(20, {})]);

    expect(result).toHaveLength(2);
    expect(result[0].endFrame).toBe(20);
    expect(result[1].startFrame).toBe(20);
    expect(transmissionsAtFrame(result, 21)).toEqual([result[1]]);
  });

  it("keeps the missing-Stop cap when the same net is keyed much later", () => {
    const result = pairTransmissions([tx(0, {}), tx(3600, {})]);

    expect(result).toHaveLength(2);
    expect(result[0].endFrame).toBe(TRANSMISSION_MAX_FRAMES);
    expect(result[0].openEnded).toBe(true);
    expect(transmissionsAtFrame(result, TRANSMISSION_MAX_FRAMES)).toEqual([result[0]]);
    expect(transmissionsAtFrame(result, TRANSMISSION_MAX_FRAMES + 1)).toEqual([]);
    expect(transmissionsAtFrame(result, 1800)).toEqual([]);
    expect(transmissionsAtFrame(result, 3600)).toEqual([result[1]]);
    expect(result[1].endFrame).toBe(3600 + TRANSMISSION_MAX_FRAMES);
  });

  it("allows a recorded Stop to close a transmission beyond the missing-Stop cap", () => {
    const result = pairTransmissions([tx(0, {}), tx(120, { action: "Stop" })]);

    expect(result).toHaveLength(1);
    expect(result[0].endFrame).toBe(120);
    expect(result[0].openEnded).toBe(false);
    expect(transmissionsAtFrame(result, 90)).toEqual(result);
  });

  it("keeps two speakers on one net apart", () => {
    const result = pairTransmissions([
      tx(10, { unitId: 1 }),
      tx(11, { unitId: 2 }),
      tx(14, { unitId: 1, action: "Stop" }),
      tx(15, { unitId: 2, action: "Stop" }),
    ]);

    expect(result.map((r) => [r.unitId, r.startFrame, r.endFrame])).toEqual([
      [1, 10, 14],
      [2, 11, 15],
    ]);
  });
});

describe("transmissionsAtFrame", () => {
  it("returns what is live at the playhead, inclusive of both ends", () => {
    const all = pairTransmissions([
      { frameNum: 10, payload: { unitId: 1, radio: "r", type: "SW", action: "Start", channel: 1, additional: false, frequency: 69.9, code: "" } },
      { frameNum: 14, payload: { unitId: 1, radio: "r", type: "SW", action: "Stop", channel: 1, additional: false, frequency: 69.9, code: "" } },
    ]);

    expect(transmissionsAtFrame(all, 9)).toEqual([]);
    expect(transmissionsAtFrame(all, 10)).toHaveLength(1);
    expect(transmissionsAtFrame(all, 14)).toHaveLength(1);
    expect(transmissionsAtFrame(all, 15)).toEqual([]);
  });
});
