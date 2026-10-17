import type { RadioSnapshotEntry, RadioTransmissionPayload } from "../data/types";
import type { TfarRadioPropagation, AcreRadioPropagation } from "../data/radioPropagation";
import type { DemGrid } from "./radioRange/demGrid";
import { effectiveDistance, inTfarRange } from "./radioRange/tfarCoverage";
import { inAcreRange } from "./radioRange/acreCoverage";

/**
 * How long a transmission with no matching Stop stays open, in frames. A client
 * that disconnects mid-word, or a Stop lost because the recording ended, would
 * otherwise leave a transmission running to the end of the mission.
 */
export const TRANSMISSION_MAX_FRAMES = 60;

/**
 * Fallback ranges, in metres, for a transmitter whose radio never made it into
 * a snapshot. These are the addon's own defaults
 * (`OCAP_settings_radioShortRangeMeters` / `radioLongRangeMeters`), so a
 * recording with radio tracking switched off still yields a usable estimate
 * instead of nothing.
 */
export const FALLBACK_RANGE_SW = 5000;
export const FALLBACK_RANGE_LR = 20000;

/**
 * Decimals the net key rounds to.
 *
 * Three, set by the finer of the two mods rather than by taste:
 *
 * - TFAR quantises every frequency itself. `TFAR_FREQ_ROUND_POWER` is 10, so a
 *   frequency is `round(f * 10) / 10` — one decimal — and its string form drops
 *   the decimal entirely when the value is whole ("100", "69.9"). SW runs
 *   30–512 MHz and LR 30–87 MHz.
 * - ACRE keeps MHz with finer steps: the PRC-152 walks `(950 + 2i) * 0.0625`
 *   from 59.375, the PRC-343 and BF-888S step by 0.01. Three decimals covers
 *   the smallest of those exactly.
 *
 * Rounding also absorbs the float32 the join disagrees over. A transmission's
 * frequency is stringified in SQF and stored as a float32, so 69.9 comes back as
 * 69.90000152587891, while the snapshot carries the raw float 69.9. At these
 * magnitudes float32 error is around 1e-5 — far too small to cross a 0.0005
 * boundary, so no TFAR or ACRE frequency can round to two different keys.
 */
const FREQ_DECIMALS = 3;

/**
 * Identity of a radio net: frequency plus encryption code.
 *
 * That pairing is not a guess — it is TFAR's own. `TFAR_fnc_sendSpeakerRadios`
 * hands the TeamSpeak plugin `format ["%1%2", <frequency>, <radio code>]` as the
 * net a radio listens on, and builds it identically for SW and LR sets. So the
 * key deliberately does not include SW/LR: a backpack LR on 69.9 MHz and a
 * handheld SW on 69.9 MHz are one net in TFAR and are one net here. Their bands
 * overlap in 30–87 MHz, so this is reachable in practice, not just in theory.
 */
export function netKey(frequency: number, code: string): string {
  if (!Number.isFinite(frequency)) return `?|${code ?? ""}`;
  return `${frequency.toFixed(FREQ_DECIMALS)}|${code ?? ""}`;
}

/**
 * A frequency written the way the mod writes it: trailing zeros trimmed, so a
 * TFAR net reads "100" and "69.9" exactly as it does in game, and an ACRE one
 * keeps the decimals it actually uses ("59.375").
 */
export function formatFrequency(frequency: number): string {
  if (!Number.isFinite(frequency)) return "unknown";
  const fixed = frequency.toFixed(FREQ_DECIMALS);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/** Human-readable net name: "69.9 MHz", with the code when one is set. */
export function formatNet(frequency: number, code: string): string {
  const freq = Number.isFinite(frequency) ? `${formatFrequency(frequency)} MHz` : "unknown";
  return code ? `${freq} · ${code}` : freq;
}

/** One player's radios at a frame, as the caller reads them off the snapshot. */
export interface CommsUnitRadios {
  unitId: number;
  name: string;
  side: string;
  radios: RadioSnapshotEntry[];
}

export interface NetMember {
  unitId: number;
  name: string;
  side: string;
  /** The radio this member is on the net with. */
  entry: RadioSnapshotEntry;
  /** True when this is a monitored additional channel rather than the selected one. */
  monitoring: boolean;
}

export interface NetState {
  key: string;
  frequency: number;
  code: string;
  /** Mods seen on this net, normally one. */
  mods: string[];
  members: NetMember[];
}

/**
 * Group every radio every unit can hear into nets.
 *
 * A unit appears once per net it is on, so a rifleman monitoring the company
 * net on his additional channel while working the squad net is a member of
 * both — which is exactly the question "who could have heard this" needs.
 * Membership is by what the radio is *tuned to*, not by who spoke.
 */
export function buildNets(units: CommsUnitRadios[]): NetState[] {
  const nets = new Map<string, NetState>();

  for (const unit of units) {
    for (const entry of unit.radios) {
      if (!Number.isFinite(entry.frequency)) continue;
      const key = netKey(entry.frequency, entry.code);

      let net = nets.get(key);
      if (!net) {
        net = { key, frequency: entry.frequency, code: entry.code ?? "", mods: [], members: [] };
        nets.set(key, net);
      }
      if (entry.mod && !net.mods.includes(entry.mod)) net.mods.push(entry.mod);

      // One entry per unit per net: a unit carrying two radios tuned to the
      // same net is still one listener, and the better radio is the one that
      // decides whether it hears anything.
      const existing = net.members.findIndex((m) => m.unitId === unit.unitId);
      const member: NetMember = {
        unitId: unit.unitId,
        name: unit.name,
        side: unit.side,
        entry,
        monitoring: entry.additional === true,
      };
      if (existing === -1) {
        net.members.push(member);
      } else if ((net.members[existing].entry.rangeMeters ?? 0) < (entry.rangeMeters ?? 0)) {
        net.members[existing] = member;
      }
    }
  }

  return [...nets.values()].sort((a, b) => a.frequency - b.frequency || a.code.localeCompare(b.code));
}

/**
 * The transmitter's own radio for this transmission, out of that player's
 * snapshot. The transmission names a net but carries no range, and the range is
 * what decides who heard it.
 *
 * Frequency is the discriminator; the SW/LR type only breaks ties, because a
 * player with a handheld and a backpack on the same net has two entries and the
 * one they keyed is the one whose type the transmission reports.
 */
export function matchTransmissionRadio(
  entries: RadioSnapshotEntry[],
  transmission: Pick<RadioTransmissionPayload, "frequency" | "code" | "type">,
): RadioSnapshotEntry | null {
  const key = netKey(transmission.frequency, transmission.code);
  const onNet = entries.filter((entry) => netKey(entry.frequency, entry.code) === key);
  if (onNet.length === 0) return null;

  return (
    onNet.find((entry) => entry.type === transmission.type && entry.active) ??
    onNet.find((entry) => entry.type === transmission.type) ??
    onNet.find((entry) => entry.active) ??
    onNet[0]
  );
}

/** Range to fall back on when the transmitter has no snapshot to join against. */
export function fallbackRange(type: string): number {
  return type === "LR" ? FALLBACK_RANGE_LR : FALLBACK_RANGE_SW;
}

export interface ReachabilityPeer {
  unitId: number;
  name: string;
  side: string;
  position: [number, number, number];
  monitoring: boolean;
}

export interface ReachabilityResult {
  unitId: number;
  name: string;
  side: string;
  /** Straight-line distance in metres. */
  distance: number;
  inRange: boolean;
  monitoring: boolean;
}

export interface ReachabilityInput {
  origin: [number, number, number];
  peers: ReachabilityPeer[];
  /** Range of the *transmitting* radio: the receiver's own set does not extend it. */
  rangeMeters: number;
  /** "ACRE" picks the diffraction model, anything else picks TFAR's. */
  mod: string;
  grid: DemGrid | null;
  tfar: TfarRadioPropagation;
  acre: AcreRadioPropagation;
  frequencyMHz?: number;
}

/**
 * Who, on this net, was close enough to hear it.
 *
 * With a DEM loaded this is the same terrain-aware test the coverage overlay
 * draws with, so a ridge between two units puts them out of contact exactly
 * where the overlay says it does. Without one it uses straight-line distance
 * while retaining TFAR's recorded range multiplier.
 *
 * What it cannot know: whether the receiver's radio was switched on, their
 * volume, or whether they were listening. This is reachability, not attention.
 */
export function reachability(input: ReachabilityInput): ReachabilityResult[] {
  const [ox, oy, oz] = input.origin;
  const isAcre = input.mod === "ACRE";

  return input.peers
    .map((peer) => {
      const [px, py, pz] = peer.position;
      const distance = Math.hypot(px - ox, py - oy, pz - oz);

      let inRange: boolean;
      if (!input.grid) {
        const effective = isAcre ? distance : effectiveDistance(distance, 0, input.tfar);
        inRange = effective <= input.rangeMeters;
      } else if (isAcre) {
        inRange = inAcreRange(
          input.grid, ox, oy, oz, px, py, pz,
          input.rangeMeters, input.acre, input.frequencyMHz,
        );
      } else {
        inRange = inTfarRange(
          input.grid, ox, oy, oz, px, py, pz,
          input.rangeMeters, input.tfar,
        );
      }

      return {
        unitId: peer.unitId,
        name: peer.name,
        side: peer.side,
        distance,
        inRange,
        monitoring: peer.monitoring,
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

/** A keyed-up period, folded from the Start and Stop pair. */
export interface Transmission {
  unitId: number;
  radio: string;
  type: string;
  channel: number;
  additional: boolean;
  frequency: number;
  code: string;
  netKey: string;
  startFrame: number;
  /** Frame of the matching Stop, or the capped end when none arrived. */
  endFrame: number;
  /** True when no Stop was recorded and the end is the cap, not a real release. */
  openEnded: boolean;
}

interface RawTransmission {
  frameNum: number;
  payload: RadioTransmissionPayload;
}

/**
 * Fold Start/Stop pairs into transmissions.
 *
 * Pairing is per unit *and* per net, because a player can key a second radio
 * before releasing the first, and a Stop must not close whichever transmission
 * happens to be open. An unmatched Start is capped at TRANSMISSION_MAX_FRAMES
 * rather than dropped — someone did speak — and an unmatched Stop is ignored,
 * since it describes a transmission that began before the recording did.
 */
export function pairTransmissions(events: RawTransmission[]): Transmission[] {
  const open = new Map<string, Transmission>();
  const done: Transmission[] = [];

  const ordered = [...events].sort((a, b) => a.frameNum - b.frameNum);

  for (const event of ordered) {
    const p = event.payload;
    const key = netKey(p.frequency, p.code);
    const pairKey = `${p.unitId}|${key}`;

    if (p.action === "Stop") {
      const started = open.get(pairKey);
      if (!started) continue;
      started.endFrame = event.frameNum;
      started.openEnded = false;
      open.delete(pairKey);
      done.push(started);
      continue;
    }

    // A second Start closes the first no later than its missing-Stop cap:
    // a later Start does not prove continuous activity during the gap.
    const previous = open.get(pairKey);
    if (previous) {
      previous.endFrame = Math.min(previous.endFrame, event.frameNum);
      open.delete(pairKey);
      done.push(previous);
    }

    open.set(pairKey, {
      unitId: p.unitId,
      radio: p.radio,
      type: p.type,
      channel: p.channel,
      additional: p.additional,
      frequency: p.frequency,
      code: p.code ?? "",
      netKey: key,
      startFrame: event.frameNum,
      endFrame: event.frameNum + TRANSMISSION_MAX_FRAMES,
      openEnded: true,
    });
  }

  for (const started of open.values()) done.push(started);

  return done.sort((a, b) => a.startFrame - b.startFrame);
}

/** Transmissions live at `frame`, oldest first. */
export function transmissionsAtFrame(all: Transmission[], frame: number): Transmission[] {
  return all.filter((t) => t.startFrame <= frame && frame <= t.endFrame);
}
