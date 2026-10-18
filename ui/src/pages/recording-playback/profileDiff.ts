import type {
  GearContainer,
  GearItem,
  InventorySnapshot,
  MedicalBodyPart,
  MedicalLogEntry,
  MedicalSnapshot,
  RadioSnapshot,
  RadioSnapshotEntry,
  StaminaSnapshot,
  TreatmentItem,
} from "../../data/types";
import { BODY_PART_IDS } from "./medical/bodyImage";
import { classifyGearItem, magazinesNotInContainers, type GearCategory } from "./gearCategories";
import { gearItemName } from "../../data/gearDisplayName";

/** Classes the snapshot reports as carried magazines, wherever they sit. */
function magazineClassSet(magazines?: Array<{ class: string }>): Set<string> {
  return new Set((magazines ?? []).map((item) => item.class).filter(Boolean));
}

export type DiffPolarity = "added" | "removed" | "changed";
export type GearLocation = "uniform" | "vest" | "backpack" | "assigned" | "loaded";

export const GEAR_LOCATION_LABEL_KEYS: Record<GearLocation, string> = {
  uniform: "profile_uniform",
  vest: "profile_vest",
  backpack: "profile_backpack",
  assigned: "profile_assigned",
  loaded: "profile_weapons",
};

export interface ItemDelta {
  polarity: DiffPolarity;
  class: string;
  name: string;
  fromCount: number;
  toCount: number;
  fromRounds?: number;
  toRounds?: number;
}

export interface MovedItem {
  class: string;
  name: string;
  count: number;
  from: GearLocation;
  to: GearLocation;
}

export interface EquippedDelta {
  polarity: DiffPolarity;
  slotKey: "profile_head" | "profile_face" | "profile_uniform" | "profile_vest" | "profile_backpack";
  fromName: string;
  toName: string;
}

export interface WeaponDelta {
  polarity: DiffPolarity;
  slot: string;
  fromName: string;
  toName: string;
  attachments: ItemDelta[];
}

export interface LocationDelta {
  location: GearLocation;
  container?: EquippedDelta;
  items: ItemDelta[];
}

export interface GearDiff {
  net: ItemDelta[];
  moved: MovedItem[];
  equipped: EquippedDelta[];
  weapons: WeaponDelta[];
  locations: LocationDelta[];
}

export interface FieldDelta {
  labelKey: string;
  kind: "text" | "number" | "percent" | "bool" | "bp" | "hemorrhage" | "stance";
  from: unknown;
  to: unknown;
  digits?: number;
  suffix?: string;
}

export interface BodyPartDelta {
  part: string;
  damage?: FieldDelta;
  items: ItemDelta[];
}

export interface MedicalDiff {
  fields: FieldDelta[];
  bodyParts: BodyPartDelta[];
  treatments: ItemDelta[];
  activity: MedicalLogEntry[];
  quickView: MedicalLogEntry[];
}

export interface RadioDelta {
  polarity: DiffPolarity;
  name: string;
  fields: FieldDelta[];
}

export interface RadioDiff {
  radios: RadioDelta[];
}

export interface MetricDelta {
  id: "kills" | "deaths" | "rounds" | "shot" | "weight" | "stamina" | "load";
  from: number | undefined;
  to: number | undefined;
}

const MASS_UNIT_KG = 0.0453592;
const STAMINA_DURATION = 60;

interface StockEntry {
  class: string;
  name: string;
  count: number;
  location: GearLocation;
}

function itemCount(item?: GearItem): number {
  if (!item?.class) return 0;
  return item.count ?? 1;
}

function itemName(item?: GearItem, fallback = ""): string {
  return gearItemName(item) || fallback;
}

function addStock(target: StockEntry[], location: GearLocation, items?: GearItem[]): void {
  for (const item of items ?? []) {
    if (!item.class) continue;
    const existing = target.find((entry) => entry.location === location && entry.class === item.class);
    if (existing) {
      existing.count += itemCount(item);
    } else {
      target.push({ class: item.class, name: itemName(item), count: itemCount(item), location });
    }
  }
}

function stockFromInventory(inv?: InventorySnapshot): StockEntry[] {
  if (!inv) return [];
  const magClasses = magazineClassSet(inv.magazines);
  const stock: StockEntry[] = [];
  addStock(stock, "uniform", inv.uniform?.items);
  addStock(stock, "vest", inv.vest?.items);
  addStock(stock, "backpack", inv.backpack?.items);
  addStock(stock, "assigned", inv.assignedItems);
  addStock(stock, "loaded", magazinesNotInContainers(inv).filter((item) => magClasses.has(item.class)));
  return stock;
}

interface MagazineStat {
  name: string;
  count: number;
  totalRounds?: number;
  category: GearCategory;
}

/** Rounds only make sense for firearm magazines, not for grenades or medical mags. */
function ammoRounds(
  cls: string,
  stats: Map<string, MagazineStat>,
  magClasses: Set<string>,
): number | undefined {
  if (!magClasses.has(cls)) return undefined;
  const stat = stats.get(cls);
  if (stat?.category !== "magazines") return undefined;
  return stat.totalRounds;
}

function magazineStats(inv?: InventorySnapshot): Map<string, MagazineStat> {
  const stats = new Map<string, MagazineStat>();
  for (const mag of inv?.magazines ?? []) {
    if (!mag.class) continue;
    const prev = stats.get(mag.class);
    const totalRounds =
      typeof mag.totalRounds === "number"
        ? (prev?.totalRounds ?? 0) + mag.totalRounds
        : prev?.totalRounds;
    stats.set(mag.class, {
      name: itemName(mag),
      count: (prev?.count ?? 0) + itemCount(mag),
      totalRounds,
      category: classifyGearItem(mag),
    });
  }
  return stats;
}

function totalsByClass(stock: StockEntry[]): Map<string, { name: string; count: number }> {
  const totals = new Map<string, { name: string; count: number }>();
  for (const entry of stock) {
    const prev = totals.get(entry.class);
    if (prev) prev.count += entry.count;
    else totals.set(entry.class, { name: entry.name, count: entry.count });
  }
  return totals;
}

function locationsOf(stock: StockEntry[], cls: string): GearLocation[] {
  return stock.filter((entry) => entry.class === cls && entry.count > 0).map((entry) => entry.location);
}

function countAt(stock: StockEntry[], location: GearLocation, cls: string): number {
  return stock.find((entry) => entry.location === location && entry.class === cls)?.count ?? 0;
}

function polarityFor(fromCount: number, toCount: number): DiffPolarity {
  if (fromCount <= 0 && toCount > 0) return "added";
  if (fromCount > 0 && toCount <= 0) return "removed";
  return "changed";
}

function makeItemDelta(
  cls: string,
  name: string,
  fromCount: number,
  toCount: number,
  fromRounds?: number,
  toRounds?: number,
): ItemDelta | undefined {
  const roundsChanged =
    fromRounds !== undefined && toRounds !== undefined ? fromRounds !== toRounds : fromRounds !== toRounds;
  if (fromCount === toCount && !roundsChanged) return undefined;
  return {
    polarity: polarityFor(fromCount, toCount),
    class: cls,
    name,
    fromCount,
    toCount,
    fromRounds,
    toRounds,
  };
}

function equippedName(item?: GearItem): string {
  return item?.class ? itemName(item) : "";
}

function diffEquippedSlot(
  slotKey: EquippedDelta["slotKey"],
  fromItem?: GearItem,
  toItem?: GearItem,
): EquippedDelta | undefined {
  const fromName = equippedName(fromItem);
  const toName = equippedName(toItem);
  const fromClass = fromItem?.class ?? "";
  const toClass = toItem?.class ?? "";
  if (fromClass === toClass && fromName === toName) return undefined;
  return {
    polarity: polarityFor(fromClass ? 1 : 0, toClass ? 1 : 0),
    slotKey,
    fromName,
    toName,
  };
}

function diffAttachments(fromItems?: GearItem[], toItems?: GearItem[]): ItemDelta[] {
  const classes = new Set<string>();
  for (const item of [...(fromItems ?? []), ...(toItems ?? [])]) {
    if (item.class) classes.add(item.class);
  }
  const deltas: ItemDelta[] = [];
  for (const cls of classes) {
    const from = fromItems?.find((item) => item.class === cls);
    const to = toItems?.find((item) => item.class === cls);
    const delta = makeItemDelta(cls, itemName(to ?? from), itemCount(from), itemCount(to));
    if (delta) deltas.push(delta);
  }
  return deltas;
}

function weaponKey(weapon: GearItem & { slot: string }): string {
  return weapon.slot || weapon.class;
}

function diffWeapons(
  fromWeapons: InventorySnapshot["weapons"] | undefined,
  toWeapons: InventorySnapshot["weapons"] | undefined,
): WeaponDelta[] {
  const slots = new Set<string>();
  for (const weapon of [...(fromWeapons ?? []), ...(toWeapons ?? [])]) {
    slots.add(weaponKey(weapon));
  }
  const deltas: WeaponDelta[] = [];
  for (const slot of slots) {
    const from = fromWeapons?.find((weapon) => weaponKey(weapon) === slot);
    const to = toWeapons?.find((weapon) => weaponKey(weapon) === slot);
    const attachments = diffAttachments(from?.attachments, to?.attachments);
    const fromClass = from?.class ?? "";
    const toClass = to?.class ?? "";
    if (fromClass === toClass && attachments.length === 0) continue;
    deltas.push({
      polarity: polarityFor(fromClass ? 1 : 0, toClass ? 1 : 0),
      slot,
      fromName: itemName(from),
      toName: itemName(to),
      attachments,
    });
  }
  return deltas;
}

export function diffGear(from?: InventorySnapshot, to?: InventorySnapshot): GearDiff {
  const fromStock = stockFromInventory(from);
  const toStock = stockFromInventory(to);
  const fromTotals = totalsByClass(fromStock);
  const toTotals = totalsByClass(toStock);
  const fromMags = magazineStats(from);
  const toMags = magazineStats(to);

  const magClasses = magazineClassSet([...(from?.magazines ?? []), ...(to?.magazines ?? [])]);
  const classes = new Set([...fromTotals.keys(), ...toTotals.keys(), ...fromMags.keys(), ...toMags.keys()]);
  const net: ItemDelta[] = [];
  const moved: MovedItem[] = [];
  const movedClasses = new Set<string>();

  for (const cls of classes) {
    const fromCount = fromMags.get(cls)?.count ?? fromTotals.get(cls)?.count ?? 0;
    const toCount = toMags.get(cls)?.count ?? toTotals.get(cls)?.count ?? 0;
    const name =
      toTotals.get(cls)?.name ||
      fromTotals.get(cls)?.name ||
      toMags.get(cls)?.name ||
      fromMags.get(cls)?.name ||
      cls;
    const delta = makeItemDelta(
      cls,
      name,
      fromCount,
      toCount,
      ammoRounds(cls, fromMags, magClasses),
      ammoRounds(cls, toMags, magClasses),
    );

    const fromLocs = locationsOf(fromStock, cls);
    const toLocs = locationsOf(toStock, cls);
    const stockFrom = fromTotals.get(cls)?.count ?? 0;
    const stockTo = toTotals.get(cls)?.count ?? 0;
    const pureMove =
      stockFrom === stockTo &&
      stockFrom > 0 &&
      fromLocs.length === 1 &&
      toLocs.length === 1 &&
      fromLocs[0] !== toLocs[0] &&
      fromMags.get(cls)?.totalRounds === toMags.get(cls)?.totalRounds;

    if (pureMove) {
      moved.push({ class: cls, name, count: fromCount, from: fromLocs[0], to: toLocs[0] });
      movedClasses.add(cls);
      continue;
    }
    if (delta) net.push(delta);
  }

  net.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  moved.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const equipped = [
    diffEquippedSlot("profile_head", from?.headgear, to?.headgear),
    diffEquippedSlot("profile_face", from?.goggles, to?.goggles),
    diffEquippedSlot("profile_uniform", from?.uniform, to?.uniform),
    diffEquippedSlot("profile_vest", from?.vest, to?.vest),
    diffEquippedSlot("profile_backpack", from?.backpack, to?.backpack),
  ].filter((entry): entry is EquippedDelta => !!entry);

  const locationIds: GearLocation[] = ["loaded", "uniform", "vest", "backpack", "assigned"];
  const locations: LocationDelta[] = [];
  for (const location of locationIds) {
    const container =
      location === "uniform"
        ? equipped.find((entry) => entry.slotKey === "profile_uniform")
        : location === "vest"
          ? equipped.find((entry) => entry.slotKey === "profile_vest")
          : location === "backpack"
            ? equipped.find((entry) => entry.slotKey === "profile_backpack")
            : undefined;
    const locClasses = new Set<string>();
    for (const entry of [...fromStock, ...toStock]) {
      if (entry.location === location) locClasses.add(entry.class);
    }
    const items: ItemDelta[] = [];
    for (const cls of locClasses) {
      if (movedClasses.has(cls)) continue;
      const fromCount = countAt(fromStock, location, cls);
      const toCount = countAt(toStock, location, cls);
      if (fromCount === toCount) continue;
      const changedLocations = locationIds.filter(
        (id) => countAt(fromStock, id, cls) !== countAt(toStock, id, cls),
      );
      if (net.some((entry) => entry.class === cls) && changedLocations.length <= 1) continue;
      const name =
        toStock.find((entry) => entry.class === cls)?.name ||
        fromStock.find((entry) => entry.class === cls)?.name ||
        cls;
      const delta = makeItemDelta(cls, name, fromCount, toCount);
      if (delta) items.push(delta);
    }
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    if (container || items.length) {
      locations.push({ location, container: location === "loaded" ? undefined : container, items });
    }
  }

  return {
    net,
    moved,
    equipped: equipped.filter((entry) =>
      entry.slotKey === "profile_head" || entry.slotKey === "profile_face",
    ),
    weapons: diffWeapons(from?.weapons, to?.weapons),
    locations,
  };
}

export function gearDiffIsEmpty(diff: GearDiff): boolean {
  return (
    diff.net.length === 0 &&
    diff.moved.length === 0 &&
    diff.equipped.length === 0 &&
    diff.weapons.length === 0 &&
    diff.locations.every((location) => location.items.length === 0 && !location.container)
  );
}

function rounded(value: unknown, digits = 0): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundedPercent(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return Math.round(value * 100);
}

function valuesEqual(kind: FieldDelta["kind"], from: unknown, to: unknown, digits = 0): boolean {
  if (kind === "percent") return roundedPercent(from) === roundedPercent(to);
  if (kind === "number") return rounded(from, digits) === rounded(to, digits);
  if (kind === "bp") {
    const fromBp = Array.isArray(from) ? `${from[0]}:${from[1]}` : String(from ?? "");
    const toBp = Array.isArray(to) ? `${to[0]}:${to[1]}` : String(to ?? "");
    return fromBp === toBp;
  }
  return from === to;
}

function field(
  labelKey: string,
  kind: FieldDelta["kind"],
  from: unknown,
  to: unknown,
  extra?: { digits?: number; suffix?: string },
): FieldDelta | undefined {
  if (from === undefined && to === undefined) return undefined;
  if (valuesEqual(kind, from, to, extra?.digits ?? 0)) return undefined;
  return { labelKey, kind, from, to, digits: extra?.digits, suffix: extra?.suffix };
}

function pickVital(...layers: unknown[]): number | undefined {
  let picked: number | undefined;
  for (const layer of layers) {
    if (typeof layer === "number") picked = layer;
  }
  return picked;
}

function treatmentKey(item: TreatmentItem): string {
  return `${item.kind}:${item.name}:${item.detail ?? ""}`;
}

function diffTreatments(fromItems?: TreatmentItem[], toItems?: TreatmentItem[]): ItemDelta[] {
  const keys = new Set<string>();
  const fromMap = new Map<string, TreatmentItem>();
  const toMap = new Map<string, TreatmentItem>();
  for (const item of fromItems ?? []) {
    const key = treatmentKey(item);
    keys.add(key);
    fromMap.set(key, item);
  }
  for (const item of toItems ?? []) {
    const key = treatmentKey(item);
    keys.add(key);
    toMap.set(key, item);
  }
  const deltas: ItemDelta[] = [];
  for (const key of keys) {
    const from = fromMap.get(key);
    const to = toMap.get(key);
    const delta = makeItemDelta(
      key,
      to?.name || from?.name || key,
      from ? (from.count ?? 1) : 0,
      to ? (to.count ?? 1) : 0,
    );
    if (delta) deltas.push(delta);
  }
  return deltas;
}

function newLogEntries(fromEntries?: MedicalLogEntry[], toEntries?: MedicalLogEntry[]): MedicalLogEntry[] {
  const seen = new Set((fromEntries ?? []).map((entry) => `${entry.time}|${entry.text}`));
  return (toEntries ?? []).filter((entry) => !seen.has(`${entry.time}|${entry.text}`));
}

function partById(parts: MedicalBodyPart[] | undefined, id: string): MedicalBodyPart {
  return parts?.find((part) => part.part === id) ?? { part: id, damage: 0, items: [] };
}

export function diffMedical(from?: MedicalSnapshot, to?: MedicalSnapshot): MedicalDiff {
  const fromVanilla = from?.vanilla ?? {};
  const toVanilla = to?.vanilla ?? {};
  const fromAce = from?.ace;
  const toAce = to?.ace;
  const fromKat = from?.kat;
  const toKat = to?.kat;

  const fields = [
    field("profile_blood", "number", fromAce?.bloodVolume, toAce?.bloodVolume, { digits: 2, suffix: " L" }),
    field("profile_heart_rate", "number", fromAce?.heartRate, toAce?.heartRate, { suffix: " bpm" }),
    field("profile_blood_pressure", "bp", fromAce?.bloodPressure, toAce?.bloodPressure),
    field("profile_spo2", "number", pickVital(fromVanilla.spo2, fromAce?.spo2, fromKat?.spo2), pickVital(toVanilla.spo2, toAce?.spo2, toKat?.spo2), { digits: 1, suffix: "%" }),
    field("profile_pain", "percent", fromAce?.pain, toAce?.pain),
    field("profile_bleeding", "number", fromAce?.bleedingRate, toAce?.bleedingRate, { digits: 2 }),
    field("profile_hemorrhage", "hemorrhage", fromAce?.hemorrhage, toAce?.hemorrhage),
    field("profile_unconscious", "bool", fromAce?.unconscious, toAce?.unconscious),
    field("profile_cardiac_arrest", "bool", fromAce?.cardiacArrest, toAce?.cardiacArrest),
    field("profile_life_state", "text", fromVanilla.lifeState, toVanilla.lifeState),
    field("profile_damage", "percent", fromVanilla.damage, toVanilla.damage),
    field("profile_incapacitated", "bool", fromVanilla.incapacitated, toVanilla.incapacitated),
    field("profile_etco2", "number", fromKat?.etco2, toKat?.etco2, { digits: 1 }),
    field("profile_breath_rate", "number", fromKat?.breathRate, toKat?.breathRate, { digits: 1 }),
    field("profile_airway_secured", "bool", fromKat?.airwaySecured, toKat?.airwaySecured),
    field("profile_airway_item", "text", fromKat?.airwayItem, toKat?.airwayItem),
    field("profile_obstruction", "bool", fromKat?.airwayObstruction, toKat?.airwayObstruction),
    field("profile_occluded", "bool", fromKat?.airwayOccluded, toKat?.airwayOccluded),
    field("profile_pneumothorax", "number", fromKat?.pneumothorax, toKat?.pneumothorax),
    field("profile_chest_seal", "bool", fromKat?.chestSeal, toKat?.chestSeal),
    field("profile_hemopneumothorax", "bool", fromKat?.hemopneumothorax, toKat?.hemopneumothorax),
    field("profile_tension_ptx", "bool", fromKat?.tensionPneumothorax, toKat?.tensionPneumothorax),
    field("profile_internal_bleed", "number", fromKat?.internalBleeding, toKat?.internalBleeding, { digits: 2 }),
  ].filter((entry): entry is FieldDelta => !!entry);

  const bodyParts: BodyPartDelta[] = [];
  for (const id of BODY_PART_IDS) {
    const fromPart = partById(from?.bodyParts, id);
    const toPart = partById(to?.bodyParts, id);
    const damage = field("profile_damage", "percent", fromPart.damage, toPart.damage);
    const items = diffTreatments(fromPart.items, toPart.items);
    if (damage || items.length) bodyParts.push({ part: id, damage, items });
  }

  return {
    fields,
    bodyParts,
    treatments: diffTreatments(from?.treatments, to?.treatments),
    activity: newLogEntries(from?.activity, to?.activity),
    quickView: newLogEntries(from?.quickView, to?.quickView),
  };
}

export function medicalDiffIsEmpty(diff: MedicalDiff): boolean {
  return (
    diff.fields.length === 0 &&
    diff.bodyParts.length === 0 &&
    diff.treatments.length === 0 &&
    diff.activity.length === 0 &&
    diff.quickView.length === 0
  );
}

/**
 * Stance travels in the stamina snapshot as a small integer enum so the recording
 * stores a number per sample instead of a string. Index = the recorded code;
 * anything outside the table (an older recording has no code at all) reads as unknown.
 */
export const STANCE_LABEL_KEYS = [
  "profile_stance_0",
  "profile_stance_1",
  "profile_stance_2",
  "profile_stance_3",
] as const;

export function stanceLabelKey(code: unknown): string | undefined {
  if (typeof code !== "number") return undefined;
  return STANCE_LABEL_KEYS[code] ?? STANCE_LABEL_KEYS[0];
}

function carriedWeightKg(source?: { massUnits?: number }): number | undefined {
  if (typeof source?.massUnits === "number") return source.massUnits * MASS_UNIT_KG;
  return undefined;
}

function sprintSecondsMax(stamina?: StaminaSnapshot, inventory?: InventorySnapshot): number | undefined {
  const max = stamina?.vanilla?.staminaMax;
  if (typeof max === "number" && max > 0) return max;
  const load = stamina?.vanilla?.load ?? inventory?.load;
  return typeof load === "number" ? STAMINA_DURATION * Math.max(0, 1 - load) : undefined;
}

function sprintReserve(stamina?: StaminaSnapshot, inventory?: InventorySnapshot): number | undefined {
  const seconds = stamina?.vanilla?.stamina;
  const max = sprintSecondsMax(stamina, inventory);
  if (typeof seconds !== "number" || !max) return undefined;
  return Math.min(1, seconds / max);
}

function staminaReserve(stamina?: StaminaSnapshot, inventory?: InventorySnapshot): number | undefined {
  if (stamina?.ace) return stamina.ace.anaerobicReserve;
  const seconds = stamina?.vanilla?.stamina;
  const max = sprintSecondsMax(stamina, inventory);
  if (typeof seconds !== "number" || !max || seconds > max + 0.5) return undefined;
  return sprintReserve(stamina, inventory);
}

export function diffStamina(
  from?: StaminaSnapshot,
  to?: StaminaSnapshot,
  fromInv?: InventorySnapshot,
  toInv?: InventorySnapshot,
): FieldDelta[] {
  const fromAce = from?.ace;
  const toAce = to?.ace;
  return [
    field("profile_carried_weight", "number", carriedWeightKg(from?.vanilla) ?? carriedWeightKg(fromInv), carriedWeightKg(to?.vanilla) ?? carriedWeightKg(toInv), { digits: 1, suffix: " kg" }),
    field("profile_load", "percent", from?.vanilla?.load ?? fromInv?.load, to?.vanilla?.load ?? toInv?.load),
    field("profile_stance", "stance", from?.vanilla?.stance, to?.vanilla?.stance),
    field("profile_sprint_reserve", "percent", fromAce ? undefined : sprintReserve(from, fromInv), toAce ? undefined : sprintReserve(to, toInv)),
    field("profile_fatigue", "percent", fromAce ? undefined : from?.vanilla?.fatigue, toAce ? undefined : to?.vanilla?.fatigue),
    field("profile_anaerobic", "percent", fromAce?.anaerobicReserve, toAce?.anaerobicReserve),
    field("profile_aerobic", "percent", fromAce?.aerobicReserve, toAce?.aerobicReserve),
    field("profile_muscle_damage", "percent", fromAce?.muscleDamage, toAce?.muscleDamage),
    field("profile_performance", "number", fromAce?.performanceFactor, toAce?.performanceFactor, { digits: 2, suffix: "×" }),
  ].filter((entry): entry is FieldDelta => !!entry);
}

function radioIdentity(entry: RadioSnapshotEntry, index: number): string {
  return `${entry.mod}:${entry.type}:${entry.additional ? 1 : 0}:${entry.class || index}`;
}

export function diffRadios(from?: RadioSnapshot, to?: RadioSnapshot): RadioDiff {
  const fromRadios = from?.radios ?? [];
  const toRadios = to?.radios ?? [];
  const fromMap = new Map(fromRadios.map((entry, index) => [radioIdentity(entry, index), entry]));
  const toMap = new Map(toRadios.map((entry, index) => [radioIdentity(entry, index), entry]));
  const radios: RadioDelta[] = [];

  for (const [key, toEntry] of toMap) {
    const fromEntry = fromMap.get(key);
    if (!fromEntry) {
      radios.push({
        polarity: "added",
        name: gearItemName(toEntry),
        fields: [
          field("profile_diff_channel", "text", undefined, toEntry.channel),
          field("profile_diff_frequency", "number", undefined, toEntry.frequency, { digits: 3, suffix: " MHz" }),
        ].filter((entry): entry is FieldDelta => !!entry),
      });
      continue;
    }
    const fields = [
      field("profile_diff_channel", "text", fromEntry.channel, toEntry.channel),
      field("profile_diff_frequency", "number", fromEntry.frequency, toEntry.frequency, { digits: 3, suffix: " MHz" }),
      field("profile_diff_code", "text", fromEntry.code, toEntry.code),
      field("profile_radio_active", "bool", fromEntry.active, toEntry.active),
      field("profile_radio_additional", "bool", fromEntry.additional, toEntry.additional),
    ].filter((entry): entry is FieldDelta => !!entry);
    if (fields.length) {
      radios.push({ polarity: "changed", name: gearItemName(toEntry), fields });
    }
  }

  for (const [key, fromEntry] of fromMap) {
    if (toMap.has(key)) continue;
    radios.push({
      polarity: "removed",
      name: gearItemName(fromEntry),
      fields: [
        field("profile_diff_frequency", "number", fromEntry.frequency, undefined, { digits: 3, suffix: " MHz" }),
      ].filter((entry): entry is FieldDelta => !!entry),
    });
  }

  return { radios };
}

export function radioDiffIsEmpty(diff: RadioDiff): boolean {
  return diff.radios.length === 0;
}

export function metricDelta(from: number | undefined, to: number | undefined, digits = 0): number | undefined {
  if (from === undefined && to === undefined) return undefined;
  const fromValue = from ?? 0;
  const toValue = to ?? 0;
  const delta = rounded(toValue - fromValue, digits);
  return delta === 0 ? undefined : delta;
}

export { carriedWeightKg, staminaReserve };
