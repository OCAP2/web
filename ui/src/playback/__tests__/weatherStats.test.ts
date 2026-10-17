import { describe, it, expect, beforeEach } from "vitest";
import { EventManager } from "../eventManager";
import { WeatherEvent } from "../events/weatherEvent";
import { ServerFpsEvent } from "../events/serverFpsEvent";
import { GameEvent } from "../events/gameEvent";
import type { WeatherPayload } from "../../data/types";

describe("weather samples", () => {
  let mgr: EventManager;

  beforeEach(() => {
    mgr = new EventManager();
  });

  const sample = (overrides: Partial<WeatherPayload> = {}): WeatherPayload => ({
    overcast: 0.42,
    rain: 0.1,
    fog: 0.2,
    moonPhase: 0.81,
    ace: false,
    ...overrides,
  });

  const addSamples = (entries: [number, WeatherPayload][]) => {
    entries.forEach(([frame, payload], index) => {
      mgr.addEvent(new WeatherEvent(frame, index, payload));
    });
  };

  it("returns undefined when the recording carries no samples", () => {
    expect(mgr.getWeatherAt(0)).toBeUndefined();
    expect(mgr.getWeatherAt(9999)).toBeUndefined();
  });

  it("reports the first sample at frame 0", () => {
    addSamples([[0, sample({ overcast: 0.2 })]]);
    expect(mgr.getWeatherAt(0)?.overcast).toBe(0.2);
  });

  it("stays undefined while the playhead sits before the first sample", () => {
    addSamples([[10, sample()]]);
    expect(mgr.getWeatherAt(9)).toBeUndefined();
    expect(mgr.getWeatherAt(10)?.overcast).toBe(0.42);
  });

  it("returns the latest sample at or before the playhead", () => {
    addSamples([
      [0, sample({ overcast: 0.1, ace: false })],
      [60, sample({ overcast: 0.42, temperature: 16.3, ace: true })],
      [120, sample({ overcast: 0.9 })],
    ]);

    expect(mgr.getWeatherAt(0)?.overcast).toBe(0.1);
    expect(mgr.getWeatherAt(59)?.overcast).toBe(0.1);
    expect(mgr.getWeatherAt(60)?.temperature).toBe(16.3);
    expect(mgr.getWeatherAt(60)?.ace).toBe(true);
    expect(mgr.getWeatherAt(119)?.overcast).toBe(0.42);
    expect(mgr.getWeatherAt(120)?.overcast).toBe(0.9);
  });

  it("orders samples by frame regardless of insertion order", () => {
    addSamples([
      [120, sample({ overcast: 0.9 })],
      [0, sample({ overcast: 0.1 })],
      [60, sample({ overcast: 0.42 })],
    ]);

    expect(mgr.getWeatherAt(60)?.overcast).toBe(0.42);
    expect(mgr.getWeatherAt(120)?.overcast).toBe(0.9);
  });

  it("drops the samples on clear", () => {
    addSamples([[0, sample()]]);
    mgr.clear();
    expect(mgr.getWeatherAt(9999)).toBeUndefined();
  });

  it("keeps weather samples out of the events feed", () => {
    const killed = new GameEvent(15, "killed", 99);
    mgr.addEvent(new WeatherEvent(0, 1, sample()));
    mgr.addEvent(new ServerFpsEvent(0, 2, 40));
    mgr.addEvent(killed);

    expect(mgr.getAll()).toEqual([killed]);
    expect(mgr.getActiveEvents(9999)).toEqual([killed]);
    expect(mgr.getEventsAtFrame(0)).toEqual([]);
    expect(mgr.getWeatherAt(0)).toBeDefined();
  });
});
