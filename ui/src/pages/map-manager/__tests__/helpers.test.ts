import { describe, expect, it, vi, afterEach } from "vitest";
import {
  mapHue,
  formatWorldSize,
  formatFileSize,
  totalDiskMB,
  statusLabelKey,
  elapsed,
} from "../helpers";

describe("mapHue", () => {
  it("returns a number in [0..360)", () => {
    const h = mapHue("Altis");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it("returns the same value for the same input (deterministic)", () => {
    expect(mapHue("Stratis")).toBe(mapHue("Stratis"));
  });

  it("returns different values for different inputs", () => {
    expect(mapHue("Altis")).not.toBe(mapHue("Stratis"));
  });

  it("handles empty string", () => {
    const h = mapHue("");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
});

describe("formatWorldSize", () => {
  it("formats meters below 1000 as m", () => {
    expect(formatWorldSize(500)).toBe("500 m");
  });

  it("formats 1000+ as km with one decimal", () => {
    expect(formatWorldSize(1000)).toBe("1.0 km");
    expect(formatWorldSize(30720)).toBe("30.7 km");
  });

  it("formats exact km boundary", () => {
    expect(formatWorldSize(2000)).toBe("2.0 km");
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(51200)).toBe("50 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1_048_576)).toBe("1.0 MB");
    expect(formatFileSize(52_428_800)).toBe("50.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatFileSize(1_073_741_824)).toBe("1.0 GB");
    expect(formatFileSize(2_684_354_560)).toBe("2.5 GB");
  });
});

describe("totalDiskMB", () => {
  it("returns 0 for undefined", () => {
    expect(totalDiskMB(undefined)).toBe(0);
  });

  it("returns 0 for empty object", () => {
    expect(totalDiskMB({})).toBe(0);
  });

  it("sums file sizes", () => {
    expect(totalDiskMB({ "a.pmtiles": 100, "b.pmtiles": 200 })).toBe(300);
  });
});

describe("statusLabelKey", () => {
  it("maps complete", () => {
    expect(statusLabelKey("complete")).toBe("mm_status_complete");
  });

  it("maps incomplete to partial key", () => {
    expect(statusLabelKey("incomplete")).toBe("mm_status_partial");
  });

  it("maps unknown status to none key", () => {
    expect(statusLabelKey("none")).toBe("mm_status_none");
    expect(statusLabelKey("anything")).toBe("mm_status_none");
  });
});

describe("elapsed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty for empty start", () => {
    expect(elapsed("")).toBe("");
  });

  it("formats seconds between two dates", () => {
    const start = "2024-01-01T00:00:00Z";
    const end = "2024-01-01T00:00:45Z";
    expect(elapsed(start, end)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    const start = "2024-01-01T00:00:00Z";
    const end = "2024-01-01T00:03:25Z";
    expect(elapsed(start, end)).toBe("3m 25s");
  });

  it("formats hours and minutes", () => {
    const start = "2024-01-01T00:00:00Z";
    const end = "2024-01-01T02:15:00Z";
    expect(elapsed(start, end)).toBe("2h 15m");
  });

  it("returns empty for negative duration", () => {
    const start = "2024-01-01T01:00:00Z";
    const end = "2024-01-01T00:00:00Z";
    expect(elapsed(start, end)).toBe("");
  });

  it("uses Date.now when no end provided", () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2024-01-01T00:00:30Z").getTime(),
    );
    expect(elapsed("2024-01-01T00:00:00Z")).toBe("30s");
  });
});
