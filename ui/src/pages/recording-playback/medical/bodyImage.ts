import type { MedicalBodyPart } from "../../../data/types";

export const BODY_PART_IDS = ["head", "body", "leftarm", "rightarm", "leftleg", "rightleg"] as const;
export type BodyPartId = (typeof BODY_PART_IDS)[number];

/** ACE `BLOOD_LOSS_RED_THRESHOLD` / `DAMAGE_BLUE_THRESHOLD`. */
export const BLOOD_LOSS_RED_THRESHOLD = 0.5;
export const DAMAGE_BLUE_THRESHOLD = 0.8;
export const COLOR_STEPS = 10;

/**
 * ACE medical GUI palettes (`initSettings.inc.sqf`). Values are 0–1 like Arma
 * `colorText[]`, including the black slot used for an uninjured part.
 */
export const BLOOD_LOSS_COLORS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 0.0, 0.0, 1],
  [1.0, 0.95, 0.64, 1],
  [1.0, 0.87, 0.46, 1],
  [1.0, 0.8, 0.33, 1],
  [1.0, 0.72, 0.24, 1],
  [1.0, 0.63, 0.15, 1],
  [1.0, 0.54, 0.08, 1],
  [1.0, 0.43, 0.02, 1],
  [1.0, 0.3, 0.0, 1],
  [1.0, 0.0, 0.0, 1],
];

export const DAMAGE_COLORS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 0.0, 0.0, 1],
  [0.75, 0.95, 1.0, 1],
  [0.62, 0.86, 1.0, 1],
  [0.54, 0.77, 1.0, 1],
  [0.48, 0.67, 1.0, 1],
  [0.42, 0.57, 1.0, 1],
  [0.37, 0.47, 1.0, 1],
  [0.31, 0.36, 1.0, 1],
  [0.22, 0.23, 1.0, 1],
  [0.0, 0.0, 1.0, 1],
];

export const TINT = {
  tourniquet: "rgb(0, 0, 204)",
  fracture: "rgb(255, 0, 0)",
  splint: "rgb(0, 0, 255)",
  selected: "rgb(255, 255, 255)",
  chestSeal: "rgb(255, 242, 0)",
  airway: "rgb(26, 255, 255)",
  nasal: "rgb(46, 153, 245)",
  pulseOx: "rgb(77, 204, 204)",
  iv: "rgb(77, 153, 77)",
  pneumothorax: "rgb(255, 255, 255)",
} as const;

/** Approximate click targets on the facing A-pose figure, in percent. */
export const HIT_REGIONS: Record<BodyPartId, { left: number; top: number; width: number; height: number }> = {
  head: { left: 38, top: 1, width: 24, height: 15 },
  body: { left: 34, top: 15, width: 32, height: 32 },
  rightarm: { left: 14, top: 17, width: 22, height: 32 },
  leftarm: { left: 64, top: 17, width: 22, height: 32 },
  rightleg: { left: 28, top: 46, width: 22, height: 50 },
  leftleg: { left: 50, top: 46, width: 22, height: 50 },
};

export interface BodyOverlay {
  id: string;
  asset: string;
  tint: string;
}

export function isBodyPartId(part: string): part is BodyPartId {
  return (BODY_PART_IDS as readonly string[]).includes(part);
}

export function rgbaCss(color: readonly [number, number, number, number]): string {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
}

/** ACE `ceil(value / threshold * (steps - 1))` so any bleeding leaves white. */
export function colorIndex(value: number, threshold: number, steps = COLOR_STEPS): number {
  const fraction = Math.max(0, Math.min(1, value / threshold));
  return Math.ceil(fraction * (steps - 1));
}

export function parseBloodLoss(part: MedicalBodyPart): number {
  let loss = 0;
  for (const item of part.items) {
    if (item.kind !== "wound") continue;
    const match = item.detail?.match(/bleeding\s+([0-9.]+)/i);
    loss += match ? Number(match[1]) : 0.01;
  }
  return loss;
}

export function bodyPartFillColor(part: MedicalBodyPart | undefined, vanillaDamage?: number): string {
  if (!part) {
    if (typeof vanillaDamage === "number" && vanillaDamage > 0) {
      return rgbaCss(DAMAGE_COLORS[colorIndex(vanillaDamage, DAMAGE_BLUE_THRESHOLD)]);
    }
    return rgbaCss(DAMAGE_COLORS[0]);
  }
  const bloodLoss = parseBloodLoss(part);
  if (bloodLoss > 0) {
    return rgbaCss(BLOOD_LOSS_COLORS[colorIndex(bloodLoss, BLOOD_LOSS_RED_THRESHOLD)]);
  }
  const damage = part.damage ?? 0;
  if (damage > 0) {
    return rgbaCss(DAMAGE_COLORS[colorIndex(damage, DAMAGE_BLUE_THRESHOLD)]);
  }
  return rgbaCss(DAMAGE_COLORS[0]);
}

function hasKind(part: MedicalBodyPart | undefined, kind: string): boolean {
  return !!part?.items.some((item) => item.kind === kind);
}

function itemsNamed(part: MedicalBodyPart | undefined, kind: string): string[] {
  return (part?.items ?? []).filter((item) => item.kind === kind).map((item) => item.name);
}

function limbAsset(part: BodyPartId, suffix: "t" | "b" | "s"): string | undefined {
  switch (part) {
    case "leftarm":
      return `arm_left_${suffix}`;
    case "rightarm":
      return `arm_right_${suffix}`;
    case "leftleg":
      return `leg_left_${suffix}`;
    case "rightleg":
      return `leg_right_${suffix}`;
    default:
      return undefined;
  }
}

function ivAsset(part: BodyPartId): string | undefined {
  switch (part) {
    case "leftarm":
      return "leftarm_iv";
    case "rightarm":
      return "rightarm_iv";
    case "leftleg":
      return "leftleg_iv";
    case "rightleg":
      return "rightleg_iv";
    default:
      return undefined;
  }
}

function pulseOxAsset(part: BodyPartId): string | undefined {
  if (part === "leftarm") return "leftarm_pulseoximeter";
  if (part === "rightarm") return "rightarm_pulseoximeter";
  return undefined;
}

function katFlag(kat: Record<string, unknown> | undefined, key: string): boolean {
  const value = kat?.[key];
  return value === true || (typeof value === "number" && value > 0);
}

/**
 * Overlays ACE and KAT toggle on `updateBodyImage`, derived from the generic
 * `bodyParts` items plus KAT vitals that have no per-part item.
 */
export function overlaysForMedical(
  parts: MedicalBodyPart[],
  kat?: Record<string, unknown>,
  selected?: string | null,
): BodyOverlay[] {
  const byPart = new Map(parts.map((part) => [part.part, part]));
  const overlays: BodyOverlay[] = [];

  for (const partId of BODY_PART_IDS) {
    const part = byPart.get(partId);
    const bone = limbAsset(partId, "b");
    const tourniquet = limbAsset(partId, "t");
    if (bone && hasKind(part, "fracture")) {
      overlays.push({ id: `fracture:${partId}`, asset: bone, tint: TINT.fracture });
    } else if (bone && hasKind(part, "splint")) {
      overlays.push({ id: `splint:${partId}`, asset: bone, tint: TINT.splint });
    }
    // KAT hides the ACE tourniquet icon when a surgical block / REBOA is on the limb.
    if (tourniquet && hasKind(part, "tourniquet") && !hasKind(part, "reboa")) {
      overlays.push({ id: `tourniquet:${partId}`, asset: tourniquet, tint: TINT.tourniquet });
    }
    const iv = ivAsset(partId);
    if (iv && (hasKind(part, "ivAccess") || hasKind(part, "iv"))) {
      overlays.push({ id: `iv:${partId}`, asset: iv, tint: TINT.iv });
    }
    const pulseOx = pulseOxAsset(partId);
    if (pulseOx && hasKind(part, "monitor")) {
      overlays.push({ id: `pulseOx:${partId}`, asset: pulseOx, tint: TINT.pulseOx });
    }
  }

  const torso = byPart.get("body");
  const head = byPart.get("head");
  if (hasKind(torso, "chestSeal") || katFlag(kat, "chestSeal")) {
    overlays.push({ id: "chestSeal", asset: "torso_chestseal", tint: TINT.chestSeal });
  }
  if (
    katFlag(kat, "pneumothorax") ||
    katFlag(kat, "hemopneumothorax") ||
    katFlag(kat, "tensionPneumothorax")
  ) {
    overlays.push({ id: "pneumothorax", asset: "torso_pneumothorax", tint: TINT.pneumothorax });
  }
  if (hasKind(torso, "ivAccess") || hasKind(torso, "iv")) {
    overlays.push({ id: "io", asset: "torso_io", tint: TINT.iv });
  }

  const airwayNames = itemsNamed(head, "airway").join(" ").toLowerCase();
  if (airwayNames.includes("larynxtubus") || airwayNames.includes("king")) {
    overlays.push({ id: "kinglt", asset: "head_kinglt", tint: TINT.airway });
  } else if (airwayNames && !airwayNames.includes("head-tilt") && !airwayNames.includes("chin-lift")) {
    overlays.push({ id: "guedel", asset: "head_guedeltube", tint: TINT.airway });
  }
  if (hasKind(head, "oxygen") || itemsNamed(head, "oxygen").length) {
    overlays.push({ id: "nasal", asset: "head_nasalcannula", tint: TINT.nasal });
  }

  if (selected && isBodyPartId(selected)) {
    const selectedAsset =
      selected === "head"
        ? "head_s"
        : selected === "body"
          ? "torso_s"
          : limbAsset(selected, "s");
    if (selectedAsset) {
      overlays.push({ id: `selected:${selected}`, asset: selectedAsset, tint: TINT.selected });
    }
  }

  return overlays;
}
