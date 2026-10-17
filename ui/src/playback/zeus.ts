import type { Side, ZeusModulePayload, ZeusPingPayload } from "../data/types";

/**
 * Frames after a remote-control stop during which that unit's kills still
 * count for Zeus. Capture is typically 1 s, and `eh_killed` may wait on ACE
 * `lastDamageSource` after occupancy has already cleared.
 */
export const ZEUS_RC_KILL_GRACE_FRAMES = 30;

/**
 * How long a Zeus ping stays drawn on the map, in seconds of playback time.
 * After this it disappears from the map but remains in the event log forever.
 */
export const ZEUS_PING_MAP_SECONDS = 180;

/**
 * The ping map lifetime in frames. Derived, never hardcoded: captureDelayMs
 * comes from the manifest and is not always 1000.
 */
export function zeusPingLifetimeFrames(captureDelayMs: number): number {
  if (!Number.isFinite(captureDelayMs) || captureDelayMs <= 0) {
    return ZEUS_PING_MAP_SECONDS;
  }
  return Math.max(1, Math.round((ZEUS_PING_MAP_SECONDS * 1000) / captureDelayMs));
}

/**
 * Metres within which two pings from the same player collapse into one map
 * icon carrying both timestamps. A player who pings twice without moving would
 * otherwise draw two icons and two labels on top of each other.
 */
export const ZEUS_PING_GROUP_RADIUS_M = 25;

/** Frames over which a ping fades out at the end of its map lifetime. */
export const ZEUS_PING_FADE_FRAMES = 30;

/** The minimal shape `groupZeusPings` needs; satisfied by ZeusPingEvent. */
export interface ZeusPingLike {
  frameNum: number;
  payload: ZeusPingPayload;
}

export interface ZeusPingGroup {
  /** Stable identity across frames, so the overlay can reuse marker handles. */
  key: string;
  unitId: number;
  name: string;
  side: string;
  position: [number, number];
  /** Frames of every ping in the group, newest first. */
  frames: number[];
  /** Newest ping in the group; drives the fade. */
  latestFrame: number;
}

/**
 * Collapse co-located pings from the same player into one group.
 *
 * Greedy clustering against the group's anchor, not a quantised grid: two
 * pings 9 m apart must always group, and a grid would split them whenever they
 * straddle a cell boundary. Groups come back oldest-first by their newest ping.
 *
 * The key is anchored on the group's oldest ping so it stays stable frame to
 * frame while the group's newest ping and position keep changing.
 */
export function groupZeusPings(pings: ZeusPingLike[]): ZeusPingGroup[] {
  const groups: ZeusPingGroup[] = [];
  const anchors: Array<[number, number]> = [];

  for (const ping of pings) {
    const { unitId, x, y, name, side } = ping.payload;

    let matched = false;
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (group.unitId !== unitId) continue;
      const [ax, ay] = anchors[i];
      if (Math.hypot(x - ax, y - ay) > ZEUS_PING_GROUP_RADIUS_M) continue;

      group.frames.push(ping.frameNum);
      if (ping.frameNum > group.latestFrame) {
        group.latestFrame = ping.frameNum;
        group.position = [x, y];
      }
      matched = true;
      break;
    }
    if (matched) continue;

    groups.push({
      key: `${unitId}:${ping.frameNum}`,
      unitId,
      name,
      side,
      position: [x, y],
      frames: [ping.frameNum],
      latestFrame: ping.frameNum,
    });
    anchors.push([x, y]);
  }

  for (const group of groups) {
    group.frames.sort((a, b) => b - a);
  }

  return groups.sort((a, b) => a.latestFrame - b.latestFrame);
}

/**
 * Opacity for a ping group at `frame`. Solid for most of its life, then a
 * short ramp so it does not vanish abruptly at the 180 s mark.
 */
export function zeusPingAlpha(
  frame: number,
  latestFrame: number,
  lifetimeFrames: number,
): number {
  const age = frame - latestFrame;
  if (age < 0 || age >= lifetimeFrames) return 0;
  const fade = Math.min(ZEUS_PING_FADE_FRAMES, lifetimeFrames);
  const remaining = lifetimeFrames - age;
  if (remaining >= fade) return 1;
  return Math.max(0.15, remaining / fade);
}

/**
 * How long a Zeus module placement stays drawn on the map, in seconds of
 * playback time. After this it disappears from the map but remains in the
 * event log forever.
 */
export const ZEUS_MODULE_MAP_SECONDS = 30;

/** Seconds over which a module marker fades out at the end of its map life. */
export const ZEUS_MODULE_FADE_SECONDS = 5;

export function zeusModuleLifetimeFrames(captureDelayMs: number): number {
  if (!Number.isFinite(captureDelayMs) || captureDelayMs <= 0) {
    return ZEUS_MODULE_MAP_SECONDS;
  }
  return Math.max(1, Math.round((ZEUS_MODULE_MAP_SECONDS * 1000) / captureDelayMs));
}

export function zeusModuleFadeFrames(captureDelayMs: number): number {
  if (!Number.isFinite(captureDelayMs) || captureDelayMs <= 0) {
    return ZEUS_MODULE_FADE_SECONDS;
  }
  return Math.max(1, Math.round((ZEUS_MODULE_FADE_SECONDS * 1000) / captureDelayMs));
}

export interface ZeusModuleLike {
  frameNum: number;
  payload: ZeusModulePayload;
}

export interface ZeusModuleGroup {
  key: string;
  curatorId: number;
  curatorName: string;
  displayName: string;
  attachedName: string;
  position: [number, number];
  frames: number[];
  latestFrame: number;
}

export function groupZeusModules(events: ZeusModuleLike[]): ZeusModuleGroup[] {
  const groups: ZeusModuleGroup[] = [];
  const anchors: Array<[number, number]> = [];

  for (const event of events) {
    const { curatorId, curatorName, displayName, attachedName, x, y } = event.payload;
    const attached = attachedName ?? "";

    let matched = false;
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (group.curatorId !== curatorId) continue;
      if (group.displayName !== displayName) continue;
      if (group.attachedName !== attached) continue;
      const [ax, ay] = anchors[i];
      if (Math.hypot(x - ax, y - ay) > ZEUS_PING_GROUP_RADIUS_M) continue;

      group.frames.push(event.frameNum);
      if (event.frameNum > group.latestFrame) {
        group.latestFrame = event.frameNum;
        group.position = [x, y];
      }
      matched = true;
      break;
    }
    if (matched) continue;

    groups.push({
      key: `${curatorId}:${displayName}:${attached}:${event.frameNum}`,
      curatorId,
      curatorName: curatorName ?? "",
      displayName,
      attachedName: attached,
      position: [x, y],
      frames: [event.frameNum],
      latestFrame: event.frameNum,
    });
    anchors.push([x, y]);
  }

  for (const group of groups) {
    group.frames.sort((a, b) => b - a);
  }

  return groups.sort((a, b) => a.latestFrame - b.latestFrame);
}

export function zeusModuleAlpha(
  frame: number,
  latestFrame: number,
  lifetimeFrames: number,
  fadeFrames: number,
): number {
  const age = frame - latestFrame;
  if (age < 0 || age >= lifetimeFrames) return 0;
  const fade = Math.min(fadeFrames, lifetimeFrames);
  const remaining = lifetimeFrames - age;
  if (remaining >= fade) return 1;
  return Math.max(0.15, remaining / fade);
}

/** Convert Arma getObjectFOV (tan of half-angle) to horizontal degrees. */
export function armaFovToDegrees(fov: number): number {
  if (!Number.isFinite(fov) || fov <= 0) return 75;
  return (2 * Math.atan(fov) * 180) / Math.PI;
}

export interface ZeusEntityInfo {
  curatorId: number;
  name: string;
  playerUid: string;
  bodyUnitId: number;
  startFrame: number;
}

export interface ZeusCameraSample {
  x: number;
  y: number;
  dir: number;
  fov: number;
  pitch: number;
}

export interface ZeusFrameState {
  curatorId: number;
  name: string;
  controllingUnitId: number | null;
  controllingName: string | null;
  camera: ZeusCameraSample | null;
  side: Side;
}

export function isZeusSide(side: Side | string | null | undefined): boolean {
  return side === "VIRTUAL";
}

/** Recorded getUnitType / roleDescription → label shown next to a possessed unit. */
const UNIT_TYPE_LABELS: Record<string, string> = {
  Man: "Rifleman",
  MG: "Autorifleman",
  GL: "Grenadier",
  AT: "AT",
  AA: "AA",
  Sniper: "Marksman",
  Medic: "Medic",
  Engineer: "Engineer",
  ExplosiveSpecialist: "Explosive Specialist",
  Leader: "Leader",
  Officer: "Officer",
};

/**
 * Readable unit type for occupancy labels.
 * Empty when the recording has no role / getUnitType for that unit.
 */
export function formatUnitTypeLabel(role: string | null | undefined): string {
  const raw = (role ?? "").trim();
  if (!raw) return "";
  const slot = raw.split("@")[0]?.trim() ?? "";
  if (!slot) return "";
  return UNIT_TYPE_LABELS[slot] ?? slot;
}

/** Map / list label while Zeus is remote-controlling a unit. */
export function formatZeusOccupancyName(
  zeusName: string,
  hostName: string,
  hostType?: string | null,
): string {
  const type = formatUnitTypeLabel(hostType);
  if (type) return `${zeusName} controlling ${hostName} (${type})`;
  return `${zeusName} controlling ${hostName}`;
}
