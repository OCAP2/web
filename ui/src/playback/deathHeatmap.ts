/**
 * Death heatmap binning.
 *
 * Deaths are collapsed onto a coarse grid so that a dozen kills inside one
 * building read as a single hot blob rather than a dozen overlapping circles.
 *
 * Kept pure and separate from the render bridge for two reasons: the grid maths
 * is the part worth pinning down in tests, and the site list it works from has
 * to be resolved once per recording rather than rebuilt on every frame. Reading
 * a victim's position goes through the chunk covering the frame they died on,
 * which is a lookup the playhead effect must not be doing hundreds of times a
 * frame.
 */

import type { PlaybackEngine } from "./engine";
import { HitKilledEvent } from "./events/hitKilledEvent";

/** One death, already resolved to a map position. */
export interface DeathSite {
  frameNum: number;
  x: number;
  y: number;
}

/** Resolve each victim while the chunk containing their death is still available. */
export async function buildDeathSites(engine: PlaybackEngine): Promise<DeathSite[]> {
  const deaths = engine.eventManager.getAll().filter(
    (event): event is HitKilledEvent => event instanceof HitKilledEvent && event.type === "killed",
  ).sort((a, b) => a.frameNum - b.frameNum);
  if (deaths.length === 0) return [];
  const sites: DeathSite[] = [];
  let cursor = 0;
  await engine.visitAllFrames((firstFrame, lastFrame, stateAt) => {
    while (cursor < deaths.length && deaths[cursor].frameNum < firstFrame) cursor++;
    for (; cursor < deaths.length && deaths[cursor].frameNum <= lastFrame; cursor++) {
      const event = deaths[cursor];
      const position = stateAt(event.victimId, event.frameNum)?.position;
      if (position) sites.push({ frameNum: event.frameNum, x: position[0], y: position[1] });
    }
  });
  return sites;
}

/** Deaths sharing one grid cell, collapsed to a single blob. */
export interface DeathCell {
  x: number;
  y: number;
  count: number;
}

/**
 * Bin every death up to `frame` onto a `cellMeters` grid.
 *
 * `sites` must be sorted by frame: the scan stops at the first death past the
 * playhead rather than filtering the whole list, which is what keeps this cheap
 * on a long recording where the viewer is still near the start.
 *
 * A cell's position is the running mean of the deaths in it, so the blob sits on
 * the bodies rather than on the corner of an arbitrary grid square.
 */
export function binDeathSites(
  sites: readonly DeathSite[],
  frame: number,
  cellMeters: number,
): Map<string, DeathCell> {
  const cells = new Map<string, DeathCell>();
  if (!Number.isFinite(cellMeters) || cellMeters <= 0) return cells;

  for (const site of sites) {
    if (site.frameNum > frame) break;

    const cx = Math.floor(site.x / cellMeters);
    const cy = Math.floor(site.y / cellMeters);
    const key = `${cx}|${cy}`;

    const cell = cells.get(key);
    if (cell) {
      cell.x += (site.x - cell.x) / (cell.count + 1);
      cell.y += (site.y - cell.y) / (cell.count + 1);
      cell.count += 1;
    } else {
      cells.set(key, { x: site.x, y: site.y, count: 1 });
    }
  }

  return cells;
}

/** The count in the busiest cell, and never below 1 so it is safe to divide by. */
export function busiestCell(cells: Iterable<DeathCell>): number {
  let busiest = 1;
  for (const cell of cells) {
    if (cell.count > busiest) busiest = cell.count;
  }
  return busiest;
}

/**
 * Blob radius in metres.
 *
 * Grows with the square root of the count so that *area*, not radius, tracks how
 * many died there -- a cell with four deaths looks twice as wide as one with a
 * single death, not four times. Floored well above zero so that a lone kill is
 * still visible.
 */
export function deathBlobRadius(count: number, busiest: number, cellMeters: number): number {
  const share = busiest > 0 ? count / busiest : 0;
  return cellMeters * (0.45 + 0.55 * Math.sqrt(Math.max(0, share)));
}

/** Blob opacity: faint for an isolated death, strongest in the worst cell. */
export function deathBlobAlpha(count: number, busiest: number): number {
  const share = busiest > 0 ? count / busiest : 0;
  return 0.12 + 0.28 * Math.max(0, Math.min(1, share));
}
