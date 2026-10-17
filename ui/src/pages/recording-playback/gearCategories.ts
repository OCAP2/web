import type { GearItem } from "../../data/types";
import { gearItemName } from "../../data/gearDisplayName";

export type GearCategory = "magazines" | "grenades" | "medical" | "items";

export const GEAR_CATEGORY_ORDER: GearCategory[] = ["magazines", "grenades", "medical", "items"];

export const GEAR_CATEGORY_LABEL_KEYS: Record<GearCategory, string> = {
  magazines: "profile_magazines",
  grenades: "profile_grenades",
  medical: "profile_medical_gear",
  items: "profile_items",
};

export interface CategorizedGear {
  magazines: GearItem[];
  grenades: GearItem[];
  medical: GearItem[];
  items: GearItem[];
}

/**
 * The recorder resolves the category from config — ACE's `ACE_isMedicalItem`
 * flag, the engine's Throw muzzles, and `CfgMagazines` membership — and writes it
 * as `cat`. It used to be guessed here by substring-matching the `.paa` icon path
 * the snapshot carried, which cost about 3 MB of unloadable texture paths per
 * recording. "items" is the default and is left off the wire.
 */
export function classifyGearItem(item: GearItem): GearCategory {
  const category = item.cat;
  return category === "magazines" || category === "grenades" || category === "medical"
    ? category
    : "items";
}

export function isMedicalItem(item: GearItem): boolean {
  return classifyGearItem(item) === "medical";
}

export function isGrenadeItem(item: GearItem): boolean {
  return classifyGearItem(item) === "grenades";
}

/**
 * The recorder builds the weapon list in this order. A follow-up snapshot patches
 * the list by `slot`, which appends a newly picked-up weapon at the end, so the
 * card restores the order rather than showing a launcher above the rifle.
 */
const WEAPON_SLOT_ORDER = ["primary", "handgun", "launcher", "binocular"];

export function weaponsInSlotOrder<T extends { slot: string }>(weapons?: T[]): T[] {
  const rank = (slot: string): number => {
    const at = WEAPON_SLOT_ORDER.indexOf(slot);
    return at === -1 ? WEAPON_SLOT_ORDER.length : at;
  };
  return [...(weapons ?? [])].sort((a, b) => rank(a.slot) - rank(b.slot));
}

export function sortGearItems(items: GearItem[]): GearItem[] {
  return [...items].sort((a, b) => {
    const byName = gearItemName(a).localeCompare(gearItemName(b), undefined, {
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    return (a.class || "").localeCompare(b.class || "");
  });
}

export function categorizeGearItems(items: GearItem[] | undefined): CategorizedGear {
  const groups: CategorizedGear = { magazines: [], grenades: [], medical: [], items: [] };
  for (const item of items ?? []) {
    groups[classifyGearItem(item)].push(item);
  }
  for (const key of GEAR_CATEGORY_ORDER) {
    groups[key] = sortGearItems(groups[key]);
  }
  return groups;
}

export function filledGearCategories(groups: CategorizedGear): GearCategory[] {
  return GEAR_CATEGORY_ORDER.filter((key) => groups[key].length > 0);
}

/** Items stays unlabeled when it is the only group; named groups always keep their heading. */
export function shouldLabelGearCategory(
  key: GearCategory,
  filled: GearCategory[],
  alwaysLabel = false,
): boolean {
  if (alwaysLabel) return true;
  if (key === "items") return filled.length > 1;
  return true;
}

export function magazinesNotInContainers(gear: {
  magazines?: GearItem[];
  uniform?: { items?: GearItem[] };
  vest?: { items?: GearItem[] };
  backpack?: { items?: GearItem[] };
}): GearItem[] {
  const inContainers = new Set<string>();
  for (const container of [gear.uniform, gear.vest, gear.backpack]) {
    for (const item of container?.items ?? []) {
      if (item.class) inContainers.add(item.class);
    }
  }
  return (gear.magazines ?? []).filter((item) => item.class && !inContainers.has(item.class));
}

/** Sum remaining ammo in rifle/pistol magazines, skipping grenades and medical mags. */
export function carriedMagazineRounds(
  magazines?: Array<GearItem & { totalRounds?: number }>,
): number | undefined {
  let total = 0;
  let have = false;
  for (const mag of magazines ?? []) {
    if (classifyGearItem(mag) !== "magazines") continue;
    if (typeof mag.totalRounds !== "number") continue;
    total += mag.totalRounds;
    have = true;
  }
  return have ? total : undefined;
}
