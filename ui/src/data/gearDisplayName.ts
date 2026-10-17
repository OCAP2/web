/**
 * How an item is labelled in the profile card.
 *
 * The recorder writes an English display name for every item. It reads config
 * through `getTextRaw`, so what it gets is the mod author's own text rather than
 * `getText`'s translation into the *recording server's* language — that is what
 * froze "Mapa" and "Obvaz (Elastický)" into a file shown to viewers in eight
 * locales. Where the config only held a `$STR_...` reference, which SQF cannot
 * read in another language, the recorder builds the name from the class with the
 * same derivation implemented below.
 *
 * So `gearItemName` almost always just returns what was recorded. The derivation
 * is the fallback for a recording that carries no name for an entry, and it is
 * kept in step with `OCAP_recorder_client_deriveNameFromClass` in the addon's
 * `fnc_installPlayerTrackingClients.sqf`.
 */

/** Mod families whose prefix says nothing about the item. Longest first. */
const MOD_PREFIXES = [
  "uk3cb_baf_",
  "immersion_",
  "rhsgref_",
  "rhsusf_",
  "rhssaf_",
  "uk3cb_",
  "acex_",
  "rksl_",
  "acre_",
  "tfar_",
  "ace_",
  "kat_",
  "cba_",
  "rhs_",
  "cup_",
  "tfr_",
];

/**
 * TFAR clones every carried handheld into a per-instance class that holds the
 * radio's channel state (`TFAR_anprc152_54`). The prototype is the radio.
 */
export function baseGearClass(className: string): string {
  return /^(?:tfar|tf)_/i.test(className) ? className.replace(/^(.+?)_\d+$/, "$1") : className;
}

/** A letter run followed by a digit run is a designator: `anprc152` -> `ANPRC152`. */
const DESIGNATOR = /^[A-Za-z]{2,6}\d{2,4}$/;

const cache = new Map<string, string>();

export function gearDisplayName(className: string | undefined): string {
  if (!className) return "";
  const cached = cache.get(className);
  if (cached !== undefined) return cached;

  let base = baseGearClass(className);
  const lower = base.toLowerCase();
  const prefix = MOD_PREFIXES.find((p) => lower.startsWith(p) && base.length > p.length);
  if (prefix) base = base.slice(prefix.length);

  // "ItemMap", "ItemGPS": the Item prefix is engine bookkeeping, not a name.
  base = base.replace(/^Item(?=[A-Z])/, "");

  // Split on separators and at every lowercase-to-uppercase step, but never
  // between a digit and a letter, so L85A2 stays a single word.
  const words = base
    .split(/[_\s-]+/)
    .flatMap((token) => token.split(/(?<=[a-z])(?=[A-Z])/))
    .filter(Boolean)
    .map((word) => {
      // A word the mod author already capitalised is left exactly as written.
      if (word !== word.toLowerCase()) return word;
      return DESIGNATOR.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1);
    });

  const name = words.join(" ") || className;
  cache.set(className, name);
  return name;
}

/** The name to show for a gear entry: what was recorded, else derived. */
export function gearItemName(item: { class?: string; name?: string } | undefined): string {
  const recorded = item?.name?.trim();
  if (recorded) return recorded;
  return gearDisplayName(item?.class);
}
