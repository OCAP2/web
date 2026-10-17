/**
 * TFAR values that change how far a radio actually reaches. Baked defaults
 * match task-force-arma-3-radio (`TF_terrain_interception_coefficient` = 7,
 * `TFAR_globalRadioRangeCoef` = 1). A recording may stamp live CBA values
 * as a `tfarSettings` event; missing fields fall back to these.
 */
export interface TfarRadioPropagation {
  terrainInterceptionCoefficient: number;
  globalRadioRangeCoef: number;
  tfarLoaded?: boolean;
  source?: "cba" | "default" | string;
}

/**
 * ACRE values that change how far a radio actually reaches. These are not
 * TFAR's coefficient: ACRE scales only terrain/diffraction loss
 * (`acre_sys_core_terrainLoss`, 0–1, default 1) and picks a signal model
 * (`acre_sys_signal_signalModel`, default 2 = LOS Multipath). Arcade (0)
 * ignores terrain entirely. A recording may stamp live CBA values as an
 * `acreSettings` event; missing fields fall back to these.
 */
export interface AcreRadioPropagation {
  terrainLoss: number;
  signalModel: number;
  ignoreAntennaDirection?: boolean;
  acreLoaded?: boolean;
  source?: "cba" | "default" | string;
}

export const TFAR_DEFAULT_TERRAIN_COEFFICIENT = 7;
export const TFAR_DEFAULT_GLOBAL_RANGE_COEF = 1;
/** Head / "pilot" selection height TFAR uses instead of feet. */
export const TFAR_EYE_HEIGHT_METERS = 1.6;
export const TFAR_T_MIN_METERS = 10;
export const TFAR_T_MAX_METERS = 250;
export const TFAR_T_SEARCH_EPSILON = 10;
export const TFAR_DISTANCE_SCALE_METERS = 2000;

export const ACRE_DEFAULT_TERRAIN_LOSS = 1;
/** `SIGNAL_MODEL_LOS_MULTIPATH` — ACRE's CBA default. */
export const ACRE_DEFAULT_SIGNAL_MODEL = 2;
export const ACRE_SIGNAL_MODEL_ARCADE = 0;
export const ACRE_SIGNAL_MODEL_LOS_SIMPLE = 1;
export const ACRE_SIGNAL_MODEL_LOS_MULTIPATH = 2;
export const ACRE_SIGNAL_MODEL_ITM = 3;
/** Used when a radio snapshot has no TX frequency. Typical ACRE VHF. */
export const ACRE_DEFAULT_FREQUENCY_MHZ = 60;
/** ACRE's terrain-profile step in `los_simple::diffraction_loss`. */
export const ACRE_PROFILE_STEP_METERS = 7.5;

export const TFAR_DEFAULT_PROPAGATION: TfarRadioPropagation = {
  terrainInterceptionCoefficient: TFAR_DEFAULT_TERRAIN_COEFFICIENT,
  globalRadioRangeCoef: TFAR_DEFAULT_GLOBAL_RANGE_COEF,
  source: "default",
};

export const ACRE_DEFAULT_PROPAGATION: AcreRadioPropagation = {
  terrainLoss: ACRE_DEFAULT_TERRAIN_LOSS,
  signalModel: ACRE_DEFAULT_SIGNAL_MODEL,
  ignoreAntennaDirection: false,
  source: "default",
};

export function resolveTfarPropagation(
  partial?: Partial<TfarRadioPropagation> | null,
): TfarRadioPropagation {
  const coef = partial?.terrainInterceptionCoefficient;
  const rangeCoef = partial?.globalRadioRangeCoef;
  return {
    terrainInterceptionCoefficient:
      typeof coef === "number" && Number.isFinite(coef)
        ? coef
        : TFAR_DEFAULT_TERRAIN_COEFFICIENT,
    globalRadioRangeCoef:
      typeof rangeCoef === "number" && Number.isFinite(rangeCoef) && rangeCoef > 0
        ? rangeCoef
        : TFAR_DEFAULT_GLOBAL_RANGE_COEF,
    tfarLoaded: partial?.tfarLoaded,
    source: partial?.source ?? (partial ? "cba" : "default"),
  };
}

export function resolveAcrePropagation(
  partial?: Partial<AcreRadioPropagation> | null,
): AcreRadioPropagation {
  const loss = partial?.terrainLoss;
  const model = partial?.signalModel;
  return {
    terrainLoss:
      typeof loss === "number" && Number.isFinite(loss)
        ? Math.max(0, Math.min(1, loss))
        : ACRE_DEFAULT_TERRAIN_LOSS,
    signalModel:
      typeof model === "number" && Number.isFinite(model) && model >= 0 && model <= 3
        ? Math.trunc(model)
        : ACRE_DEFAULT_SIGNAL_MODEL,
    ignoreAntennaDirection: partial?.ignoreAntennaDirection,
    acreLoaded: partial?.acreLoaded,
    source: partial?.source ?? (partial ? "cba" : "default"),
  };
}

export function parseTfarSettingsPayload(raw: unknown): TfarRadioPropagation | undefined {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return resolveTfarPropagation(value as Partial<TfarRadioPropagation>);
}

export function parseAcreSettingsPayload(raw: unknown): AcreRadioPropagation | undefined {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return resolveAcrePropagation(value as Partial<AcreRadioPropagation>);
}

/** Arcade (0) ignores hills; terrainLoss 0 does the same for the other models. */
export function acreAppliesTerrain(propagation: AcreRadioPropagation): boolean {
  return propagation.signalModel !== ACRE_SIGNAL_MODEL_ARCADE && propagation.terrainLoss > 0;
}

export function extractRadioPropagation<T extends { type: string; payload?: unknown }>(
  events: T[],
): {
  events: T[];
  radioPropagation?: TfarRadioPropagation;
  acrePropagation?: AcreRadioPropagation;
} {
  let radioPropagation: TfarRadioPropagation | undefined;
  let acrePropagation: AcreRadioPropagation | undefined;
  const kept: T[] = [];
  for (const event of events) {
    if (event.type === "tfarSettings") {
      const parsed = parseTfarSettingsPayload(event.payload);
      if (parsed) radioPropagation = parsed;
      continue;
    }
    if (event.type === "acreSettings") {
      const parsed = parseAcreSettingsPayload(event.payload);
      if (parsed) acrePropagation = parsed;
      continue;
    }
    kept.push(event);
  }
  return { events: kept, radioPropagation, acrePropagation };
}
