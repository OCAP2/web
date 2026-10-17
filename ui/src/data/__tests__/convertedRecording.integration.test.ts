/**
 * End-to-end check that a recording converted by `python/convert_recording_gear.py`
 * decodes and replays through the real UI code path: the JSON decoder, the event
 * manager's diff reconstruction, gear categorisation, the display-name derivation
 * and both Arsenal exports.
 *
 * It also rebuilds the *original* recording's snapshot chains and compares them
 * against the converted ones, so a conversion that silently lost gear fails here
 * rather than in the browser.
 *
 * Both files are large local artifacts, so the suite skips itself when they are
 * not present. Point it somewhere else with OCAP_TEST_RECORDING / _V2.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";

import { JsonDecoder } from "../decoders/jsonDecoder";
import { applySnapshotDiff, isSnapshotDiff } from "../snapshotDiff";
import { gearDisplayName, gearItemName } from "../gearDisplayName";
import type {
  EventDef,
  InventorySnapshot,
  MedicalSnapshot,
  PlayerSnapshotPayload,
  PlayerSnapshotType,
  RadioSnapshot,
  RawPlayerSnapshot,
} from "../types";
import {
  categorizeGearItems,
  carriedMagazineRounds,
  filledGearCategories,
} from "../../pages/recording-playback/gearCategories";
import {
  exportAceArsenal,
  exportVanillaArsenal,
} from "../../pages/recording-playback/arsenalExport";

const REPO = resolve(__dirname, "../../../../..");
const ORIGINAL =
  process.env.OCAP_TEST_RECORDING ??
  resolve(REPO, "No20Wonder20Conwoy_20260824_210930.json.gz");
const CONVERTED =
  process.env.OCAP_TEST_RECORDING_V3 ??
  resolve(REPO, "No20Wonder20Conwoy_20260824_210930.v3.json.gz");

const SNAPSHOT_TYPES: PlayerSnapshotType[] = [
  "inventorySnapshot",
  "medicalSnapshot",
  "staminaSnapshot",
  "radioSnapshot",
];

const available = existsSync(ORIGINAL) && existsSync(CONVERTED);

function decode(path: string) {
  const buffer = gunzipSync(readFileSync(path));
  return new JsonDecoder().decodeManifest(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
}

interface Sample {
  frame: number;
  payload: PlayerSnapshotPayload;
}

/** The same rebuild EventManager.reconstructPlayerSnapshots does, per unit and type. */
function rebuildChains(events: EventDef[]): Map<string, Sample[]> {
  const chains = new Map<string, Sample[]>();
  const previous = new Map<string, PlayerSnapshotPayload>();
  for (const event of events) {
    if (!SNAPSHOT_TYPES.includes(event.type as PlayerSnapshotType)) continue;
    const raw = (event as unknown as { payload: RawPlayerSnapshot }).payload;
    const key = `${raw.unitId}:${event.type}`;
    const base = previous.get(key);
    const payload = isSnapshotDiff(raw)
      ? base
        ? applySnapshotDiff(base, raw)
        : ({ unitId: raw.unitId, ...raw.set } as PlayerSnapshotPayload)
      : (raw as PlayerSnapshotPayload);
    previous.set(key, payload);
    const series = chains.get(key) ?? [];
    series.push({ frame: event.frameNum, payload });
    chains.set(key, series);
  }
  return chains;
}

const isAscii = (text: string): boolean =>
  [...text].every((character) => character.charCodeAt(0) < 128);

/** What the profile card shows at a frame: the latest snapshot at or before it. */
function stateAt(series: Sample[] | undefined, frame: number): PlayerSnapshotPayload | undefined {
  let found: PlayerSnapshotPayload | undefined;
  for (const sample of series ?? []) {
    if (sample.frame > frame) break;
    found = sample.payload;
  }
  return found;
}

/** What a gear list means, independent of how the fields were spelled. */
function gearFingerprint(inventory: InventorySnapshot) {
  const items = (list: Array<{ class: string; count?: number }> | undefined) =>
    (list ?? [])
      .map((i) => `${i.class}x${i.count ?? 1}`)
      .sort()
      .join(",");
  return [
    inventory.uniform?.class ?? "",
    items(inventory.uniform?.items),
    inventory.vest?.class ?? "",
    items(inventory.vest?.items),
    inventory.backpack?.class ?? "",
    items(inventory.backpack?.items),
    inventory.headgear?.class ?? "",
    inventory.goggles?.class ?? "",
    (inventory.weapons ?? [])
      .map((w) => `${w.slot}:${w.class}:${items(w.attachments)}`)
      .sort()
      .join("|"),
    (inventory.magazines ?? [])
      .map((m) => `${m.class}x${m.count ?? 1}:${m.totalRounds ?? ""}:${m.loadedCount ?? ""}`)
      .sort()
      .join("|"),
    items(inventory.assignedItems),
    String(inventory.load ?? ""),
    String(inventory.massUnits ?? ""),
  ].join("~");
}

describe.skipIf(!available)("a converted recording replays through the real UI path", () => {
  let original: ReturnType<typeof decode>;
  let converted: ReturnType<typeof decode>;
  beforeAll(() => {
    original = decode(ORIGINAL);
    converted = decode(CONVERTED);
  });

  it("decodes to the same mission, entities, markers and non-snapshot events", () => {
    expect(converted.missionName).toBe(original.missionName);
    expect(converted.worldName).toBe(original.worldName);
    expect(converted.endFrame).toBe(original.endFrame);
    expect(converted.entities.length).toBe(original.entities.length);
    expect(converted.markers.length).toBe(original.markers.length);
    expect(converted.times.length).toBe(original.times.length);

    const others = (events: EventDef[]) =>
      events.filter((e) => !SNAPSHOT_TYPES.includes(e.type as PlayerSnapshotType)).length;
    expect(others(converted.events)).toBe(others(original.events));
  });

  it("stamps the first serverFps sample on a real frame", () => {
    const before = original.events.filter((e) => e.type === "serverFps");
    const after = converted.events.filter((e) => e.type === "serverFps");
    expect(after.length).toBe(before.length);
    expect(before.some((e) => e.frameNum < 0)).toBe(true);
    expect(after.every((e) => e.frameNum >= 0)).toBe(true);
  });

  it("shows the same gear at every frame the original recorded one", () => {
    const before = rebuildChains(original.events);
    const after = rebuildChains(converted.events);

    const inventoryChains = [...before.keys()].filter((k) => k.endsWith("inventorySnapshot"));
    expect(inventoryChains.length).toBeGreaterThan(0);

    let compared = 0;
    for (const key of inventoryChains) {
      const from = before.get(key) ?? [];
      const to = after.get(key);
      for (const { frame } of from) {
        // What matters is the playhead lookup, not the event list. The converter
        // drops a snapshot whose payload repeats what the previous one already
        // said, and a recording can hold two snapshots of one kind on one frame,
        // so both sides are resolved the way the card resolves them.
        const want = stateAt(from, frame) as InventorySnapshot;
        const got = stateAt(to, frame) as InventorySnapshot | undefined;
        expect(got, `${key} has nothing at frame ${frame}`).toBeDefined();
        expect(gearFingerprint(got!), `${key} at frame ${frame}`).toBe(gearFingerprint(want));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("only ever drops a snapshot that repeated what the file already said", () => {
    const before = rebuildChains(original.events);
    const after = rebuildChains(converted.events);
    for (const [key, from] of before) {
      if (key.endsWith("radioSnapshot")) continue; // has its own case below
      const kept = new Set((after.get(key) ?? []).map((s) => s.frame));
      for (let i = 0; i < from.length; i++) {
        if (kept.has(from[i].frame)) continue;
        expect(i, `${key} dropped its first snapshot`).toBeGreaterThan(0);
        expect(
          JSON.stringify(from[i].payload),
          `${key} dropped a snapshot at frame ${from[i].frame} that changed something`,
        ).toBe(JSON.stringify(from[i - 1].payload));
      }
    }
  });

  it("keeps every medical vital and body part at every recorded frame", () => {
    const before = rebuildChains(original.events);
    const after = rebuildChains(converted.events);
    for (const key of [...before.keys()].filter((k) => k.endsWith("medicalSnapshot"))) {
      const series = before.get(key) ?? [];
      for (const { frame } of series) {
        const from = stateAt(series, frame) as MedicalSnapshot;
        const to = stateAt(after.get(key), frame) as MedicalSnapshot | undefined;
        expect(to, `${key} has nothing at frame ${frame}`).toBeDefined();
        expect(to!.ace, `${key} ace at frame ${frame}`).toEqual(from.ace);
        expect(to!.kat, `${key} kat at frame ${frame}`).toEqual(from.kat);
        expect(to!.vanilla, `${key} vanilla at frame ${frame}`).toEqual(from.vanilla);
        expect(
          to!.bodyParts?.map((p) => `${p.part}:${p.damage ?? 0}:${p.items.length}`),
          `${key} bodyParts at frame ${frame}`,
        ).toEqual(from.bodyParts?.map((p) => `${p.part}:${p.damage ?? 0}:${p.items.length}`));
      }
    }
  });

  it("keeps every stamina reading at every recorded frame", () => {
    const before = rebuildChains(original.events);
    const after = rebuildChains(converted.events);
    for (const key of [...before.keys()].filter((k) => k.endsWith("staminaSnapshot"))) {
      const series = before.get(key) ?? [];
      for (const { frame } of series) {
        const from = stateAt(series, frame) as unknown as Record<string, unknown>;
        const to = stateAt(after.get(key), frame) as unknown as Record<string, unknown> | undefined;
        expect(to, `${key} has nothing at frame ${frame}`).toBeDefined();
        expect(to!.vanilla, `${key} vanilla at frame ${frame}`).toEqual(from.vanilla);
        expect(to!.ace, `${key} ace at frame ${frame}`).toEqual(from.ace);
      }
    }
  });

  it("shows the same radios at every frame, bar the leading empty ones it drops", () => {
    const before = rebuildChains(original.events);
    const after = rebuildChains(converted.events);
    const ident = (snapshot: RadioSnapshot | undefined) =>
      (snapshot?.radios ?? []).map(
        (r) => `${r.class}:${r.frequency}:${r.channel}:${r.rangeMeters}:${r.active ?? false}`,
      );

    for (const [key, series] of before) {
      if (!key.endsWith("radioSnapshot")) continue;
      for (const { frame } of series) {
        const from = stateAt(series, frame) as RadioSnapshot;
        const to = stateAt(after.get(key), frame) as RadioSnapshot | undefined;
        if (to === undefined) {
          // The only snapshot the converter withholds is one written before the
          // unit had ever carried a radio, and those are empty by definition.
          expect(from.radios ?? [], `${key} withheld a real radio at frame ${frame}`).toEqual([]);
          continue;
        }
        expect(ident(to), `${key} at frame ${frame}`).toEqual(ident(from));
      }
    }
  });

  it("keeps every radio, its frequency, channel and range", () => {
    const after = rebuildChains(converted.events);
    const radios = [...after.entries()].filter(([k]) => k.endsWith("radioSnapshot"));
    expect(radios.length).toBeGreaterThan(0);

    let seen = 0;
    for (const [, series] of radios) {
      for (const { payload } of series) {
        const snapshot = payload as RadioSnapshot;
        for (const radio of snapshot.radios ?? []) {
          seen++;
          expect(typeof radio.class).toBe("string");
          expect(radio.class.length).toBeGreaterThan(0);
          expect(typeof radio.frequency).toBe("number");
          expect(typeof radio.channel).toBe("number");
          expect(typeof radio.rangeMeters).toBe("number");
          // The card labels a radio from its class now, so it must resolve.
          expect(gearDisplayName(radio.class).length).toBeGreaterThan(0);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
    // A radio snapshot is never written before the unit carried one.
    for (const [key, series] of radios) {
      expect((series[0].payload as RadioSnapshot).radios?.length ?? 0, key).toBeGreaterThan(0);
    }
  });

  it("carries no icon path anywhere in a snapshot", () => {
    const after = rebuildChains(converted.events);
    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${path}[${i}]`));
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if ("picture" in record) offenders.push(`${path}.picture`);
      for (const [key, value] of Object.entries(record)) walk(value, `${path}.${key}`);
    };
    for (const [key, series] of after) walk(series.map((s) => s.payload), key);
    expect(offenders.slice(0, 10)).toEqual([]);
  });

  it("keeps the recorded display names and never invents a localized one", () => {
    const after = rebuildChains(converted.events);
    const entries: Array<{ class: string; name?: string }> = [];
    for (const [key, series] of after) {
      if (!key.endsWith("inventorySnapshot")) continue;
      for (const { payload } of series) {
        const snapshot = payload as InventorySnapshot;
        for (const container of [snapshot.uniform, snapshot.vest, snapshot.backpack]) {
          if (container) entries.push(container);
          for (const item of container?.items ?? []) entries.push(item);
        }
        for (const item of snapshot.magazines ?? []) entries.push(item);
        for (const item of snapshot.assignedItems ?? []) entries.push(item);
        for (const weapon of snapshot.weapons ?? []) {
          entries.push(weapon);
          for (const attachment of weapon.attachments ?? []) entries.push(attachment);
        }
        if (snapshot.headgear) entries.push(snapshot.headgear);
        if (snapshot.goggles) entries.push(snapshot.goggles);
      }
    }
    // An empty equipment slot is recorded as a blank class and has no label.
    const worn = entries.filter((entry) => entry.class);
    expect(worn.length).toBeGreaterThan(1000);

    // The point of the exercise: a display name, not a class name.
    const named = worn.filter((entry) => entry.name);
    expect(named.length / worn.length).toBeGreaterThan(0.9);
    expect(named.some((entry) => entry.name === "5.56mm 30rnd Tracer Mag")).toBe(true);

    const localized = new Set<string>();
    for (const entry of worn) {
      const label = gearItemName(entry);
      expect(label.length, entry.class).toBeGreaterThan(0);
      if (!isAscii(label)) {
        // A label is only ever non-ASCII because the recording held a name the
        // mods' stringtables had no English for, and the converter keeps those
        // rather than dropping the name. Nothing is introduced by the UI.
        expect(entry.name, `${entry.class} produced a non-ASCII derived label`).toBe(label);
        localized.add(label);
      }
    }
    // A handful of pure-vanilla strings that no bundled stringtable covers.
    expect(localized.size).toBeLessThan(20);
  });

  it("groups gear into the categories the card renders", () => {
    const after = rebuildChains(converted.events);
    let checked = 0;
    let sawMagazines = false;
    let sawGrenades = false;
    let sawMedical = false;

    for (const [key, series] of after) {
      if (!key.endsWith("inventorySnapshot")) continue;
      for (const { payload } of series) {
        const snapshot = payload as InventorySnapshot;
        const groups = categorizeGearItems(snapshot.backpack?.items);
        const filled = filledGearCategories(groups);
        // Order is fixed and every returned group is non-empty.
        expect(filled).toEqual(
          ["magazines", "grenades", "medical", "items"].filter((k) => filled.includes(k as never)),
        );
        sawMagazines ||= groups.magazines.length > 0;
        sawGrenades ||= groups.grenades.length > 0;
        sawMedical ||= groups.medical.length > 0;
        // Rounds must still add up only over firearm magazines.
        const rounds = carriedMagazineRounds(snapshot.magazines);
        if (rounds !== undefined) expect(rounds).toBeGreaterThanOrEqual(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect({ sawMagazines, sawGrenades, sawMedical }).toEqual({
      sawMagazines: true,
      sawGrenades: true,
      sawMedical: true,
    });
  });

  it("derives an ASCII English label for every class it sees", () => {
    const after = rebuildChains(converted.events);
    const nonAscii: string[] = [];
    const classes = new Set<string>();
    for (const [key, series] of after) {
      if (!key.endsWith("inventorySnapshot")) continue;
      for (const { payload } of series) {
        const snapshot = payload as InventorySnapshot;
        for (const container of [snapshot.uniform, snapshot.vest, snapshot.backpack]) {
          for (const item of container?.items ?? []) classes.add(item.class);
        }
        for (const magazine of snapshot.magazines ?? []) classes.add(magazine.class);
        for (const item of snapshot.assignedItems ?? []) classes.add(item.class);
        for (const weapon of snapshot.weapons ?? []) classes.add(weapon.class);
      }
    }
    expect(classes.size).toBeGreaterThan(50);
    for (const cls of classes) {
      const label = gearDisplayName(cls);
      expect(label.length, cls).toBeGreaterThan(0);
      if (!isAscii(label)) nonAscii.push(`${cls} -> ${label}`);
    }
    // The fallback is built from the class, so it cannot be anything but ASCII.
    expect(nonAscii).toEqual([]);
  });

  it("still produces both Arsenal exports from a converted loadout", () => {
    const after = rebuildChains(converted.events);
    const loadouts = [...after.entries()]
      .filter(([k]) => k.endsWith("inventorySnapshot"))
      .flatMap(([, series]) => series.map((s) => s.payload as InventorySnapshot))
      .filter((s) => s.weapons?.length && s.assignedItems?.length);
    expect(loadouts.length).toBeGreaterThan(0);

    const loadout = loadouts[0];
    const vanilla = exportVanillaArsenal(loadout);
    expect(vanilla.split("\n")[0]).toBe('comment "Exported from OCAP";');
    expect(vanilla.split("\n")).not.toContain("");
    expect(vanilla).toContain("this addWeapon ");
    expect(vanilla).toContain("this linkItem ");
    // TFAR per-instance clones are traded for the prototype in both exports.
    expect(vanilla).not.toMatch(/"TFAR_\w+_\d+"/);

    const ace = exportAceArsenal(loadout);
    expect(ace.startsWith("[[")).toBe(true);
    expect(ace.endsWith("]]")).toBe(true);
    expect(ace).not.toMatch(/"TFAR_\w+_\d+"/);
    // A CBA extended loadout is [<getUnitLoadout array>, <extended info>], and the
    // text has to stay parseSimpleArray-compatible, which is also valid JSON here.
    const parsed = JSON.parse(ace) as [unknown[], unknown[]];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual([]);
    const loadoutArray = parsed[0];
    expect(loadoutArray).toHaveLength(10);
    // Index 9 is [map, GPS/UAV terminal, radio, compass, watch, NVG/HMD].
    const slots = loadoutArray[9] as string[];
    expect(slots).toHaveLength(6);
    expect(slots.every((slot) => typeof slot === "string")).toBe(true);
    expect(slots[0]).toBe("ItemMap");
    expect(slots.some((slot) => slot !== "")).toBe(true);

    for (const other of loadouts.slice(0, 200)) {
      expect(() => exportVanillaArsenal(other)).not.toThrow();
      expect(() => exportAceArsenal(other)).not.toThrow();
    }
  });
});
