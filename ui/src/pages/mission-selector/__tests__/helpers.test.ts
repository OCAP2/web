import { describe, it, expect } from "vitest";
import { formatDuration, getMapColor, hashColor, FALLBACK_PALETTE } from "../helpers";

describe("formatDuration", () => {
  it("returns zero for non-positive values", () => {
    expect(formatDuration(0)).toBe("0m 0s");
    expect(formatDuration(-5)).toBe("0m 0s");
  });

  it("formats seconds only", () => {
    expect(formatDuration(45)).toBe("0m 45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("formats hours, minutes and seconds", () => {
    expect(formatDuration(3661)).toBe("1h 1m 1s");
    expect(formatDuration(8128)).toBe("2h 15m 28s");
  });

  it("rounds fractional seconds instead of showing decimals", () => {
    expect(formatDuration(8128.863000000000284)).toBe("2h 15m 29s");
    expect(formatDuration(12065.224987999999939)).toBe("3h 21m 5s");
  });

  it("rounds 0.5 up", () => {
    expect(formatDuration(90.5)).toBe("1m 31s");
  });

  it("carries over to the next unit when rounding up", () => {
    expect(formatDuration(59.6)).toBe("1m 0s");
    expect(formatDuration(3599.5)).toBe("1h 0m 0s");
  });
});

describe("getMapColor", () => {
  it("returns a hex color from the palette", () => {
    expect(FALLBACK_PALETTE).toContain(getMapColor("altis"));
    expect(FALLBACK_PALETTE).toContain(getMapColor("stratis"));
    expect(FALLBACK_PALETTE).toContain(getMapColor("tanoa"));
  });

  it("is deterministic", () => {
    expect(getMapColor("chernarus")).toBe(getMapColor("chernarus"));
    expect(getMapColor("takistan")).toBe(getMapColor("takistan"));
    expect(getMapColor("altis")).toBe(getMapColor("altis"));
  });

  it("returns a hex color for unknown maps", () => {
    expect(getMapColor("mycustommap")).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(getMapColor("sahrani")).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("hashColor", () => {
  it("returns a color from the fallback palette", () => {
    const results = ["foo", "bar", "baz", "qux"].map(hashColor);
    for (const c of results) {
      expect(FALLBACK_PALETTE).toContain(c);
    }
  });

  it("produces different colors for common Arma community maps", () => {
    const communityMaps = [
      "chernarus", "takistan", "sahrani", "panthera",
      "lythium", "lingor", "tem_anizay", "cup_chernarus_A3",
      "tem_kujari", "gm_weferlingen", "vt7", "dingor",
      "fallujah", "zargabad", "australia", "kunduz",
    ];
    const colors = communityMaps.map(hashColor);

    // At least 80% unique — with 20 palette entries and 16 maps,
    // a good hash should give near-perfect distribution
    const unique = new Set(colors).size;
    expect(unique).toBeGreaterThanOrEqual(Math.ceil(communityMaps.length * 0.8));
  });

  it("does not assign identical colors to short similar names", () => {
    // Names that might look similar to a weak hash
    const pairs = [
      ["map1", "map2"],
      ["isla", "isle"],
      ["east", "west"],
    ];
    for (const [a, b] of pairs) {
      expect(hashColor(a)).not.toBe(hashColor(b));
    }
  });

  it("palette has no duplicate entries", () => {
    const unique = new Set(FALLBACK_PALETTE);
    expect(unique.size).toBe(FALLBACK_PALETTE.length);
  });
});
