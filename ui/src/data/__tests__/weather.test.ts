import { describe, expect, it } from "vitest";
import {
  compassFromDegrees,
  formatPercent,
  moonPhaseEmoji,
  moonPhaseName,
  parseWeatherPayload,
} from "../weather";

describe("parseWeatherPayload", () => {
  it("requires a finite overcast reading", () => {
    expect(parseWeatherPayload(null)).toBeNull();
    expect(parseWeatherPayload([])).toBeNull();
    expect(parseWeatherPayload({ rain: 0.5 })).toBeNull();
    expect(parseWeatherPayload({ overcast: "0.4" })).toBeNull();
  });

  it("keeps optional ACE fields and drops malformed extras", () => {
    expect(parseWeatherPayload({
      overcast: 0.42,
      rain: 0.1,
      fog: 0.2,
      windSpeed: 3.4,
      windDir: 247,
      humidity: 0.68,
      moonPhase: 0.81,
      temperature: 16.3,
      ace: true,
      gusts: "nope",
    })).toEqual({
      overcast: 0.42,
      rain: 0.1,
      fog: 0.2,
      windSpeed: 3.4,
      windDir: 247,
      humidity: 0.68,
      moonPhase: 0.81,
      temperature: 16.3,
      ace: true,
    });
  });

  it("accepts a vanilla-only sample without temperature", () => {
    expect(parseWeatherPayload({ overcast: 0, rain: 0, fog: 0, ace: false })).toEqual({
      overcast: 0,
      rain: 0,
      fog: 0,
      ace: false,
    });
  });

  it("reads wind strength from the v2 telemetry spelling (windStr)", () => {
    expect(parseWeatherPayload({
      overcast: 0.42,
      rain: 0.1,
      fog: 0.2,
      windStr: 5.1,
      windDir: 247,
    })).toEqual({
      overcast: 0.42,
      rain: 0.1,
      fog: 0.2,
      windSpeed: 5.1,
      windDir: 247,
    });
  });

  it("prefers windSpeed when both spellings are present", () => {
    expect(parseWeatherPayload({ overcast: 0.3, windSpeed: 2.0, windStr: 9.9 })).toEqual({
      overcast: 0.3,
      windSpeed: 2.0,
    });
  });
});

describe("weather display helpers", () => {
  it("maps meteorological windDir to an 8-point compass", () => {
    expect(compassFromDegrees(0)).toBe("N");
    expect(compassFromDegrees(45)).toBe("NE");
    expect(compassFromDegrees(247)).toBe("SW");
    expect(compassFromDegrees(360)).toBe("N");
    expect(compassFromDegrees(-45)).toBe("NW");
  });

  it("names moon illumination without claiming waxing or waning", () => {
    expect(moonPhaseName(0)).toBe("new");
    expect(moonPhaseName(0.2)).toBe("crescent");
    expect(moonPhaseName(0.5)).toBe("quarter");
    expect(moonPhaseName(0.8)).toBe("gibbous");
    expect(moonPhaseName(1)).toBe("full");
    expect(moonPhaseEmoji(0)).toBe("🌑");
    expect(moonPhaseEmoji(1)).toBe("🌕");
  });

  it("formats 0-1 readings as percents", () => {
    expect(formatPercent(0.42)).toBe("42%");
    expect(formatPercent(0)).toBe("0%");
  });
});
