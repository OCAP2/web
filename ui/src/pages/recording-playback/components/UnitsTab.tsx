import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import type { Side } from "../../../data/types";
import { Unit } from "../../../playback/entities/unit";
import { SIDE_COLORS_UI, SIDE_BG_COLORS, SIDES, SIDE_LABELS } from "../../../config/sideColors";
import { useEngine } from "../../../hooks/useEngine";
import { useCustomize } from "../../../hooks/useCustomize";
import { useI18n } from "../../../hooks/useLocale";
import { activeSide, setActiveSide } from "../shortcuts";
import { CrosshairIcon, ChevronRightIcon } from "../../../components/Icons";
import styles from "./SidePanel.module.css";
import { PlayerProfileCard } from "./PlayerProfileCard";

interface GroupData {
  name: string;
  units: Unit[];
}

export interface UnitsTabProps {
  blacklist?: Accessor<Set<number>>;
  markerCounts?: Accessor<Map<number, number>>;
  isAdmin?: Accessor<boolean>;
  onToggleBlacklist?: (playerEntityId: number) => void;
}

export function UnitsTab(props: UnitsTabProps): JSX.Element {
  const engine = useEngine();
  const customize = useCustomize();
  const { t } = useI18n();
  const showKillCount = (): boolean => !customize().disableKillCount;
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());
  const [search, setSearch] = createSignal("");
  const query = createMemo(() => search().trim().toLowerCase());
  const [selectedUnit, setSelectedUnit] = createSignal<number | null>(null);
  const selectedProfileUnit = createMemo(() => {
    const id = selectedUnit();
    if (id === null) return undefined;
    const entity = engine.entityManager.getEntity(id);
    return entity instanceof Unit ? entity : undefined;
  });

  const unitsForSide = (side: Side): Unit[] => {
    // Access endFrame to create reactive dependency on operation load
    engine.endFrame();
    return engine.entityManager.getBySide(side);
  };

  const populatedSides = createMemo(() => {
    // Depend on endFrame so this recomputes when operation loads
    engine.endFrame();
    return SIDES.filter((s) => engine.entityManager.getBySide(s).length > 0);
  });

  // Auto-select first populated side
  createEffect(() => {
    const sides = populatedSides();
    if (sides.length > 0 && !sides.includes(activeSide())) {
      setActiveSide(sides[0]);
    }
  });

  // Auto-expand all groups when side changes or operation loads
  createEffect(() => {
    const sides = populatedSides();
    if (sides.length > 0) {
      const units = unitsForSide(activeSide());
      const groups = new Set(units.map((u) => u.groupName || t("ungrouped")));
      setExpandedGroups(groups);
    }
  });

  // Frame-aware kill counts
  const killDeathCounts = createMemo(() =>
    engine.eventManager.getKillDeathCounts(engine.currentFrame()),
  );

  const getUnitStatus = (unitId: number): "alive" | "dead" | "inactive" => {
    const snap = engine.entitySnapshots().get(unitId);
    if (snap && snap.alive) return "alive";
    if ((killDeathCounts().deaths.get(unitId) ?? 0) > 0) return "dead";
    return "inactive";
  };

  /**
   * Name shown in the list. Zeus curators are renamed as they take over units,
   * so their label only exists in the frame snapshot.
   */
  const unitLabel = (unit: Unit): string => {
    if (unit.type === "zeus") {
      return engine.entitySnapshots().get(unit.id)?.name || unit.name || `Unit ${unit.id}`;
    }
    return unit.name || `Unit ${unit.id}`;
  };

  /** A unit matches on its own name or role; the group name is tested separately. */
  const unitMatches = (unit: Unit, q: string): boolean =>
    unitLabel(unit).toLowerCase().includes(q) || (unit.role ?? "").toLowerCase().includes(q);

  const groups = createMemo((): GroupData[] => {
    const units = unitsForSide(activeSide());
    const q = query();
    const groupMap = new Map<string, Unit[]>();
    for (const u of units) {
      const gn = u.groupName || t("ungrouped");
      // A hit on the group name keeps the whole group, so searching a callsign
      // still shows who is in it; otherwise only the matching members remain.
      if (q && !gn.toLowerCase().includes(q) && !unitMatches(u, q)) continue;
      const arr = groupMap.get(gn);
      if (arr) {
        arr.push(u);
      } else {
        groupMap.set(gn, [u]);
      }
    }
    return Array.from(groupMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, units]) => ({ name, units }));
  });

  /** While searching, every surviving group is open — hits must be visible. */
  const isExpanded = (name: string): boolean =>
    query().length > 0 || expandedGroups().has(name);

  const toggleGroup = (name: string) => {
    const current = expandedGroups();
    const next = new Set(current);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    setExpandedGroups(next);
  };

  const aliveCount = (units: Unit[]): number => {
    // Access both reactive sources so this recomputes on snapshot or kill-event changes
    engine.entitySnapshots();
    killDeathCounts();
    let count = 0;
    for (const u of units) {
      if (getUnitStatus(u.id) === "alive") count++;
    }
    return count;
  };

  const toggleFollow = (unitId: number) => {
    if (engine.followTarget() === unitId) {
      engine.unfollowEntity();
    } else {
      engine.followEntity(unitId);
    }
  };

  return (
    <>
      {/* Side tabs */}
      <div class={styles.sideTabs}>
        <For each={populatedSides()}>
          {(side) => {
            const units = () => unitsForSide(side);
            const isActive = () => activeSide() === side;
            return (
              <button
                class={styles.sideTab}
                classList={{ [styles.sideTabActive]: isActive() }}
                style={{
                  background: isActive() ? SIDE_BG_COLORS[side] : "transparent",
                  color: isActive() ? SIDE_COLORS_UI[side] : "var(--text-dimmer)",
                }}
                onClick={() => setActiveSide(side)}
              >
                <span
                  class={styles.sideDot}
                  style={{ background: SIDE_COLORS_UI[side] }}
                />
                {SIDE_LABELS[side]}
                <span class={styles.sideCount}>{units().length}</span>
              </button>
            );
          }}
        </For>
      </div>

      {/* Search: player, unit or group name */}
      <div class={styles.filterBar}>
        <input
          class={styles.filterInput}
          type="text"
          placeholder={t("search_units")}
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>

      {/* Scrollable unit list */}
      <div class={styles.tabContent}>
        <Show when={groups().length > 0 || !query()}
          fallback={<div class={styles.placeholder}>{t("no_units_match")}</div>}
        >
        <For each={groups()}>
          {(group) => {
            const expanded = () => isExpanded(group.name);
            const alive = () => aliveCount(group.units);
            return (
              <>
                <button
                  class={styles.groupHeader}
                  classList={{ [styles.groupHeaderExpanded]: expanded() }}
                  style={{ "border-left-color": SIDE_COLORS_UI[activeSide()] }}
                  onClick={() => toggleGroup(group.name)}
                >
                  <span
                    class={styles.groupChevron}
                    classList={{ [styles.groupChevronExpanded]: expanded() }}
                  >
                    <ChevronRightIcon size={12} />
                  </span>
                  <span class={styles.groupName}>{group.name}</span>
                  <span class={styles.groupCount}>
                    <span class={styles.groupAlive}>{alive()}</span>
                    <span class={styles.groupAliveSlash}>/</span>
                    {group.units.length}
                  </span>
                </button>
                <Show when={expanded()}>
                  <For each={group.units}>
                    {(unit) => {
                      const status = () => getUnitStatus(unit.id);
                      const selected = () => selectedUnit() === unit.id;
                      const snap = () => engine.entitySnapshots().get(unit.id);
                      const displayName = () => unitLabel(unit);
                      const displayRole = () => {
                        if (unit.type === "zeus" && snap()?.controllingUnitId != null) {
                          return "";
                        }
                        return unit.role;
                      };
                      return (
                        <>
                          <button
                            class={styles.unitRow}
                            classList={{
                              [styles.unitRowSelected]: selected(),
                              [styles.unitRowDead]: status() === "dead",
                              [styles.unitRowInactive]: status() === "inactive",
                            }}
                            title={t("profile_open")}
                            aria-label={t("profile_open_named", {
                              name: displayName(),
                            })}
                            onClick={() =>
                              setSelectedUnit(selected() ? null : unit.id)
                            }
                          >
                            <span
                              class={styles.unitIcon}
                              style={{
                                width: "8px",
                                height: "8px",
                                background: SIDE_COLORS_UI[activeSide()],
                              }}
                            />
                            <span class={styles.unitInfo}>
                              <span
                                class={styles.unitName}
                                classList={{
                                  [styles.unitNameAlive]: status() === "alive",
                                  [styles.unitNameDead]: status() === "dead",
                                  [styles.unitNameInactive]: status() === "inactive",
                                }}
                              >
                                {displayName()}
                                <Show when={!unit.isPlayer && unit.type !== "zeus"}>
                                  <span class={styles.unitAiBadge}>{t("ai_label")}</span>
                                </Show>
                              </span>
                              <Show when={displayRole()}>
                                <span class={styles.unitRole}>{displayRole()}</span>
                              </Show>
                            </span>
                            <Show when={showKillCount() && (killDeathCounts().kills.get(unit.id) ?? 0) > 0}>
                              <span class={styles.unitKills}>
                                <CrosshairIcon size={10} />
                                {killDeathCounts().kills.get(unit.id)}
                              </span>
                            </Show>
                          </button>
                        </>
                      );
                    }}
                  </For>
                </Show>
              </>
            );
          }}
        </For>
        </Show>
      </div>
      <Show when={selectedProfileUnit()}>
        {(unit) => (
          <Portal>
            <PlayerProfileCard
              unit={unit()}
              kills={killDeathCounts().kills.get(unit().id) ?? 0}
              deaths={killDeathCounts().deaths.get(unit().id) ?? 0}
              markerCount={props.markerCounts?.()?.get(unit().id) ?? 0}
              isBlacklisted={props.blacklist?.()?.has(unit().id) ?? false}
              isFollowed={engine.followTarget() === unit().id}
              isAdmin={props.isAdmin?.() ?? false}
              showKillCount={showKillCount()}
              onClose={() => setSelectedUnit(null)}
              onToggleFollow={toggleFollow}
              onToggleBlacklist={props.onToggleBlacklist}
            />
          </Portal>
        )}
      </Show>
    </>
  );
}
