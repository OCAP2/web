import type { PlaybackEngine } from "../../playback/engine";
import { Unit } from "../../playback/entities/unit";
import type { Side } from "../../data/types";

/**
 * Distance and pace, summed from the recorded positions.
 *
 * Sampled every `step` frames rather than every frame, for two reasons: the cost
 * is linear in samples and a mission is thousands of frames, and summing every
 * frame accumulates the position jitter of a standing man into hundreds of
 * phantom metres. A few seconds between samples measures travel, not noise.
 */

export interface MovementStats {
  unitId: number;
  name: string;
  side: Side | null;
  /** Metres covered on foot. */
  onFoot: number;
  /** Metres covered as a vehicle occupant. */
  mounted: number;
  total: number;
  /** Frames spent riding, for the mounted share of their time. */
  mountedFrames: number;
  trackedFrames: number;
  /** Fastest sustained speed between two samples, m/s. */
  topSpeed: number;
}

/**
 * A jump further than this between samples is a teleport, not movement: Zeus
 * placement, a respawn, or a unit re-entering after being out of the loaded
 * range. Counting it would put a rifleman ahead of a helicopter.
 */
const MAX_STEP_METRES = 400;

export async function buildMovementStats(
  engine: PlaybackEngine,
  options: { step?: number; playersOnly?: boolean } = {},
): Promise<MovementStats[]> {
  const endFrame = engine.endFrame();
  if (endFrame <= 0) return [];

  const captureDelayMs = engine.captureDelayMs() || 1000;
  // Roughly five seconds between samples, at any capture delay.
  const step = options.step ?? Math.max(1, Math.round(5000 / captureDelayMs));
  const secondsPerStep = (step * captureDelayMs) / 1000;
  const playersOnly = options.playersOnly ?? true;

  const units = engine.entityManager.getAll().filter(
    (entity): entity is Unit => entity instanceof Unit && (!playersOnly || entity.isPlayer),
  );
  if (units.length === 0) return [];
  const totals = units.map((entity) => ({
    unitId: entity.id,
    name: entity.name,
    side: entity.side,
    onFoot: 0,
    mounted: 0,
    total: 0,
    mountedFrames: 0,
    trackedFrames: 0,
    topSpeed: 0,
  }));
  const previous = new Map<number, { x: number; y: number }>();

  // Keep only totals and the previous sample across chunks. In particular, a
  // sample on either side of a chunk boundary must still count as one step.
  await engine.visitAllFrames((firstFrame, lastFrame, stateAt) => {
    for (let i = 0; i < units.length; i++) {
      const entity = units[i];
      const stats = totals[i];
      const offset = Math.max(0, Math.ceil((firstFrame - entity.startFrame) / step));
      const first = entity.startFrame + offset * step;
      const last = Math.min(entity.endFrame, endFrame, lastFrame);
      for (let frame = first; frame <= last; frame += step) {
        const state = stateAt(entity.id, frame);
        if (!state) {
          // A gap in loaded data breaks the chain rather than bridging it, so an
          // unloaded stretch cannot masquerade as a long march.
          previous.delete(entity.id);
          continue;
        }

        stats.trackedFrames += 1;
        if (state.isInVehicle) stats.mountedFrames += 1;

        const position = { x: state.position[0], y: state.position[1] };
        const prior = previous.get(entity.id);
        if (prior) {
          const distance = Math.hypot(position.x - prior.x, position.y - prior.y);
          if (distance <= MAX_STEP_METRES) {
            if (state.isInVehicle) stats.mounted += distance;
            else stats.onFoot += distance;
            stats.topSpeed = Math.max(stats.topSpeed, distance / secondsPerStep);
          }
        }
        previous.set(entity.id, position);
      }
    }
  });

  return totals
    .map((stats) => ({ ...stats, total: stats.onFoot + stats.mounted }))
    .filter((stats) => stats.total >= 1)
    .sort((a, b) => b.total - a.total);
}

/** Metres as a compact "1.2 km" / "840 m". */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "-";
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}
