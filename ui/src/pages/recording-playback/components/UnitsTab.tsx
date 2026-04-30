import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import type { Side } from "../../../data/types";
import type { Unit } from "../../../playback/entities/unit";
import { SIDE_COLORS_UI, SIDE_BG_COLORS } from "../../../config/sideColors";
import { useEngine } from "../../../hooks/useEngine";
import { useCustomize } from "../../../hooks/useCustomize";
import { useI18n } from "../../../hooks/useLocale";
import { activeSide, setActiveSide } from "../shortcuts";
import { CrosshairIcon, ChevronRightIcon, EyeOffIcon, EyeIcon, NavigationIcon } from "../../../components/Icons";
import styles from "./SidePanel.module.css";

const SIDES: Side[] = ["WEST", "EAST", "GUER", "CIV"];

const SIDE_LABELS: Record<Side, string> = {
  WEST: "BLUFOR",
  EAST: "OPFOR",
  GUER: "IND",
  CIV: "CIV",
};

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
  const [selectedUnit, setSelectedUnit] = createSignal<number | null>(null);

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

  const isAlive = (unitId: number): boolean => {
    const snap = engine.entitySnapshots().get(unitId);
    return snap ? !!snap.alive : true;
  };

  // Frame-aware kill counts
  const killDeathCounts = createMemo(() =>
    engine.eventManager.getKillDeathCounts(engine.currentFrame()),
  );

  const groups = createMemo((): GroupData[] => {
    const units = unitsForSide(activeSide());
    const groupMap = new Map<string, Unit[]>();
    for (const u of units) {
      const gn = u.groupName || t("ungrouped");
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
    // Access snapshots for reactivity
    engine.entitySnapshots();
    let count = 0;
    for (const u of units) {
      if (isAlive(u.id)) count++;
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

      {/* Scrollable unit list */}
      <div class={styles.tabContent}>
        <For each={groups()}>
          {(group) => {
            const expanded = () => expandedGroups().has(group.name);
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
                      const alive = () => isAlive(unit.id);
                      const selected = () => selectedUnit() === unit.id;
                      return (
                        <>
                          <button
                            class={styles.unitRow}
                            classList={{
                              [styles.unitRowSelected]: selected(),
                              [styles.unitRowDead]: !alive(),
                            }}
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
                                  [styles.unitNameAlive]: alive(),
                                  [styles.unitNameDead]: !alive(),
                                }}
                              >
                                {unit.name || `Unit ${unit.id}`}
                                <Show when={!unit.isPlayer}>
                                  <span class={styles.unitAiBadge}>{t("ai_label")}</span>
                                </Show>
                              </span>
                              <Show when={unit.role}>
                                <span class={styles.unitRole}>{unit.role}</span>
                              </Show>
                            </span>
                            <Show when={showKillCount() && (killDeathCounts().kills.get(unit.id) ?? 0) > 0}>
                              <span class={styles.unitKills}>
                                <CrosshairIcon size={10} />
                                {killDeathCounts().kills.get(unit.id)}
                              </span>
                            </Show>
                          </button>
                          <Show when={selected()}>
                            <UnitDetailCard
                              unitId={unit.id}
                              kills={killDeathCounts().kills.get(unit.id) ?? 0}
                              deaths={killDeathCounts().deaths.get(unit.id) ?? 0}
                              markerCount={props.markerCounts?.()?.get(unit.id) ?? 0}
                              isBlacklisted={props.blacklist?.()?.has(unit.id) ?? false}
                              isFollowed={engine.followTarget() === unit.id}
                              isAdmin={props.isAdmin?.() ?? false}
                              onToggleFollow={toggleFollow}
                              onToggleBlacklist={props.onToggleBlacklist}
                              side={activeSide()}
                              showKillCount={showKillCount()}
                            />
                          </Show>
                        </>
                      );
                    }}
                  </For>
                </Show>
              </>
            );
          }}
        </For>
      </div>
    </>
  );
}

interface UnitDetailCardProps {
  unitId: number;
  kills: number;
  deaths: number;
  markerCount: number;
  isBlacklisted: boolean;
  isFollowed: boolean;
  isAdmin: boolean;
  onToggleFollow: (unitId: number) => void;
  onToggleBlacklist?: (playerEntityId: number) => void;
  side: Side;
  showKillCount: boolean;
}

function UnitDetailCard(props: UnitDetailCardProps): JSX.Element {
  return (
    <div
      class={styles.detailCard}
      style={{ "border-color": `color-mix(in srgb, ${SIDE_COLORS_UI[props.side]} 8%, transparent)` }}
    >
      {/* Stats row */}
      <div class={styles.detailStats}>
        <Show when={props.showKillCount}>
          <div class={styles.detailStatPill}>
            <div
              class={styles.detailStatValue}
              style={{ color: props.kills > 0 ? "var(--accent-danger)" : "var(--text-dimmest)" }}
            >
              {props.kills}
            </div>
            <div class={styles.detailStatLabel}>KILLS</div>
          </div>
          <div class={styles.detailStatPill}>
            <div
              class={styles.detailStatValue}
              style={{ color: props.deaths > 0 ? "var(--accent-warning)" : "var(--text-dimmest)" }}
            >
              {props.deaths}
            </div>
            <div class={styles.detailStatLabel}>DEATHS</div>
          </div>
        </Show>
        <div class={styles.detailStatPill}>
          {(() => {
            const visible = props.isBlacklisted ? 0 : props.markerCount;
            return (
              <>
                <div
                  class={styles.detailStatValue}
                  style={{ color: visible > 0 ? "#A78BFA" : "var(--text-dimmest)" }}
                >
                  {visible}
                </div>
                <div class={styles.detailStatLabel}>MARKERS</div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Follow button */}
      <div class={styles.detailActions}>
        <button
          class={styles.detailFollowBtn}
          classList={{ [styles.detailFollowBtnActive]: props.isFollowed }}
          onClick={() => props.onToggleFollow(props.unitId)}
        >
          <NavigationIcon size={12} />
          {props.isFollowed ? "Following" : "Follow"}
        </button>
      </div>

      {/* Admin Actions */}
      <Show when={props.isAdmin && props.markerCount > 0}>
        <div class={styles.detailAdminSection}>
          <div class={styles.detailAdminLabel}>ADMIN ACTIONS</div>
          <button
            class={styles.detailBlacklistBtn}
            classList={{ [styles.detailBlacklistBtnActive]: props.isBlacklisted }}
            title="Toggle marker blacklist"
            onClick={() => props.onToggleBlacklist?.(props.unitId)}
          >
            <Show when={props.isBlacklisted} fallback={<><EyeOffIcon size={12} /> Blacklist {props.markerCount} markers</>}>
              <EyeIcon size={12} /> Restore {props.markerCount} markers
            </Show>
          </button>
        </div>
      </Show>
    </div>
  );
}
