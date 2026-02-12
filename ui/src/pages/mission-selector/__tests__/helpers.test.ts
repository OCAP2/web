import { describe, it, expect } from "vitest";
import { getMapColor, hashColor, FALLBACK_PALETTE } from "../helpers";

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
