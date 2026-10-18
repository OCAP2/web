import type { WeatherPayload } from "./types";

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Accept a weather sample if it carries the core vanilla overcast reading.
 * Every other field is optional so a partial payload still plays, and a
 * recording made before this event existed is simply skipped.
 */
export function parseWeatherPayload(raw: unknown): WeatherPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const overcast = finiteNumber((raw as { overcast?: unknown }).overcast);
  if (overcast === undefined) return null;

  const payload: WeatherPayload = { overcast };
  const source = raw as Record<string, unknown>;
  const rain = finiteNumber(source.rain);
  if (rain !== undefined) payload.rain = rain;
  const fog = finiteNumber(source.fog);
  if (fog !== undefined) payload.fog = fog;
  const windSpeed = finiteNumber(source.windSpeed);
  if (windSpeed !== undefined) payload.windSpeed = windSpeed;
  const windDir = finiteNumber(source.windDir);
  if (windDir !== undefined) payload.windDir = windDir;
  const gusts = finiteNumber(source.gusts);
  if (gusts !== undefined) payload.gusts = gusts;
  const lightnings = finiteNumber(source.lightnings);
  if (lightnings !== undefined) payload.lightnings = lightnings;
  const humidity = finiteNumber(source.humidity);
  if (humidity !== undefined) payload.humidity = humidity;
  const waves = finiteNumber(source.waves);
  if (waves !== undefined) payload.waves = waves;
  const moonPhase = finiteNumber(source.moonPhase);
  if (moonPhase !== undefined) payload.moonPhase = moonPhase;
  const temperature = finiteNumber(source.temperature);
  if (temperature !== undefined) payload.temperature = temperature;
  if (typeof source.ace === "boolean") payload.ace = source.ace;
  return payload;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** Meteorological windDir: degrees the wind is coming FROM. */
export function compassFromDegrees(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 45) % 8];
}

export type MoonPhaseName = "new" | "crescent" | "quarter" | "gibbous" | "full";

/** `moonPhase` is illumination only (0 new, 1 full); it does not say waxing vs waning. */
export function moonPhaseName(phase: number): MoonPhaseName {
  if (phase < 0.03) return "new";
  if (phase < 0.35) return "crescent";
  if (phase < 0.65) return "quarter";
  if (phase < 0.97) return "gibbous";
  return "full";
}

export function moonPhaseEmoji(phase: number): string {
  if (phase < 0.125) return "🌑";
  if (phase < 0.375) return "🌒";
  if (phase < 0.625) return "🌓";
  if (phase < 0.875) return "🌔";
  return "🌕";
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
