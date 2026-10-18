import type { GearContainer, GearItem, InventorySnapshot } from "../../data/types";
import { gearItemName } from "../../data/gearDisplayName";

type Weapon = InventorySnapshot["weapons"][number];
type Magazine = InventorySnapshot["magazines"][number];

const itemCount = (item: GearItem): number => Math.max(1, Math.floor(item.count ?? 1));
const sqfString = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/**
 * TFAR clones every handheld radio into a per-instance class that carries the
 * radio's channel state (`TFAR_anprc152_1`). Those clones are `scope = 1` with
 * `scopeArsenal = 1` and `ace_arsenal_hide = 1`, so the vanilla Arsenal never
 * offers them and ACE's `verifyLoadout` drops them as unavailable — the recorded
 * class has to be traded back for the prototype it was cloned from, which is the
 * class name without the trailing instance index.
 */
function arsenalClass(className: string): string {
  return /^(?:tfar|tf)_/i.test(className) ? className.replace(/^(.+?)_\d+$/, "$1") : className;
}

const classString = (className: string): string => sqfString(arsenalClass(className));

function repeatCommand(command: string, className: string, count: number): string {
  const statement = `this ${command} ${classString(className)}`;
  return count === 1
    ? `${statement};`
    : `for "_i" from 1 to ${count} do {${statement};};`;
}

function containerLines(container: GearContainer | undefined, command: string): string[] {
  if (!container?.class) return [];
  const lines = [`this ${command} ${classString(container.class)};`];
  const destination = command === "forceAddUniform"
    ? "addItemToUniform"
    : command === "addVest"
      ? "addItemToVest"
      : "addItemToBackpack";
  for (const item of container.items ?? []) {
    if (item.class) lines.push(repeatCommand(destination, item.class, itemCount(item)));
  }
  return lines;
}

function containerMagazineCounts(inventory: InventorySnapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const container of [inventory.uniform, inventory.vest, inventory.backpack]) {
    for (const item of container?.items ?? []) {
      counts.set(item.class, (counts.get(item.class) ?? 0) + itemCount(item));
    }
  }
  return counts;
}

/** Magazines reported by magazinesAmmoFull but absent from cargo are loaded in weapons. */
function loadedMagazines(inventory: InventorySnapshot): Magazine[] {
  const cargo = containerMagazineCounts(inventory);
  const loaded: Magazine[] = [];
  for (const magazine of inventory.magazines ?? []) {
    // `isLoaded` from magazinesAmmoFull is also true for selected throwables.
    // Firearm magazines, unlike throwables, disappear from container item lists.
    const inferred = Math.max(0, itemCount(magazine) - (cargo.get(magazine.class) ?? 0));
    for (let index = 0; index < inferred; index += 1) loaded.push(magazine);
  }
  return loaded;
}

const weaponCommand: Record<string, string> = {
  primary: "addPrimaryWeaponItem",
  handgun: "addHandgunItem",
  launcher: "addSecondaryWeaponItem",
  secondary: "addSecondaryWeaponItem",
  binocular: "addBinocularItem",
};

/**
 * Only change this against a live Arsenal, one thing at a time. Four "corrections"
 * that all looked right broke the import outright: the Arsenal's own
 * `Exported from Arsenal by <name>` header, a blank line before each section,
 * folding a weapon's loaded magazine into a container instead of `addMagazine`,
 * and dropping the binocular's `linkItem`. `fn_arsenal.sqf` is not published, so
 * the Ctrl + V parser's rules cannot be looked up — this layout is empirical.
 *
 * The one deliberate departure from the recorded data is `arsenalClass`, and it
 * was confirmed the same way: two samples differing only in TFAR's radio class
 * were pasted into an Arsenal, and only the one carrying the prototype imported.
 *
 * Note the Arsenal's Ctrl + V cannot read the clipboard in multiplayer at all
 * (`copyFromClipboard` is disabled there), so test this in the editor or the
 * main-menu Virtual Arsenal. On a server, `exportAceArsenal` is the only option.
 */
export function exportVanillaArsenal(inventory: InventorySnapshot): string {
  const lines = [
    'comment "Exported from OCAP";',
    'comment "Remove existing items";',
    "removeAllWeapons this;",
    "removeAllItems this;",
    "removeAllAssignedItems this;",
    "removeUniform this;",
    "removeVest this;",
    "removeBackpack this;",
    "removeHeadgear this;",
    "removeGoggles this;",
    'comment "Add containers";',
    ...containerLines(inventory.uniform, "forceAddUniform"),
    ...containerLines(inventory.vest, "addVest"),
    ...containerLines(inventory.backpack, "addBackpack"),
  ];

  if (inventory.headgear?.class) lines.push(`this addHeadgear ${classString(inventory.headgear.class)};`);
  if (inventory.goggles?.class) lines.push(`this addGoggles ${classString(inventory.goggles.class)};`);

  // Arsenal adds carried magazines before weapons so compatible ones are loaded.
  for (const magazine of loadedMagazines(inventory)) {
    lines.push(`this addMagazine ${classString(magazine.class)};`);
  }

  lines.push('comment "Add weapons";');
  for (const weapon of inventory.weapons ?? []) {
    if (!weapon.class) continue;
    lines.push(`this addWeapon ${classString(weapon.class)};`);
    const command = weaponCommand[weapon.slot];
    if (!command) continue;
    for (const attachment of weapon.attachments ?? []) {
      if (attachment.class) lines.push(`this ${command} ${classString(attachment.class)};`);
    }
  }

  // Every assigned item, including the binocular the engine reports here:
  // `linkItem` places each one by its config, and filtering this list is one of
  // the changes that broke the import.
  lines.push('comment "Add items";');
  for (const item of inventory.assignedItems ?? []) {
    if (item.class) lines.push(repeatCommand("linkItem", item.class, itemCount(item)));
  }
  return lines.join("\n");
}

function averageRounds(magazine: Magazine): number {
  if (typeof magazine.totalRounds !== "number") return 1;
  return Math.max(0, Math.round(magazine.totalRounds / itemCount(magazine)));
}

function attachmentSlots(weapon: Weapon): [string, string, string, string] {
  const slots: [string, string, string, string] = ["", "", "", ""];
  for (const attachment of weapon.attachments ?? []) {
    const value = `${attachment.class} ${gearItemName(attachment)}`.toLowerCase();
    const index = value.includes("muzzle") || value.includes("suppress") || value.includes("silencer")
      ? 0
      : value.includes("optic") || value.includes("scope") || value.includes("sight")
        ? 2
        : value.includes("bipod")
          ? 3
          : 1;
    if (!slots[index]) slots[index] = arsenalClass(attachment.class);
  }
  return slots;
}

function findWeapon(inventory: InventorySnapshot, ...slots: string[]): Weapon | undefined {
  return inventory.weapons?.find((weapon) => slots.includes(weapon.slot));
}

function weaponArray(
  weapon: Weapon | undefined,
  primaryMagazine: Magazine | undefined,
  secondaryMagazine?: Magazine,
): unknown[] {
  if (!weapon?.class) return [];
  const [muzzle, pointer, optic, bipod] = attachmentSlots(weapon);
  const primary = primaryMagazine
    ? [arsenalClass(primaryMagazine.class), averageRounds(primaryMagazine)]
    : [];
  const secondary = secondaryMagazine
    ? [arsenalClass(secondaryMagazine.class), averageRounds(secondaryMagazine)]
    : [];
  return [arsenalClass(weapon.class), muzzle, pointer, optic, primary, secondary, bipod];
}

function containerArray(
  container: GearContainer | undefined,
  magazines: Map<string, Magazine>,
): unknown[] {
  if (!container?.class) return [];
  const items = (container.items ?? []).filter((item) => item.class).map((item) => {
    const magazine = magazines.get(item.class);
    return magazine
      ? [arsenalClass(item.class), itemCount(item), averageRounds(magazine)]
      : [arsenalClass(item.class), itemCount(item)];
  });
  return [arsenalClass(container.class), items];
}

function sqfValue(value: unknown): string {
  if (typeof value === "string") return sqfString(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(sqfValue).join(",")}]`;
  return "nil";
}

interface WeaponMagazines {
  primary?: Magazine;
  secondary?: Magazine;
}

function magazineText(magazine: Magazine): string {
  return `${magazine.class} ${gearItemName(magazine)}`.toLowerCase();
}

function looksLikeLauncherMagazine(magazine: Magazine): boolean {
  return /(?:titan|rpg|maaws|mraws|nlaw|missile|rocket|\bheat\b|[_ -](?:at|aa)(?:[_ -]|$))/.test(
    magazineText(magazine),
  );
}

function looksLikeGlMagazine(magazine: Magazine): boolean {
  return /(?:(?:^|[_ ])(?:1|2|3)rnd|ugl|vog|grenade shell|flare|gl[_ -])/.test(
    magazineText(magazine),
  );
}

function looksLikeHandgunMagazine(magazine: Magazine): boolean {
  return /(?:9x\d+|\.45|45acp|pistol|handgun|\b(?:6|7|8|10|11|12|13|15|16|17|18|20|21)rnd\b)/.test(
    magazineText(magazine),
  );
}

function looksLikeBinocularMagazine(magazine: Magazine): boolean {
  return /(?:laser.?batter|designator batter)/.test(magazineText(magazine));
}

function takeMagazine(
  pool: Magazine[],
  predicate: (magazine: Magazine) => boolean,
): Magazine | undefined {
  const index = pool.findIndex(predicate);
  if (index < 0) return undefined;
  return pool.splice(index, 1)[0];
}

function assignLoadedMagazines(inventory: InventorySnapshot): Map<Weapon, WeaponMagazines> {
  const pool = loadedMagazines(inventory);
  const primary = findWeapon(inventory, "primary");
  const launcher = findWeapon(inventory, "launcher", "secondary");
  const handgun = findWeapon(inventory, "handgun");
  const binocular = findWeapon(inventory, "binocular");
  const assignments = new Map<Weapon, WeaponMagazines>();

  const setPrimary = (weapon: Weapon | undefined, magazine: Magazine | undefined) => {
    if (weapon && magazine) assignments.set(weapon, { primary: magazine });
  };

  if (binocular) setPrimary(binocular, takeMagazine(pool, looksLikeBinocularMagazine));
  if (launcher) setPrimary(launcher, takeMagazine(pool, looksLikeLauncherMagazine));
  if (handgun) setPrimary(handgun, takeMagazine(pool, looksLikeHandgunMagazine));

  if (primary) {
    const primaryMag = takeMagazine(
      pool,
      (magazine) => !looksLikeGlMagazine(magazine) && !looksLikeLauncherMagazine(magazine),
    );
    const secondaryMag = takeMagazine(pool, looksLikeGlMagazine);
    assignments.set(primary, { primary: primaryMag, secondary: secondaryMag });
  }

  // Modded class names do not always expose their role. Preserve them by filling
  // any remaining empty weapon magazine slots in canonical getUnitLoadout order.
  for (const weapon of [primary, launcher, handgun, binocular]) {
    if (!weapon || pool.length === 0) continue;
    const current = assignments.get(weapon) ?? {};
    if (!current.primary) current.primary = pool.shift();
    else if (weapon === primary && !current.secondary) current.secondary = pool.shift();
    assignments.set(weapon, current);
  }

  return assignments;
}

type AssignedSlot = "map" | "gps" | "radio" | "compass" | "watch" | "nvg";

/** Index of each slot inside the assigned items array `getUnitLoadout` returns. */
const ASSIGNED_SLOT_INDEX: Record<AssignedSlot, number> = {
  map: 0,
  gps: 1,
  radio: 2,
  compass: 3,
  watch: 4,
  nvg: 5,
};

/** `assignedItems` walks the slots in this order, which is not the loadout order. */
const ASSIGNED_REPORT_ORDER: AssignedSlot[] = ["map", "compass", "watch", "radio", "gps", "nvg"];

/**
 * Recordings only carry a class name, so the slot has to be recognised from that
 * and from the label derived from it. Modded gear rarely spells its role out —
 * a TFAR radio is `TFAR_anprc152_1`, a cTab GPS is `ItemAndroid` — so match the
 * families that actually turn up. Order matters: TFAR's MicroDAGR is a GPS even
 * though its class carries the radio prefix.
 */
const ASSIGNED_SLOT_PATTERNS: Array<[AssignedSlot, RegExp]> = [
  ["gps", /gps|dagr|ctab|android|tablet|garmin|uav|terminal|\bbft\b/],
  ["nvg", /nvg|goggle|night.?vision|nachtsicht|\bpvs\b|pvs-?\d|gpnvg|hmnvs|\b\dpn\d/],
  ["radio", /radio|funk|\bprc\b|prc-?\d|acre|tfar|anarc|rt.?1523|sem.?\d|fadak|pnr.?1000|rf.?7800|mr.?[36]000|harris/],
  ["compass", /compass|kompass|bussole/],
  ["watch", /watch|altimeter|chrono|\buhr\b/],
  ["map", /(?:^|[_ ])map(?:$|[_ ])|itemmap/],
];

/**
 * `assignedItems` also reports the binocular, which belongs to the loadout's own
 * binocular slot and to `addWeapon`, never to an assigned item slot. Anything the
 * snapshot already lists as a weapon is filtered on identity; the pattern only
 * covers recordings whose weapon list is empty.
 */
const BINOCULAR_PATTERN = /binocular|\bbino\b|rangefinder|designator|vector ?21|yardage|lerca/;

interface AssignedEntry {
  class: string;
  count: number;
  slot?: AssignedSlot;
}

function assignedEntries(inventory: InventorySnapshot): AssignedEntry[] {
  const weaponClasses = new Set(
    (inventory.weapons ?? []).map((weapon) => weapon.class).filter(Boolean),
  );
  const entries: AssignedEntry[] = [];
  for (const item of inventory.assignedItems ?? []) {
    if (!item.class || weaponClasses.has(item.class)) continue;
    const text = `${item.class} ${gearItemName(item)}`.toLowerCase();
    if (BINOCULAR_PATTERN.test(text)) continue;
    entries.push({
      class: arsenalClass(item.class),
      count: itemCount(item),
      slot: ASSIGNED_SLOT_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0],
    });
  }
  return entries;
}

function assignedItemSlots(inventory: InventorySnapshot): string[] {
  const entries = assignedEntries(inventory);
  const slots = ["", "", "", "", "", ""];
  const unplaced: AssignedEntry[] = [];

  for (const entry of entries) {
    const index = entry.slot === undefined ? -1 : ASSIGNED_SLOT_INDEX[entry.slot];
    if (index >= 0 && !slots[index]) slots[index] = entry.class;
    else unplaced.push(entry);
  }

  // Unrecognised gear keeps the order `assignedItems` reported it in, and that
  // order follows the engine's slots, so fill forwards from the last slot a
  // recognised item claimed instead of dropping it into the first empty index.
  let cursor = 0;
  const freeSlot = (from: number): number =>
    ASSIGNED_REPORT_ORDER.findIndex(
      (slot, order) => order >= from && !slots[ASSIGNED_SLOT_INDEX[slot]],
    );
  for (const entry of entries) {
    if (!unplaced.includes(entry)) {
      cursor = Math.max(cursor, ASSIGNED_REPORT_ORDER.indexOf(entry.slot as AssignedSlot) + 1);
      continue;
    }
    const forward = freeSlot(cursor);
    const order = forward >= 0 ? forward : freeSlot(0);
    if (order < 0) continue;
    slots[ASSIGNED_SLOT_INDEX[ASSIGNED_REPORT_ORDER[order]]] = entry.class;
    cursor = order + 1;
  }
  return slots;
}

/**
 * ACE Arsenal exports a CBA extended loadout: [getUnitLoadout array, extended info].
 * Empty array metadata is accepted by CBA and keeps this parseSimpleArray-compatible.
 */
export function exportAceArsenal(inventory: InventorySnapshot): string {
  const magazines = new Map((inventory.magazines ?? []).map((magazine) => [magazine.class, magazine]));
  const primary = findWeapon(inventory, "primary");
  const launcher = findWeapon(inventory, "launcher", "secondary");
  const handgun = findWeapon(inventory, "handgun");
  const binocular = findWeapon(inventory, "binocular");
  const loadedByWeapon = assignLoadedMagazines(inventory);
  const weaponLoadout = (weapon: Weapon | undefined): unknown[] => {
    const loaded = weapon && loadedByWeapon.get(weapon);
    return weaponArray(weapon, loaded?.primary, loaded?.secondary);
  };
  const loadout = [
    weaponLoadout(primary),
    weaponLoadout(launcher),
    weaponLoadout(handgun),
    containerArray(inventory.uniform, magazines),
    containerArray(inventory.vest, magazines),
    containerArray(inventory.backpack, magazines),
    inventory.headgear?.class ? arsenalClass(inventory.headgear.class) : "",
    inventory.goggles?.class ? arsenalClass(inventory.goggles.class) : "",
    weaponLoadout(binocular),
    assignedItemSlots(inventory),
  ];
  return sqfValue([loadout, []]);
}
