/** Time display mode for the playback UI. */
export type TimeMode = "elapsed" | "mission" | "system";

/** A known system-time sample point from the mission manifest. */
export interface TimeSample {
  frameNum: number;
  systemTimeUtc: string;
}

/** Configuration passed to the unified `formatTime` dispatcher. */
export interface TimeConfig {
  captureDelayMs: number;
  missionDate?: string;
  missionTimeMultiplier?: number;
  times?: TimeSample[];
}

/**
 * Pad a number to at least two digits with a leading zero.
 */
function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/**
 * Format milliseconds as HH:MM:SS.
 * Handles arbitrarily large values (hours can exceed 23).
 */
function msToHHMMSS(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours + ":" + pad2(minutes) + ":" + pad2(seconds);
}

/**
 * Format a Date as HH:MM:SS using its UTC components.
 */
function dateToHHMMSS(date: Date): string {
  return (
    date.getUTCHours() +
    ":" +
    pad2(date.getUTCMinutes()) +
    ":" +
    pad2(date.getUTCSeconds())
  );
}

/**
 * Convert a frame number to an elapsed-time string (HH:MM:SS).
 *
 * Pure arithmetic — no Date object needed.
 *
 * @param frame           Current frame number (0-based).
 * @param captureDelayMs  Milliseconds between consecutive frames (e.g. 1000).
 *
 * @example
 *   formatElapsedTime(0, 1000)    // "0:00:00"
 *   formatElapsedTime(60, 1000)   // "0:01:00"
 *   formatElapsedTime(3661, 1000) // "1:01:01"
 */
export function formatElapsedTime(
  frame: number,
  captureDelayMs: number,
): string {
  return msToHHMMSS(frame * captureDelayMs);
}

/**
 * Format the in-game mission time at a given frame (HH:MM:SS).
 *
 * Arma missions can run with a time multiplier (e.g. 4x), meaning each
 * real-world second advances the in-game clock by `multiplier` seconds.
 *
 * @param frame                   Current frame number (0-based).
 * @param missionDate             ISO-8601 date+time string for the mission
 *                                start (e.g. "2035-06-10T05:30:00").
 * @param missionTimeMultiplier   In-game time acceleration factor.
 * @param captureDelayMs          Milliseconds between consecutive frames.
 *
 * @example
 *   formatMissionTime(0, "2035-06-10T05:30:00", 1, 1000)
 *   // "05:30:00"
 */
export function formatMissionTime(
  frame: number,
  missionDate: string,
  missionTimeMultiplier: number,
  captureDelayMs: number,
): string {
  const base = new Date(missionDate).getTime();
  const elapsed = frame * captureDelayMs * missionTimeMultiplier;
  return dateToHHMMSS(new Date(base + elapsed));
}

/**
 * Format the real-world (system) time at a given frame (HH:MM:SS).
 *
 * The manifest provides one or more `{frameNum, systemTimeUtc}` samples.
 * This function performs a binary search for the sample whose `frameNum`
 * is closest to (and <=) the requested frame, then interpolates:
 *
 *  - If a subsequent sample exists, the ms-per-frame rate is derived from
 *    the two bounding samples: `(nextTime - thisTime) / (nextFrame - thisFrame)`.
 *  - Otherwise the rate from the preceding pair is used, falling back to
 *    1 000 ms/frame (the OCAP default capture delay).
 *
 * @param frame  Current frame number (0-based).
 * @param times  Sorted array of system-time samples from the manifest.
 */
export function formatSystemTime(
  frame: number,
  times: TimeSample[],
): string {
  if (times.length === 0) {
    return "0:00:00";
  }

  // Binary search: find the largest index whose frameNum <= frame.
  let lo = 0;
  let hi = times.length - 1;
  let idx = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid].frameNum <= frame) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const entry = times[idx];
  const baseMs = new Date(entry.systemTimeUtc + "Z").getTime();
  const frameDelta = frame - entry.frameNum;

  if (frameDelta === 0) {
    return dateToHHMMSS(new Date(baseMs));
  }

  // Derive the ms-per-frame rate from bounding samples.
  let msPerFrame: number;

  if (idx + 1 < times.length) {
    // Forward rate from next sample.
    const next = times[idx + 1];
    const nextMs = new Date(next.systemTimeUtc + "Z").getTime();
    msPerFrame = (nextMs - baseMs) / (next.frameNum - entry.frameNum);
  } else if (idx > 0) {
    // Backward rate from previous sample.
    const prev = times[idx - 1];
    const prevMs = new Date(prev.systemTimeUtc + "Z").getTime();
    msPerFrame = (baseMs - prevMs) / (entry.frameNum - prev.frameNum);
  } else {
    // Single entry — assume the OCAP default of 1 000 ms/frame.
    msPerFrame = 1000;
  }

  return dateToHHMMSS(new Date(baseMs + frameDelta * msPerFrame));
}

/**
 * Unified time-formatting dispatcher.
 *
 * Delegates to the mode-specific formatter based on `mode`.
 *
 * @param frame   Current frame number.
 * @param mode    Which clock to display.
 * @param config  Configuration bag with capture delay and optional fields.
 */
export function formatTime(
  frame: number,
  mode: TimeMode,
  config: TimeConfig,
): string {
  switch (mode) {
    case "elapsed":
      return formatElapsedTime(frame, config.captureDelayMs);

    case "mission":
      return formatMissionTime(
        frame,
        config.missionDate ?? "",
        config.missionTimeMultiplier ?? 1,
        config.captureDelayMs,
      );

    case "system":
      return formatSystemTime(frame, config.times ?? []);

    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown time mode: ${_exhaustive}`);
    }
  }
}
