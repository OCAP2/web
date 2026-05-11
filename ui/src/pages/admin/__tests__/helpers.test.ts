import { describe, it, expect } from "vitest";
import { isValidSteamId, hueFromSteamId, initialFromSteamId, STEAM_ID_RE } from "../helpers";

describe("admin/helpers", () => {
  describe("STEAM_ID_RE / isValidSteamId", () => {
    it("accepts canonical 17-digit Steam64 IDs starting with 7656119", () => {
      expect(isValidSteamId("76561198012345678")).toBe(true);
      expect(isValidSteamId("76561199000000000")).toBe(true);
      expect(isValidSteamId("76561197960265728")).toBe(true);
    });

    it("trims whitespace before validating", () => {
      expect(isValidSteamId("  76561198012345678  ")).toBe(true);
      expect(isValidSteamId("\t76561198012345678\n")).toBe(true);
    });

    it("rejects IDs that are too short, too long, or have the wrong prefix", () => {
      expect(isValidSteamId("")).toBe(false);
      expect(isValidSteamId("7656119")).toBe(false);
      expect(isValidSteamId("765611980123456789")).toBe(false); // 18 digits
      expect(isValidSteamId("12345678901234567")).toBe(false);
      expect(isValidSteamId("7666119801234567")).toBe(false); // 16 digits, wrong prefix
    });

    it("rejects non-numeric input", () => {
      expect(isValidSteamId("STEAM_0:1:12345678")).toBe(false);
      expect(isValidSteamId("https://steamcommunity.com/id/foo")).toBe(false);
      expect(isValidSteamId("76561198abcdef678")).toBe(false);
    });

    it("STEAM_ID_RE is exported and anchored", () => {
      expect(STEAM_ID_RE.source).toBe("^7656119\\d{10}$");
    });
  });

  describe("hueFromSteamId", () => {
    it("produces a deterministic hue in [0, 360)", () => {
      const h = hueFromSteamId("76561198012345678");
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    });

    it("yields the same hue for the same ID", () => {
      const id = "76561198000000001";
      expect(hueFromSteamId(id)).toBe(hueFromSteamId(id));
    });

    it("yields different hues for different IDs (sample)", () => {
      const a = hueFromSteamId("76561198000000001");
      const b = hueFromSteamId("76561198099999999");
      expect(a).not.toBe(b);
    });

    it("handles empty strings without crashing", () => {
      expect(hueFromSteamId("")).toBe(0);
    });
  });

  describe("initialFromSteamId", () => {
    it("returns the last character upper-cased", () => {
      expect(initialFromSteamId("76561198012345678")).toBe("8");
      expect(initialFromSteamId("76561198012345670")).toBe("0");
    });

    it("upper-cases alphabetic trailing chars", () => {
      expect(initialFromSteamId("steam-abc")).toBe("C");
    });
  });
});
