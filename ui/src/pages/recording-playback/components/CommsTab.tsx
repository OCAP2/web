import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";

import { useEngine } from "../../../hooks/useEngine";
import { useI18n } from "../../../hooks/useLocale";
import { ChevronDownIcon, ChevronRightIcon } from "../../../components/Icons";
import { SIDE_COLORS_UI } from "../../../config/sideColors";
import { formatElapsedTime } from "../../../playback/time";
import { loadWorldDem, type DemGrid } from "../../../playback/radioRange/demGrid";
import {
  buildNets,
  fallbackRange,
  formatNet,
  matchTransmissionRadio,
  pairTransmissions,
  reachability,
  transmissionsAtFrame,
  type CommsUnitRadios,
  type NetState,
  type ReachabilityResult,
  type Transmission,
} from "../../../playback/comms";
import type { RadioSnapshot, Side } from "../../../data/types";
import styles from "./CommsTab.module.css";
import panel from "./SidePanel.module.css";

function sideColor(side?: string): string {
  return SIDE_COLORS_UI[side as Side] ?? "#888";
}

/** Transmissions listed around the playhead, so the list stays readable. */
const TX_WINDOW_BEFORE = 600;
const TX_WINDOW_AFTER = 120;

export function CommsTab(): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();

  /**
   * Which nets are showing their members.
   *
   * A set rather than a single key: nets are independent, and comparing two of
   * them side by side is the whole point of the list. A single-open accordion
   * closed one the moment you opened another. Starts empty, so a mission with a
   * dozen nets opens as a readable index rather than a wall of rosters.
   */
  const [expandedNets, setExpandedNets] = createSignal<ReadonlySet<string>>(new Set());
  const [search, setSearch] = createSignal("");
  const query = createMemo(() => search().trim().toLowerCase());

  const isNetOpen = (key: string): boolean => expandedNets().has(key);

  const toggleNet = (key: string): void => {
    setExpandedNets((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  /** Open a net without disturbing the others. */
  const openNet = (key: string): void => {
    setExpandedNets((current) => (current.has(key) ? current : new Set(current).add(key)));
  };
  const [demGrid, setDemGrid] = createSignal<DemGrid | null>(null);
  const [snapshotsReady, setSnapshotsReady] = createSignal(false);

  // A comms rollup needs every player's radios at once, unlike the profile card
  // which reads one player at a time. On a chunked recording that means pulling
  // every sidecar; on a JSON one it resolves immediately.
  createEffect(() => {
    void engine.ensureAllPlayerSnapshots().then(() => setSnapshotsReady(true));
  });

  // Terrain makes the range test match the coverage overlay. Without a DEM the
  // reachability falls back to straight-line distance, which is stated below.
  createEffect(() => {
    const world = engine.worldConfig;
    if (!world || demGrid()) return;
    void loadWorldDem({
      tileBaseUrl: world.tileBaseUrl,
      worldName: world.worldName,
      worldSize: world.worldSize,
      hasDem: world.hasDem,
      hasHeightmap: world.hasHeightmap,
    }).then((grid) => {
      if (grid) setDemGrid(grid);
    });
  });

  const timeStr = (frame: number): string => formatElapsedTime(frame, engine.captureDelayMs());

  /** Every player's radios at the playhead, the input to the net rollup. */
  const unitRadios = createMemo<CommsUnitRadios[]>(() => {
    const frame = engine.currentFrame();
    engine.playerSnapshotsVersion();
    snapshotsReady();

    const snapshots = engine.entitySnapshots();
    const result: CommsUnitRadios[] = [];

    for (const unitId of engine.eventManager.getPlayerSnapshotUnitIds()) {
      const radio = engine.eventManager
        .getPlayerSnapshots(unitId, frame)
        .get("radioSnapshot");
      if (!radio) continue;

      const payload = radio.payload as RadioSnapshot;
      if (!payload?.radios?.length) continue;

      const snapshot = snapshots.get(unitId);
      const entity = engine.entityManager.getEntity(unitId);
      result.push({
        unitId,
        name: snapshot?.name ?? entity?.name ?? `Unit ${unitId}`,
        side: snapshot?.side ?? "",
        radios: payload.radios,
      });
    }

    return result;
  });

  const allNets = createMemo<NetState[]>(() => buildNets(unitRadios()));

  /**
   * Nets narrowed by the search box. A hit on the net label (frequency or code)
   * keeps its whole roster; a hit on a member keeps that member alone, which is
   * how you find which nets one player was on.
   */
  const nets = createMemo<NetState[]>(() => {
    const q = query();
    if (!q) return allNets();
    return allNets().flatMap((net) => {
      if (formatNet(net.frequency, net.code).toLowerCase().includes(q)) return [net];
      const members = net.members.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.entry.name ?? "").toLowerCase().includes(q),
      );
      if (members.length === 0) return [];
      return [{ ...net, members }];
    });
  });

  /** Nets kept by a member hit open themselves — the match must be visible. */
  const isNetExpanded = (net: NetState): boolean =>
    isNetOpen(net.key) ||
    (query().length > 0 && !formatNet(net.frequency, net.code).toLowerCase().includes(query()));

  /**
   * Which propagation model to assume when a transmitter has no snapshot to
   * join against. Read off the radios the recording does have rather than the
   * settings events, because both `tfarSettings` and `acreSettings` are written
   * unconditionally and neither says which mod the players actually used.
   */
  const dominantMod = createMemo(() => {
    let acre = 0;
    let tfar = 0;
    for (const unit of unitRadios()) {
      for (const radio of unit.radios) {
        if (radio.mod === "ACRE") acre += 1;
        else tfar += 1;
      }
    }
    return acre > tfar ? "ACRE" : "TFAR";
  });

  /** Start/Stop folded into keyed-up periods, for the whole recording. */
  const transmissions = createMemo<Transmission[]>(() =>
    pairTransmissions(
      engine.eventManager.getRadioTransmissions().map((event) => ({
        frameNum: event.frameNum,
        payload: event.payload,
      })),
    ),
  );

  const liveTransmissions = createMemo(() =>
    transmissionsAtFrame(transmissions(), engine.currentFrame()),
  );

  /** Speaker name at the playhead, also the haystack the search runs against. */
  const speakerName = (unitId: number): string =>
    engine.entitySnapshots().get(unitId)?.name ??
    engine.entityManager.getEntity(unitId)?.name ??
    `Unit ${unitId}`;

  const nearbyTransmissions = createMemo(() => {
    const frame = engine.currentFrame();
    const q = query();
    return transmissions()
      .filter((tx) => tx.startFrame >= frame - TX_WINDOW_BEFORE && tx.startFrame <= frame + TX_WINDOW_AFTER)
      .filter(
        (tx) =>
          !q ||
          speakerName(tx.unitId).toLowerCase().includes(q) ||
          formatNet(tx.frequency, tx.code).toLowerCase().includes(q) ||
          tx.radio.toLowerCase().includes(q),
      )
      .reverse();
  });

  /**
   * Who could hear each live transmission.
   *
   * Computed at the playhead, because that is where positions are known: a
   * transmission is evaluated against where everyone stood at the current
   * frame. Clicking a transmission seeks to its start, which is what makes the
   * numbers describe that transmission rather than a later moment.
   */
  const liveReachability = createMemo(() => {
    // Read for the dependency, not the value: this is evaluated at the playhead
    // and must recompute as it moves.
    engine.currentFrame();
    const snapshots = engine.entitySnapshots();
    const grid = demGrid();
    const netsByKey = new Map(allNets().map((net) => [net.key, net]));
    const result = new Map<string, { transmission: Transmission; results: ReachabilityResult[] }>();

    for (const tx of liveTransmissions()) {
      const origin = snapshots.get(tx.unitId)?.position;
      if (!origin) continue;

      const speaker = unitRadios().find((u) => u.unitId === tx.unitId);
      const radio = speaker ? matchTransmissionRadio(speaker.radios, tx) : null;
      const range = radio?.rangeMeters ?? fallbackRange(tx.type);
      const mod = radio?.mod ?? dominantMod();

      const net = netsByKey.get(tx.netKey);
      const peers = (net?.members ?? [])
        .filter((member) => member.unitId !== tx.unitId)
        .flatMap((member) => {
          const position = snapshots.get(member.unitId)?.position;
          if (!position) return [];
          return [{
            unitId: member.unitId,
            name: member.name,
            side: member.side,
            position: [position[0], position[1], position[2] ?? 0] as [number, number, number],
            monitoring: member.monitoring,
          }];
        });

      result.set(`${tx.unitId}|${tx.netKey}|${tx.startFrame}`, {
        transmission: tx,
        results: reachability({
          origin: [origin[0], origin[1], origin[2] ?? 0],
          peers,
          rangeMeters: range,
          mod,
          grid,
          tfar: engine.radioPropagation,
          acre: engine.acrePropagation,
          frequencyMHz: tx.frequency,
        }),
      });
    }

    return result;
  });

  /** Reachability for a net, keyed by unit, when something is live on it. */
  const netReachability = (net: NetState) => {
    for (const entry of liveReachability().values()) {
      if (entry.transmission.netKey !== net.key) continue;
      return { speakerId: entry.transmission.unitId, byUnit: new Map(entry.results.map((r) => [r.unitId, r])) };
    }
    return null;
  };

  const heardCount = (tx: Transmission): { heard: number; total: number } | null => {
    const entry = liveReachability().get(`${tx.unitId}|${tx.netKey}|${tx.startFrame}`);
    if (!entry) return null;
    return { heard: entry.results.filter((r) => r.inRange).length, total: entry.results.length };
  };

  const hasAnyData = createMemo(
    () => allNets().length > 0 || engine.eventManager.getRadioTransmissions().length > 0,
  );

  return (
    <>
      {/* Search: player name, radio or net */}
      <div class={panel.filterBar}>
        <input
          class={panel.filterInput}
          type="text"
          placeholder={t("search_comms")}
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>

      <div class={panel.tabContent}>
      <Show when={hasAnyData()} fallback={<div class={panel.placeholder}>{t("comms_no_data")}</div>}>
        <Show when={engine.eventManager.getRadioTransmissions().length > 0}>
          <div class={styles.section}>{t("comms_transmissions")}</div>
          <Show
            when={nearbyTransmissions().length > 0}
            fallback={
              <div class={styles.note}>
                {query() ? t("comms_no_transmission_matches") : t("comms_no_transmissions_here")}
              </div>
            }
          >
            <For each={nearbyTransmissions()}>
              {(tx) => {
                const live = () => liveTransmissions().includes(tx);
                const speaker = () => speakerName(tx.unitId);
                const count = () => heardCount(tx);
                return (
                  <button
                    class={styles.txRow}
                    classList={{ [styles.txRowLive]: live() }}
                    onClick={() => {
                      engine.seekTo(tx.startFrame);
                      openNet(tx.netKey);
                    }}
                  >
                    <span style={{ color: sideColor(engine.entitySnapshots().get(tx.unitId)?.side ?? undefined) }}>
                      {speaker()}
                    </span>
                    <span class={styles.memberRadio}>{formatNet(tx.frequency, tx.code)}</span>
                    <span class={styles.txMeta}>
                      <Show when={count()}>
                        {(c) => (
                          <span class={c().heard === c().total ? styles.heard : styles.missed}>
                            {c().heard}/{c().total}
                          </span>
                        )}
                      </Show>
                      <span>{timeStr(tx.startFrame)}</span>
                    </span>
                  </button>
                );
              }}
            </For>
          </Show>
        </Show>

        <div class={styles.section}>{t("comms_nets")}</div>
        <Show
          when={nets().length > 0}
          fallback={
            <div class={styles.note}>
              {query() ? t("comms_no_matches") : t("comms_no_nets")}
            </div>
          }
        >
          <For each={nets()}>
            {(net) => {
              const open = () => isNetExpanded(net);
              const live = () => netReachability(net);
              return (
                <div class={styles.card}>
                  <button
                    class={styles.cardHeader}
                    classList={{ [styles.cardHeaderActive]: open() }}
                    onClick={() => toggleNet(net.key)}
                    aria-expanded={open()}
                  >
                    <span class={styles.netCaret} aria-hidden="true">
                      {open() ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                    </span>
                    <span class={styles.netName}>{formatNet(net.frequency, net.code)}</span>
                    <span class={styles.netMeta}>
                      <For each={net.mods}>{(mod) => <span class={styles.badge}>{mod}</span>}</For>
                      <span>{net.members.length}</span>
                    </span>
                  </button>

                  <Show when={open()}>
                    <div class={styles.memberList}>
                      <For each={net.members}>
                        {(member) => {
                          const status = () => live()?.byUnit.get(member.unitId);
                          const isSpeaker = () => live()?.speakerId === member.unitId;
                          return (
                            <button
                              class={styles.member}
                              onClick={() => engine.panToEntity(member.unitId)}
                            >
                              <span class={styles.memberName} style={{ color: sideColor(member.side) }}>
                                {member.name}
                              </span>
                              <span class={styles.memberRadio}>
                                {member.entry.name}
                                <Show when={member.monitoring}> · {t("comms_monitoring")}</Show>
                              </span>
                              <span class={styles.memberStatus}>
                                <Show when={isSpeaker()}>
                                  <span class={styles.speaking}>{t("comms_transmitting")}</span>
                                </Show>
                                <Show when={status()}>
                                  {(s) => (
                                    <>
                                      <span class={styles.distance}>{Math.round(s().distance)}m</span>
                                      <span class={s().inRange ? styles.inRange : styles.outOfRange}>
                                        {s().inRange ? t("comms_in_range") : t("comms_out_of_range")}
                                      </span>
                                    </>
                                  )}
                                </Show>
                              </span>
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>

        <div class={styles.note}>
          {demGrid() ? t("comms_note_terrain") : t("comms_note_line_of_sight")}
        </div>
      </Show>
      </div>
    </>
  );
}
