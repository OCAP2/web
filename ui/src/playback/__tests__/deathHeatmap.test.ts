import { describe, it, expect } from "vitest";

import {
  binDeathSites,
  busiestCell,
  deathBlobAlpha,
  deathBlobRadius,
  type DeathSite,
} from "../deathHeatmap";

const CELL = 60;

/** Sites arrive sorted by frame, which is what the scan relies on. */
function sites(...entries: [number, number, number][]): DeathSite[] {
  return entries
    .map(([frameNum, x, y]) => ({ frameNum, x, y }))
    .sort((a, b) => a.frameNum - b.frameNum);
}

describe("binDeathSites", () => {
  it("collapses deaths inside one cell into a single blob", () => {
    const cells = binDeathSites(sites([1, 10, 10], [2, 20, 20], [3, 30, 30]), 100, CELL);

    expect(cells.size).toBe(1);
    expect([...cells.values()][0].count).toBe(3);
  });

  it("keeps deaths in different cells apart", () => {
    const cells = binDeathSites(sites([1, 10, 10], [2, 500, 500]), 100, CELL);
    expect(cells.size).toBe(2);
  });

  it("puts the blob on the mean of its deaths, not the cell corner", () => {
    // Both inside the 0..60 cell. The mean is (20, 20); the corner is (0, 0).
    const cells = binDeathSites(sites([1, 10, 10], [2, 30, 30]), 100, CELL);
    const cell = [...cells.values()][0];

    expect(cell.x).toBeCloseTo(20, 6);
    expect(cell.y).toBeCloseTo(20, 6);
  });

  it("keeps the running mean exact across many deaths", () => {
    // The incremental mean must not drift from the plain average.
    const entries: [number, number, number][] = [];
    for (let i = 0; i < 20; i++) entries.push([i, i, i * 2]);
    const cells = binDeathSites(sites(...entries), 100, 1000);
    const cell = [...cells.values()][0];

    expect(cell.x).toBeCloseTo(9.5, 6);
    expect(cell.y).toBeCloseTo(19, 6);
  });

  // ── Bound to the playhead ──

  it("counts only deaths at or before the playhead", () => {
    const all = sites([10, 5, 5], [20, 5, 5], [30, 5, 5]);

    expect([...binDeathSites(all, 9, CELL).values()]).toEqual([]);
    expect([...binDeathSites(all, 10, CELL).values()][0].count).toBe(1);
    expect([...binDeathSites(all, 25, CELL).values()][0].count).toBe(2);
    expect([...binDeathSites(all, 999, CELL).values()][0].count).toBe(3);
  });

  it("stops at the first death past the playhead rather than scanning on", () => {
    // The early break is what keeps this cheap; a site after the break must not
    // be counted even though it would fall in the same cell.
    const all = sites([1, 5, 5], [500, 5, 5]);
    expect([...binDeathSites(all, 100, CELL).values()][0].count).toBe(1);
  });

  it("returns nothing for a recording with no deaths", () => {
    expect(binDeathSites([], 100, CELL).size).toBe(0);
  });

  it("handles negative coordinates without merging opposite cells", () => {
    // Math.floor, not truncation: -10 and 10 are different cells.
    const cells = binDeathSites(sites([1, -10, -10], [2, 10, 10]), 100, CELL);
    expect(cells.size).toBe(2);
  });

  it("refuses a nonsensical cell size rather than dividing by zero", () => {
    expect(binDeathSites(sites([1, 10, 10]), 100, 0).size).toBe(0);
    expect(binDeathSites(sites([1, 10, 10]), 100, Number.NaN).size).toBe(0);
  });
});

describe("busiestCell", () => {
  it("returns the largest count", () => {
    expect(busiestCell([{ x: 0, y: 0, count: 2 }, { x: 0, y: 0, count: 7 }])).toBe(7);
  });

  it("never returns zero, so it is safe to divide by", () => {
    expect(busiestCell([])).toBe(1);
    expect(busiestCell([{ x: 0, y: 0, count: 0 }])).toBe(1);
  });
});

describe("deathBlobRadius", () => {
  it("scales area rather than radius with the count", () => {
    // Four times the deaths should be twice as wide, once the floor is removed.
    const one = deathBlobRadius(1, 4, CELL) - 0.45 * CELL;
    const four = deathBlobRadius(4, 4, CELL) - 0.45 * CELL;
    expect(four / one).toBeCloseTo(2, 6);
  });

  it("keeps a lone death visible", () => {
    expect(deathBlobRadius(1, 100, CELL)).toBeGreaterThan(0.4 * CELL);
  });

  it("caps the busiest cell at the full cell size", () => {
    expect(deathBlobRadius(9, 9, CELL)).toBeCloseTo(CELL, 6);
  });
});

describe("deathBlobAlpha", () => {
  it("is faintest for an isolated death and strongest in the worst cell", () => {
    expect(deathBlobAlpha(1, 100)).toBeLessThan(deathBlobAlpha(100, 100));
  });

  it("stays within a sane opacity range", () => {
    for (const [count, busiest] of [[0, 1], [1, 1], [1, 500], [500, 500]]) {
      const alpha = deathBlobAlpha(count, busiest);
      expect(alpha).toBeGreaterThanOrEqual(0.12);
      expect(alpha).toBeLessThanOrEqual(0.4);
    }
  });
});
