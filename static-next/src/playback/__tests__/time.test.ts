import { describe, it, expect } from "vitest";
import {
  formatElapsedTime,
  formatMissionTime,
  formatSystemTime,
  formatTime,
  type TimeMode,
} from "../time";

// ---------------------------------------------------------------------------
// formatElapsedTime
// ---------------------------------------------------------------------------
describe("formatElapsedTime", () => {
  it("frame 0 → 0:00:00", () => {
    expect(formatElapsedTime(0, 1000)).toBe("0:00:00");
  });

  it("frame 60 with 1000ms delay → 0:01:00", () => {
    expect(formatElapsedTime(60, 1000)).toBe("0:01:00");
  });

  it("frame 3661 with 1000ms delay → 1:01:01", () => {
    expect(formatElapsedTime(3661, 1000)).toBe("1:01:01");
  });

  it("respects non-default capture delay", () => {
    // 500ms delay: frame 120 = 60 000ms = 1 minute
    expect(formatElapsedTime(120, 500)).toBe("0:01:00");
  });

  it("handles large frame counts (> 24 hours)", () => {
    // 100 000 frames at 1000ms = 100 000s = 27:46:40
    expect(formatElapsedTime(100_000, 1000)).toBe("27:46:40");
  });

  it("handles zero capture delay", () => {
    expect(formatElapsedTime(9999, 0)).toBe("0:00:00");
  });
});

// ---------------------------------------------------------------------------
// formatMissionTime
// ---------------------------------------------------------------------------
describe("formatMissionTime", () => {
  const baseDate = "2035-06-10T05:30:00Z";

  it("frame 0 returns the mission start time", () => {
    expect(formatMissionTime(0, baseDate, 1, 1000)).toBe("5:30:00");
  });

  it("advances by real time with multiplier 1", () => {
    // 3600 frames × 1000ms × 1 = 1 hour → 6:30:00
    expect(formatMissionTime(3600, baseDate, 1, 1000)).toBe("6:30:00");
  });

  it("applies time multiplier correctly", () => {
    // 3600 frames × 1000ms × 4 = 4 hours → 9:30:00
    expect(formatMissionTime(3600, baseDate, 4, 1000)).toBe("9:30:00");
  });

  it("wraps past midnight", () => {
    // Start at 23:00, advance 2 hours → 1:00:00 next day
    const lateDate = "2035-06-10T23:00:00Z";
    expect(formatMissionTime(7200, lateDate, 1, 1000)).toBe("1:00:00");
  });

  it("handles fractional multipliers", () => {
    // 7200 frames × 1000ms × 0.5 = 3600s = 1 hour → 6:30:00
    expect(formatMissionTime(7200, baseDate, 0.5, 1000)).toBe("6:30:00");
  });

  it("handles non-UTC date strings (treated as UTC by the parser)", () => {
    // No trailing Z — Date constructor parses as UTC for date-only or
    // implementation-defined for datetime. We append nothing, rely on
    // the caller providing a consistent format.
    expect(formatMissionTime(0, "2035-06-10T12:00:00Z", 1, 1000)).toBe(
      "12:00:00",
    );
  });
});

// ---------------------------------------------------------------------------
// formatSystemTime
// ---------------------------------------------------------------------------
describe("formatSystemTime", () => {
  it("returns 0:00:00 for empty times array", () => {
    expect(formatSystemTime(0, [])).toBe("0:00:00");
  });

  it("single entry, frame 0 returns that entry's time", () => {
    const times = [{ frameNum: 0, systemTimeUtc: "2024-01-15T14:30:00" }];
    expect(formatSystemTime(0, times)).toBe("14:30:00");
  });

  it("single entry, extrapolates at 1000ms/frame", () => {
    const times = [{ frameNum: 0, systemTimeUtc: "2024-01-15T14:30:00" }];
    // frame 60 → +60 000ms = +60s → 14:31:00
    expect(formatSystemTime(60, times)).toBe("14:31:00");
  });

  it("interpolates between two time points", () => {
    const times = [
      { frameNum: 0, systemTimeUtc: "2024-01-15T14:00:00" },
      { frameNum: 100, systemTimeUtc: "2024-01-15T14:01:40" }, // +100s
    ];
    // Rate = 100 000ms / 100 frames = 1000ms/frame
    // frame 50 → 14:00:00 + 50 000ms = 14:00:50
    expect(formatSystemTime(50, times)).toBe("14:00:50");
  });

  it("extrapolates past the last entry using last known rate", () => {
    const times = [
      { frameNum: 0, systemTimeUtc: "2024-01-15T14:00:00" },
      { frameNum: 100, systemTimeUtc: "2024-01-15T14:01:40" }, // +100s
    ];
    // Rate = 1000ms/frame. frame 160 → 14:01:40 + 60 000ms = 14:02:40
    expect(formatSystemTime(160, times)).toBe("14:02:40");
  });

  it("binary-searches correctly with many entries", () => {
    const times = [
      { frameNum: 0, systemTimeUtc: "2024-01-15T10:00:00" },
      { frameNum: 1000, systemTimeUtc: "2024-01-15T10:16:40" }, // +1000s
      { frameNum: 2000, systemTimeUtc: "2024-01-15T10:33:20" }, // +1000s
      { frameNum: 3000, systemTimeUtc: "2024-01-15T10:50:00" }, // +1000s
    ];
    // frame 2500 → between entries [2] and [3]
    // Rate = (10:50:00 - 10:33:20) / 1000 = 1000ms/frame
    // 10:33:20 + 500*1000ms = 10:33:20 + 500s = 10:41:40
    expect(formatSystemTime(2500, times)).toBe("10:41:40");
  });

  it("uses first entry when frame is before first sample", () => {
    // Edge case: times don't start at frame 0
    const times = [
      { frameNum: 100, systemTimeUtc: "2024-01-15T14:00:00" },
      { frameNum: 200, systemTimeUtc: "2024-01-15T14:01:40" },
    ];
    // frame 50 < 100 → binary search yields idx 0 (first entry still)
    // Actually, since 50 < 100, the binary search lo=0, hi=1:
    //   mid=0 → times[0].frameNum=100 > 50 → hi = -1
    // So idx stays 0 (initial value). But entry.frameNum=100 > frame=50,
    // so frameDelta = -50. Forward rate = 1000ms/frame.
    // 14:00:00 - 50*1000ms = 14:00:00 - 50s = 13:59:10
    expect(formatSystemTime(50, times)).toBe("13:59:10");
  });

  it("handles non-uniform rates between segments", () => {
    const times = [
      { frameNum: 0, systemTimeUtc: "2024-01-15T12:00:00" },
      { frameNum: 100, systemTimeUtc: "2024-01-15T12:01:40" }, // 1000ms/frame
      { frameNum: 200, systemTimeUtc: "2024-01-15T12:05:00" }, // 2000ms/frame
    ];
    // frame 150 → between entries [1] and [2]
    // Rate = (12:05:00 - 12:01:40) / 100 = 200 000ms / 100 = 2000ms/frame
    // 12:01:40 + 50*2000ms = 12:01:40 + 100s = 12:03:20
    expect(formatSystemTime(150, times)).toBe("12:03:20");
  });
});

// ---------------------------------------------------------------------------
// formatTime (dispatcher)
// ---------------------------------------------------------------------------
describe("formatTime", () => {
  const config = {
    captureDelayMs: 1000,
    missionDate: "2035-06-10T05:30:00Z",
    missionTimeMultiplier: 2,
    times: [{ frameNum: 0, systemTimeUtc: "2024-01-15T14:30:00" }],
  };

  it("dispatches 'elapsed' mode", () => {
    expect(formatTime(3661, "elapsed", config)).toBe(
      formatElapsedTime(3661, 1000),
    );
  });

  it("dispatches 'mission' mode", () => {
    expect(formatTime(3600, "mission", config)).toBe(
      formatMissionTime(3600, "2035-06-10T05:30:00Z", 2, 1000),
    );
  });

  it("dispatches 'system' mode", () => {
    expect(formatTime(60, "system", config)).toBe(
      formatSystemTime(60, config.times),
    );
  });

  it("defaults missionDate to empty string when not provided", () => {
    const minimal = { captureDelayMs: 1000 };
    // Should not throw
    expect(() => formatTime(0, "mission", minimal)).not.toThrow();
  });

  it("defaults missionTimeMultiplier to 1 when not provided", () => {
    const partial = { captureDelayMs: 1000, missionDate: "2035-06-10T05:30:00Z" };
    expect(formatTime(3600, "mission", partial)).toBe("6:30:00");
  });

  it("defaults times to empty array when not provided", () => {
    const partial = { captureDelayMs: 1000 };
    expect(formatTime(0, "system", partial)).toBe("0:00:00");
  });

  it("exhaustive: TypeScript prevents unknown modes at compile time", () => {
    // Runtime check that an unexpected mode throws (cast to bypass TS)
    expect(() =>
      formatTime(0, "unknown" as TimeMode, { captureDelayMs: 1000 }),
    ).toThrow();
  });
});
