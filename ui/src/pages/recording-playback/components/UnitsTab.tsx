import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Side } from "../../../data/types";
import type { Unit } from "../../../playback/entities/unit";
import { SIDE_COLORS_UI, SIDE_BG_COLORS } from "../../../config/side-colors";
import { useEngine } from "../../../hooks/useEngine";
import { useI18n } from "../../../hooks/useLocale";
import { CrosshairIcon, ChevronRightIcon } from "./Icons";
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

export function UnitsTab(): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();
  const [activeSide, setActiveSide] = createSignal<Side>("WEST");
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());

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
                      const followed = () => engine.followTarget() === unit.id;
                      return (
                        <button
                          class={styles.unitRow}
                          classList={{
                            [styles.unitRowSelected]: followed(),
                            [styles.unitRowDead]: !alive(),
                          }}
                          onClick={() =>
                            engine.followTarget() === unit.id
                              ? engine.unfollowEntity()
                              : engine.followEntity(unit.id)
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
                          <Show when={(killDeathCounts().kills.get(unit.id) ?? 0) > 0}>
                            <span class={styles.unitKills}>
                              <CrosshairIcon size={10} />
                              {killDeathCounts().kills.get(unit.id)}
                            </span>
                          </Show>
                        </button>
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
