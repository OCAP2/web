import type { UnitTraits } from "../../data/types";

/**
 * One line in the profile card's Traits tab. `labelKey` is a locale key, or the
 * custom trait's own name (t() hands an unknown key straight back). A "level"
 * field is a small integer the card resolves through `levelKeys`.
 */
export interface TraitField {
  id: string;
  labelKey: string;
  kind: "bool" | "number" | "level" | "text";
  value: unknown;
  levelKeys?: readonly string[];
  /** Non-1 coefficient values are shown as a multiplier. */
  multiplier?: boolean;
}

export interface TraitGroup {
  id: "engine" | "ace" | "coefficients" | "custom";
  titleKey: string;
  fields: TraitField[];
}

export interface TraitDelta extends TraitField {
  from: unknown;
  to: unknown;
}

const ACE_MEDIC_LEVELS = ["profile_none", "profile_trait_medic", "profile_trait_doctor"] as const;
const ACE_ENGINEER_LEVELS = [
  "profile_none",
  "profile_trait_engineer",
  "profile_trait_engineer_advanced",
] as const;

const ENGINE_FLAGS: ReadonlyArray<[keyof UnitTraits, string]> = [
  ["medic", "profile_trait_medic"],
  ["engineer", "profile_trait_engineer"],
  ["explosiveSpecialist", "profile_trait_eod"],
  ["uavHacker", "profile_trait_uav"],
];

const COEFFICIENTS: ReadonlyArray<[keyof UnitTraits, string]> = [
  ["loadCoef", "profile_trait_load_coef"],
  ["camouflageCoef", "profile_trait_camo_coef"],
  ["audibleCoef", "profile_trait_audible_coef"],
];

/**
 * Every trait the recording carries, grouped the way the tab shows them. Only
 * groups with at least one field are returned, so a vanilla recording has no
 * ACE section and a unit without custom traits has no custom section.
 */
export function traitGroups(traits: UnitTraits | undefined): TraitGroup[] {
  if (!traits) return [];
  const groups: TraitGroup[] = [];

  const engine: TraitField[] = [];
  for (const [key, labelKey] of ENGINE_FLAGS) {
    const value = traits[key];
    if (typeof value === "boolean") engine.push({ id: key, labelKey, kind: "bool", value });
  }
  if (engine.length) groups.push({ id: "engine", titleKey: "profile_traits_engine", fields: engine });

  const ace: TraitField[] = [];
  if (typeof traits.ace?.medic === "number") {
    ace.push({ id: "ace.medic", labelKey: "profile_trait_ace_medic", kind: "level", value: traits.ace.medic, levelKeys: ACE_MEDIC_LEVELS });
  }
  if (typeof traits.ace?.engineer === "number") {
    ace.push({ id: "ace.engineer", labelKey: "profile_trait_ace_engineer", kind: "level", value: traits.ace.engineer, levelKeys: ACE_ENGINEER_LEVELS });
  }
  if (typeof traits.ace?.eod === "boolean") {
    ace.push({ id: "ace.eod", labelKey: "profile_trait_ace_eod", kind: "bool", value: traits.ace.eod });
  }
  if (ace.length) groups.push({ id: "ace", titleKey: "profile_traits_ace", fields: ace });

  const coefficients: TraitField[] = [];
  for (const [key, labelKey] of COEFFICIENTS) {
    const value = traits[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      coefficients.push({ id: key, labelKey, kind: "number", value, multiplier: true });
    }
  }
  if (coefficients.length) groups.push({ id: "coefficients", titleKey: "profile_traits_coefficients", fields: coefficients });

  const custom: TraitField[] = [];
  for (const [name, value] of Object.entries(traits.custom ?? {})) {
    custom.push({
      id: `custom:${name}`,
      labelKey: name,
      kind: typeof value === "boolean" ? "bool" : typeof value === "number" ? "number" : "text",
      value,
    });
  }
  if (custom.length) groups.push({ id: "custom", titleKey: "profile_traits_custom", fields: custom });

  return groups;
}

/** The short label of a "level" field, as a locale key. */
export function traitLevelKey(field: TraitField, value: unknown): string | undefined {
  if (!field.levelKeys) return undefined;
  const index = Number(value);
  return field.levelKeys[Math.max(0, Math.min(field.levelKeys.length - 1, Number.isFinite(index) ? index : 0))];
}

/** A multiplier written the way the Arsenal and the editor show one: ×0.8, ×1.25. */
export function formatMultiplier(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `×${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/** Fields whose value differs between the two snapshots, in tab order. */
export function diffTraits(from: UnitTraits | undefined, to: UnitTraits | undefined): TraitDelta[] {
  const before = new Map<string, TraitField>();
  for (const group of traitGroups(from)) for (const field of group.fields) before.set(field.id, field);
  const result: TraitDelta[] = [];
  for (const group of traitGroups(to)) {
    for (const field of group.fields) {
      const prev = before.get(field.id);
      before.delete(field.id);
      if (prev?.value === field.value) continue;
      result.push({ ...field, from: prev?.value, to: field.value });
    }
  }
  for (const field of before.values()) result.push({ ...field, from: field.value, to: undefined });
  return result;
}
