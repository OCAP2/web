import { describe, it, expect } from "vitest";

import {
  EXPLOSION_MAP_SECONDS,
  EXPLOSION_PEAK_ALPHA,
  explosionAlpha,
  explosionColor,
  explosionLifetimeFrames,
} from "../explosions";
import { EventManager } from "../eventManager";
import { ExplosionEvent } from "../events/supportEvents";
import type { ExplosionPayload } from "../../data/types";

function payload(over: Partial<ExplosionPayload> = {}): ExplosionPayload {
  return {
    x: 100,
    y: 200,
    ammo: "Sh_155mm_AMOS",
    name: "155mm HE",
    radius: 28,
    power: 180,
    firerId: 7,
    vehicleId: -1,
    side: "WEST",
    source: "projectile",
    ...over,
  };
}

describe("explosionLifetimeFrames", () => {
  it("derives the lifetime from the recording's capture delay", () => {
    expect(explosionLifetimeFrames(1000)).toBe(EXPLOSION_MAP_SECONDS);
    // A 2 s capture delay halves the number of frames the same wall-clock
    // lifetime spans.
    expect(explosionLifetimeFrames(2000)).toBe(EXPLOSION_MAP_SECONDS / 2);
  });

  it("falls back to seconds when the capture delay is missing or nonsense", () => {
    expect(explosionLifetimeFrames(0)).toBe(EXPLOSION_MAP_SECONDS);
    expect(explosionLifetimeFrames(Number.NaN)).toBe(EXPLOSION_MAP_SECONDS);
  });

  it("never returns zero, which would make every blast invisible", () => {
    expect(explosionLifetimeFrames(600000)).toBeGreaterThanOrEqual(1);
  });
});

describe("explosionAlpha", () => {
  const lifetime = explosionLifetimeFrames(1000);

  it("is at full strength on the frame the blast happens", () => {
    expect(explosionAlpha(100, 100, lifetime)).toBe(EXPLOSION_PEAK_ALPHA);
  });

  it("is nothing before the blast and after its lifetime", () => {
    expect(explosionAlpha(99, 100, lifetime)).toBe(0);
    expect(explosionAlpha(100 + lifetime, 100, lifetime)).toBe(0);
  });

  it("fades monotonically over the tail", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let age = 0; age < lifetime; age += 1) {
      const alpha = explosionAlpha(100 + age, 100, lifetime);
      expect(alpha).toBeLessThanOrEqual(previous);
      previous = alpha;
    }
    expect(previous).toBeLessThan(EXPLOSION_PEAK_ALPHA);
  });
});

describe("explosionColor", () => {
  it("grades by blast size so a satchel does not read like a grenade", () => {
    const grenade = explosionColor(5);
    const rocket = explosionColor(12);
    const shell = explosionColor(28);
    expect(new Set([grenade, rocket, shell]).size).toBe(3);
  });

  it("returns a bare hex without the leading hash, as the marker route expects", () => {
    expect(explosionColor(28)).toMatch(/^[0-9a-f]{6}$/);
    expect(explosionColor(Number.NaN)).toMatch(/^[0-9a-f]{6}$/);
  });
});

describe("EventManager explosion index", () => {
  it("returns only the blasts whose lifetime covers the frame", () => {
    const manager = new EventManager();
    manager.addEvent(new ExplosionEvent(10, 1, payload()));
    manager.addEvent(new ExplosionEvent(20, 2, payload({ x: 500 })));

    expect(manager.getActiveExplosions(10, 6).map((e) => e.id)).toEqual([1]);
    // Still inside the first blast's six frames, and the second has not happened.
    expect(manager.getActiveExplosions(15, 6).map((e) => e.id)).toEqual([1]);
    // The first has expired by 16; the second is drawn from 20.
    expect(manager.getActiveExplosions(16, 6)).toEqual([]);
    expect(manager.getActiveExplosions(21, 6).map((e) => e.id)).toEqual([2]);
  });

  it("keeps blasts in the event log as well as the map index", () => {
    const manager = new EventManager();
    const blast = new ExplosionEvent(10, 1, payload());
    manager.addEvent(blast);

    // Unlike the Zeus camera and entity events, an explosion is a readable
    // mission event and must survive into the feed.
    expect(manager.getAll()).toContain(blast);
    expect(manager.getEventsAtFrame(10)).toContain(blast);
    expect(manager.getExplosions()).toEqual([blast]);
  });

  it("clears the index with the rest of the events", () => {
    const manager = new EventManager();
    manager.addEvent(new ExplosionEvent(10, 1, payload()));
    manager.clear();

    expect(manager.getExplosions()).toEqual([]);
    expect(manager.getActiveExplosions(10, 6)).toEqual([]);
  });
});
