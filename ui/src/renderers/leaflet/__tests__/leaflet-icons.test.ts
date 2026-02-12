import { describe, it, expect } from "vitest";
import {
  sideStyle,
  entityIcon,
  hitIcon,
  iconSize,
  getEntityIcon,
  ICON_STATES,
} from "../leaflet-icons";

// --------------- sideStyle ---------------

describe("sideStyle", () => {
  it("returns blufor class and colour for WEST", () => {
    const s = sideStyle("WEST");
    expect(s.cssClass).toBe("blufor");
    expect(s.colour).toBe("#004d99");
  });

  it("returns opfor class and colour for EAST", () => {
    const s = sideStyle("EAST");
    expect(s.cssClass).toBe("opfor");
    expect(s.colour).toBe("#800000");
  });

  it("returns ind class and colour for GUER", () => {
    const s = sideStyle("GUER");
    expect(s.cssClass).toBe("ind");
    expect(s.colour).toBe("#007f00");
  });

  it("returns civ class and colour for CIV", () => {
    const s = sideStyle("CIV");
    expect(s.cssClass).toBe("civ");
    expect(s.colour).toBe("#650080");
  });

  it("returns unknown fallback for unrecognised side", () => {
    const s = sideStyle("SOMETHING" as any);
    expect(s.cssClass).toBe("unknown");
    expect(s.colour).toBe("#b29900");
  });
});

// --------------- iconSize ---------------

describe("iconSize", () => {
  it("returns [16, 16] for man", () => {
    expect(iconSize("man")).toEqual([16, 16]);
  });

  it("returns [24, 24] for car", () => {
    expect(iconSize("car")).toEqual([24, 24]);
  });

  it("returns [28, 28] for tank", () => {
    expect(iconSize("tank")).toEqual([28, 28]);
  });

  it("returns [28, 28] for apc", () => {
    expect(iconSize("apc")).toEqual([28, 28]);
  });

  it("returns [28, 28] for truck", () => {
    expect(iconSize("truck")).toEqual([28, 28]);
  });

  it("returns [28, 28] for ship", () => {
    expect(iconSize("ship")).toEqual([28, 28]);
  });

  it("returns [32, 32] for heli", () => {
    expect(iconSize("heli")).toEqual([32, 32]);
  });

  it("returns [32, 32] for plane", () => {
    expect(iconSize("plane")).toEqual([32, 32]);
  });

  it("returns [20, 20] for parachute", () => {
    expect(iconSize("parachute")).toEqual([20, 20]);
  });

  it("returns [20, 20] for staticWeapon", () => {
    expect(iconSize("staticWeapon")).toEqual([20, 20]);
  });

  it("returns [20, 20] for staticMortar", () => {
    expect(iconSize("staticMortar")).toEqual([20, 20]);
  });

  it("returns [28, 28] for unknown", () => {
    expect(iconSize("unknown")).toEqual([28, 28]);
  });

  it("falls back to unknown size for unrecognised type", () => {
    expect(iconSize("submarine")).toEqual([28, 28]);
  });
});

// --------------- getEntityIcon ---------------

describe("getEntityIcon", () => {
  it("returns a valid L.Icon for a known type and state", () => {
    const icon = getEntityIcon("man", "blufor");
    expect(icon).toBeDefined();
    expect(icon.options.iconUrl).toBe("/images/markers/man/blufor.svg");
    expect(icon.options.iconSize).toEqual([16, 16]);
    expect(icon.options.className).toBe("animation");
  });

  it("returns correct icon for tank/opfor", () => {
    const icon = getEntityIcon("tank", "opfor");
    expect(icon.options.iconUrl).toBe("/images/markers/tank/opfor.svg");
    expect(icon.options.iconSize).toEqual([28, 28]);
  });

  it("returns correct icon for heli/dead", () => {
    const icon = getEntityIcon("heli", "dead");
    expect(icon.options.iconUrl).toBe("/images/markers/heli/dead.svg");
    expect(icon.options.iconSize).toEqual([32, 32]);
  });

  it("returns correct icon for car/hit", () => {
    const icon = getEntityIcon("car", "hit");
    expect(icon.options.iconUrl).toBe("/images/markers/car/hit.svg");
    expect(icon.options.iconSize).toEqual([24, 24]);
  });

  it("returns correct icon for plane/follow", () => {
    const icon = getEntityIcon("plane", "follow");
    expect(icon.options.iconUrl).toBe("/images/markers/plane/follow.svg");
  });

  it("returns correct icon for staticMortar/unconscious", () => {
    const icon = getEntityIcon("staticMortar", "unconscious");
    expect(icon.options.iconUrl).toBe(
      "/images/markers/static-mortar/unconscious.svg",
    );
    expect(icon.options.iconSize).toEqual([20, 20]);
  });

  it("falls back to unknown type for unrecognised iconType", () => {
    const icon = getEntityIcon("submarine", "blufor");
    expect(icon.options.iconUrl).toBe("/images/markers/unknown/blufor.svg");
    expect(icon.options.iconSize).toEqual([28, 28]);
  });

  it("falls back to unknown state for unrecognised state", () => {
    const icon = getEntityIcon("man", "nonexistent");
    expect(icon.options.iconUrl).toBe("/images/markers/man/unknown.svg");
  });

  it("generates icons for all entity types and all states", () => {
    const types = [
      "man",
      "car",
      "tank",
      "apc",
      "truck",
      "ship",
      "heli",
      "plane",
      "parachute",
      "staticWeapon",
      "staticMortar",
      "unknown",
    ];
    for (const type of types) {
      for (const state of ICON_STATES) {
        const icon = getEntityIcon(type, state);
        expect(icon).toBeDefined();
        expect(icon.options.iconUrl).toContain(`${state}.svg`);
        expect(icon.options.className).toBe("animation");
      }
    }
  });

  it("sets iconAnchor to centre of the icon", () => {
    const icon = getEntityIcon("heli", "blufor");
    expect(icon.options.iconAnchor).toEqual([16, 16]); // half of [32, 32]

    const iconMan = getEntityIcon("man", "opfor");
    expect(iconMan.options.iconAnchor).toEqual([8, 8]); // half of [16, 16]
  });
});

// --------------- entityIcon (side + alive state API) ---------------

describe("entityIcon", () => {
  it("returns alive icon with full opacity for alive state", () => {
    const result = entityIcon("man", "WEST", 1);
    expect(result.opacity).toBe(1);
    expect(result.icon.options.iconUrl).toBe("/images/markers/man/blufor.svg");
  });

  it("returns dead icon with reduced opacity for dead state", () => {
    const result = entityIcon("tank", "EAST", 0);
    expect(result.opacity).toBe(0.4);
    expect(result.icon.options.iconUrl).toBe("/images/markers/tank/dead.svg");
  });

  it("returns unconscious icon with full opacity for unconscious state", () => {
    const result = entityIcon("car", "GUER", 2);
    expect(result.opacity).toBe(1);
    expect(result.icon.options.iconUrl).toBe(
      "/images/markers/car/unconscious.svg",
    );
  });

  it("falls back to unknown type for unrecognised entity type", () => {
    const result = entityIcon("bicycle", "CIV", 1);
    expect(result.icon.options.iconUrl).toBe("/images/markers/unknown/civ.svg");
  });

  it("uses dead variant for null side (empty vehicle)", () => {
    const result = entityIcon("heli", null, 1);
    expect(result.icon.options.iconUrl).toBe("/images/markers/heli/dead.svg");
    expect(result.opacity).toBe(1);
  });

  it("uses dead variant for null side across all vehicle types", () => {
    const vehicleTypes = ["car", "tank", "apc", "truck", "ship", "heli", "plane"];
    for (const type of vehicleTypes) {
      const result = entityIcon(type, null, 1);
      expect(result.icon.options.iconUrl).toContain("dead.svg");
      expect(result.opacity).toBe(1);
    }
  });

  it("uses dead variant with reduced opacity for dead + null side", () => {
    const result = entityIcon("heli", null, 0);
    expect(result.icon.options.iconUrl).toBe("/images/markers/heli/dead.svg");
    expect(result.opacity).toBe(0.4);
  });
});

// --------------- hitIcon ---------------

describe("hitIcon", () => {
  it("returns hit variant icon for a known type", () => {
    const icon = hitIcon("man");
    expect(icon.options.iconUrl).toBe("/images/markers/man/hit.svg");
    expect(icon.options.iconSize).toEqual([16, 16]);
    expect(icon.options.className).toBe("animation");
  });

  it("falls back to unknown type for unrecognised entity type", () => {
    const icon = hitIcon("bicycle");
    expect(icon.options.iconUrl).toBe("/images/markers/unknown/hit.svg");
  });
});
