import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatDuration, formatDate, relativeDate, getMapColor, hashColor, FALLBACK_PALETTE, isoToLocalInput, localInputToIso } from "../helpers";

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

describe("formatDate", () => {
  it("returns the original string for an invalid date", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  it("formats a valid date string", () => {
    const result = formatDate("2024-06-15", "en");
    expect(result).toContain("2024");
    expect(result).toContain("15");
  });
});

describe("relativeDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix "now" to 2024-06-15T12:00:00Z
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty string for an invalid date", () => {
    expect(relativeDate("not-a-date")).toBe("");
  });

  it("returns 'today' for today's date", () => {
    const result = relativeDate("2024-06-15T10:00:00Z");
    expect(result.toLowerCase()).toContain("today");
  });

  it("returns a string with 'days' for a date 3 days ago", () => {
    const result = relativeDate("2024-06-12T12:00:00Z");
    expect(result.toLowerCase()).toContain("day");
  });

  it("returns a string with 'weeks' for a date 14 days ago", () => {
    const result = relativeDate("2024-06-01T12:00:00Z");
    expect(result.toLowerCase()).toContain("week");
  });

  it("returns a string with 'months' for a date 60 days ago", () => {
    const result = relativeDate("2024-04-16T12:00:00Z");
    expect(result.toLowerCase()).toContain("month");
  });
});

describe("isoToLocalInput", () => {
  it("returns empty string for undefined", () => {
    expect(isoToLocalInput(undefined)).toBe("");
  });

  it("returns empty string for invalid date", () => {
    expect(isoToLocalInput("not-a-date")).toBe("");
  });

  it("returns a valid datetime-local string", () => {
    const result = isoToLocalInput("2024-06-15T12:00:00Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it("round-trips with localInputToIso to preserve the same instant", () => {
    const original = "2000-01-01T01:01:01.000+09:00";
    const expectedUtc = new Date(original).toISOString();
    const local = isoToLocalInput(original);
    const result = localInputToIso(local);
    expect(result).toBe(expectedUtc);
  });
});

describe("localInputToIso", () => {
  it("returns undefined for empty string", () => {
    expect(localInputToIso("")).toBeUndefined();
  });

  it("returns undefined for invalid date", () => {
    expect(localInputToIso("not-a-date")).toBeUndefined();
  });

  it("returns a UTC ISO string", () => {
    const result = localInputToIso("2024-06-15T12:00:00");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });
});
