import type { PlaybackEngine } from "../../playback/engine";
import { Unit } from "../../playback/entities/unit";
import { Vehicle } from "../../playback/entities/vehicle";
import type { EntityState, Side } from "../../data/types";

/**
 * Force structure read at a frame.
 *
 * Groups come from the *per-frame* group name, not the entity's starting group,
 * because units are reassigned mid-mission — a survivor folded into another
 * squad shows up where they actually ended up. `EntitySnapshot` drops that
 * field, which is why everything here goes through `engine.getStateAt`.
 */

export interface OrbatMember {
  unitId: number;
  name: string;
  role: string;
  isPlayer: boolean;
  alive: boolean;
  /** In a vehicle this frame, so the map icon is the vehicle, not them. */
  mounted: boolean;
  /** Current group differs from the one they started the mission in. */
  regrouped: boolean;
}

export interface OrbatGroup {
  name: string;
  members: OrbatMember[];
  alive: number;
}

/** Roles the recorder writes for a group leader, lowercased. */
const LEADER_ROLES = ["leader", "squadleader", "teamleader", "officer"];

function isLeader(role: string): boolean {
  const normalised = role.toLowerCase().replace(/[\s_-]/g, "");
  return LEADER_ROLES.some((candidate) => normalised.includes(candidate));
}

/**
 * True when this entity is a player slot at, or as of, `frame`.
 *
 * Both sources are needed. The per-frame flag alone loses a player the moment
 * they are killed or disconnect — the recorder keeps writing their body as an
 * AI-flagged unit — so a squad would empty out over the mission. The entity
 * flag alone misses someone who took over an AI slot mid-mission, because that
 * is only ever recorded per frame.
 */
function isPlayerSlot(entity: Unit, state: EntityState): boolean {
  return entity.isPlayer || state.isPlayer === true;
}

/**
 * Build the order of battle for one side at a frame.
 *
 * Leaders sort to the top of their group, then players, then the rest by name,
 * which is how a briefing would list them.
 *
 * Players only by default. An ORBAT is read to find out who was where and under
 * whom, and on a populated mission the AI outnumbers the players heavily enough
 * to bury exactly that: filler squads the players never interacted with become
 * most of the list. A group with no players in it drops out entirely rather than
 * appearing empty. A side with no players at all comes back empty. Pass
 * `playersOnly: false` for the full roster.
 */
export function buildOrbat(
  engine: PlaybackEngine,
  side: Side,
  frame: number,
  options: { playersOnly?: boolean } = {},
): OrbatGroup[] {
  const playersOnly = options.playersOnly ?? true;
  const groups = new Map<string, OrbatMember[]>();

  /**
   * One row per named slot, so a respawn or a reconnect does not list the same
   * player twice. Prefer a living, currently controlled entity at this frame;
   * the recorder may keep writing an abandoned body longer than its replacement.
   * Unnamed entities are never folded together; they are distinct bodies.
   */
  const bySlot = new Map<string, {
    group: string; member: OrbatMember; priority: number; startFrame: number; span: number;
  }>();
  const unnamed: Array<{ group: string; member: OrbatMember }> = [];

  for (const entity of engine.entityManager.getAll()) {
    if (!(entity instanceof Unit)) continue;
    if (frame < entity.startFrame || frame > entity.endFrame) continue;

    const state = engine.getStateAt(entity.id, frame);
    if (!state) continue;
    if ((state.side ?? entity.side) !== side) continue;

    const isPlayer = isPlayerSlot(entity, state);
    if (playersOnly && !isPlayer) continue;

    const groupName = state.groupName || entity.groupName || "";
    const name = state.name || entity.name;
    const member: OrbatMember = {
      unitId: entity.id,
      name,
      // Protobuf chunks omit roles; the manifest retains the recorded role.
      role: state.role ?? entity.role,
      isPlayer,
      alive: !!state.alive,
      mounted: state.isInVehicle === true,
      regrouped: !!entity.groupName && !!groupName && groupName !== entity.groupName,
    };

    if (!name) {
      unnamed.push({ group: groupName, member });
      continue;
    }
    const key = `${groupName}\u0000${name}`;
    const span = entity.endFrame - entity.startFrame;
    const priority = Number(member.alive) * 2 + Number(state.isPlayer ?? entity.isPlayer);
    const seen = bySlot.get(key);
    if (!seen || priority > seen.priority || (priority === seen.priority && (
      entity.startFrame > seen.startFrame || (entity.startFrame === seen.startFrame && span > seen.span)
    ))) {
      bySlot.set(key, { group: groupName, member, priority, startFrame: entity.startFrame, span });
    }
  }

  for (const { group, member } of [...bySlot.values(), ...unnamed]) {
    const list = groups.get(group);
    if (list) list.push(member);
    else groups.set(group, [member]);
  }

  return [...groups.entries()]
    .map(([name, members]) => {
      members.sort((a, b) => {
        const leadDiff = Number(isLeader(b.role)) - Number(isLeader(a.role));
        if (leadDiff !== 0) return leadDiff;
        const playerDiff = Number(b.isPlayer) - Number(a.isPlayer);
        if (playerDiff !== 0) return playerDiff;
        return a.name.localeCompare(b.name);
      });
      return { name, members, alive: members.filter((m) => m.alive).length };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { isLeader };

// ─── Vehicle occupancy ───

export interface CrewSample {
  frame: number;
  crewIds: number[];
}

export interface VehicleOccupancy {
  vehicleId: number;
  name: string;
  samples: CrewSample[];
  /** Highest crew count seen, which sizes the strip. */
  peak: number;
  /** True while anyone is aboard at the sampled frame nearest the playhead. */
  occupiedNow: boolean;
}

/**
 * Unit ids that belong to a player, optionally narrowed to one side.
 *
 * Entity-level only, deliberately: this answers "did a player ever ride this
 * vehicle", a question about the whole recording, which the per-frame flag can
 * only answer one frame at a time. Side is read the same way.
 */
function playerUnitIds(engine: PlaybackEngine, side?: Side): Set<number> {
  const ids = new Set<number>();
  for (const entity of engine.entityManager.getAll()) {
    if (!(entity instanceof Unit)) continue;
    if (!entity.isPlayer) continue;
    if (side && entity.side !== side) continue;
    ids.add(entity.id);
  }
  return ids;
}

/**
 * Sample who was aboard each vehicle across the whole recording.
 *
 * Sampled rather than per-frame on purpose: a two-hour mission is thousands of
 * frames and the strip is a couple of hundred pixels wide, so reading every
 * frame would cost far more than it could ever show. A vehicle nobody ever
 * boarded is dropped — an empty strip says nothing.
 *
 * `playersOnly` keeps only the vehicles a player crewed at some point and
 * `side` narrows that to one faction, which is what the ORBAT asks for: on a
 * populated mission the AI motor pool is most of the list and none of the
 * story. The crew lists themselves stay whole — who a player rode with is
 * part of it.
 */
export async function buildVehicleOccupancy(
  engine: PlaybackEngine,
  frame: number,
  sampleCount = 160,
  options: { side?: Side; playersOnly?: boolean } = {},
): Promise<VehicleOccupancy[]> {
  const endFrame = engine.endFrame();
  if (endFrame <= 0) return [];

  const step = Math.max(1, Math.floor(endFrame / sampleCount));
  const vehicles = engine.entityManager.getAll().filter(
    (entity): entity is Vehicle => entity instanceof Vehicle,
  );
  if (vehicles.length === 0) return [];
  const result: VehicleOccupancy[] = vehicles.map((entity) => ({
    vehicleId: entity.id, name: entity.name, samples: [], peak: 0, occupiedNow: false,
  }));

  await engine.visitAllFrames((firstFrame, lastFrame, stateAt) => {
    for (let i = 0; i < vehicles.length; i++) {
      const entity = vehicles[i];
      const occupancy = result[i];
      const offset = Math.max(0, Math.ceil((firstFrame - entity.startFrame) / step));
      const first = entity.startFrame + offset * step;
      const last = Math.min(entity.endFrame, endFrame, lastFrame);
      for (let f = first; f <= last; f += step) {
        const crewIds = [...(stateAt(entity.id, f)?.crewIds ?? [])];
        occupancy.samples.push({ frame: f, crewIds });
        occupancy.peak = Math.max(occupancy.peak, crewIds.length);
      }
    }
  });

  return selectVehicleOccupancy(engine, result, frame, options);
}

/** Filter durable crew samples and update the playhead indicator without loading chunks again. */
export function selectVehicleOccupancy(
  engine: PlaybackEngine,
  history: readonly VehicleOccupancy[],
  frame: number,
  options: { side?: Side; playersOnly?: boolean } = {},
): VehicleOccupancy[] {
  const players = options.playersOnly ? playerUnitIds(engine, options.side) : null;
  return history
    .filter((vehicle) => {
      if (vehicle.peak === 0) return false;
      return !players || vehicle.samples.some((sample) => sample.crewIds.some((id) => players.has(id)));
    })
    .map((vehicle) => {
      let nearest: CrewSample | undefined;
      for (const sample of vehicle.samples) {
        if (!nearest || Math.abs(sample.frame - frame) < Math.abs(nearest.frame - frame)) {
          nearest = sample;
        }
      }
      return { ...vehicle, occupiedNow: (nearest?.crewIds.length ?? 0) > 0 };
    })
    .sort((a, b) => b.peak - a.peak || a.name.localeCompare(b.name));
}
