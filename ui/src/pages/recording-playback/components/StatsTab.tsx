import { createMemo, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Side } from "../../../data/types";
import { SIDE_COLORS_UI, SIDE_BG_COLORS } from "../../../config/sideColors";
import { useEngine } from "../../../hooks/useEngine";
import { useCustomize } from "../../../hooks/useCustomize";
import { useI18n } from "../../../hooks/useLocale";
import styles from "./SidePanel.module.css";

const SIDES: Side[] = ["WEST", "EAST", "GUER", "CIV"];

const SIDE_LABELS: Record<Side, string> = {
  WEST: "BLUFOR",
  EAST: "OPFOR",
  GUER: "IND",
  CIV: "CIV",
};

interface SideStats {
  side: Side;
  total: number;
  alive: number;
  kills: number;
  deaths: number;
}

interface LeaderboardEntry {
  name: string;
  side: Side;
  kills: number;
  deaths: number;
  vehicleKills: number;
}

export function StatsTab(): JSX.Element {
  const engine = useEngine();
  const customize = useCustomize();
  const { t } = useI18n();
  const showPlayerKillCount = (): boolean => !customize().disableKillCount;

  // Frame-aware kill/death counts
  const killDeathCounts = createMemo(() =>
    engine.eventManager.getKillDeathCounts(engine.currentFrame()),
  );

  const sideStats = createMemo((): SideStats[] => {
    const snaps = engine.entitySnapshots();
    const units = engine.entityManager.getUnits();
    const { kills, deaths } = killDeathCounts();
    return SIDES.map((side) => {
      const sideUnits = units.filter((u) => u.side === side);
      const total = sideUnits.length;
      let alive = 0;
      for (const u of sideUnits) {
        const snap = snaps.get(u.id);
        if (snap && snap.alive) alive++;
      }
      const sideKills = sideUnits.reduce((s, u) => s + (kills.get(u.id) ?? 0), 0);
      const sideDeaths = sideUnits.reduce((s, u) => s + (deaths.get(u.id) ?? 0), 0);
      return { side, total, alive, kills: sideKills, deaths: sideDeaths };
    }).filter((s) => s.total > 0);
  });

  const leaderboard = createMemo((): LeaderboardEntry[] => {
    const units = engine.entityManager.getUnits();
    const { kills, deaths, vehicleKills } = killDeathCounts();
    return units
      .filter((u) => u.isPlayer && (
        (kills.get(u.id) ?? 0) > 0 ||
        (deaths.get(u.id) ?? 0) > 0 ||
        (vehicleKills.get(u.id) ?? 0) > 0
      ))
      .sort((a, b) => {
        const diff = (kills.get(b.id) ?? 0) - (kills.get(a.id) ?? 0);
        if (diff !== 0) return diff;
        return (vehicleKills.get(b.id) ?? 0) - (vehicleKills.get(a.id) ?? 0);
      })
      .map((u) => ({
        name: u.name || `Unit ${u.id}`,
        side: u.side,
        kills: kills.get(u.id) ?? 0,
        deaths: deaths.get(u.id) ?? 0,
        vehicleKills: vehicleKills.get(u.id) ?? 0,
      }));
  });

  return (
    <div class={styles.tabContent}>
      <div class={styles.statsContainer}>
        {/* Force summary */}
        <div>
          <div class={styles.statsLabel}>{t("force_summary")}</div>
          <div class={styles.forceSummary} style={{ "margin-top": "8px" }}>
            <For each={sideStats()}>
              {(stat) => {
                return (
                  <div
                    class={styles.forceCard}
                    style={{
                      background: SIDE_BG_COLORS[stat.side],
                      border: `1px solid ${SIDE_COLORS_UI[stat.side]}20`,
                    }}
                  >
                    <div class={styles.forceCardHeader}>
                      <span
                        class={styles.forceCardDot}
                        style={{ background: SIDE_COLORS_UI[stat.side] }}
                      />
                      <span
                        class={styles.forceCardLabel}
                        style={{ color: SIDE_COLORS_UI[stat.side] }}
                      >
                        {SIDE_LABELS[stat.side]}
                      </span>
                    </div>
                    <div class={styles.forceStatGrid}>
                      <div class={styles.forceStatPill}>
                        <div class={`${styles.forceStatNum} ${styles.forceStatNumTotal}`}>
                          {stat.total}
                        </div>
                        <div class={styles.forceStatLabel}>{t("total")}</div>
                      </div>
                      <div class={styles.forceStatPill}>
                        <div class={`${styles.forceStatNum} ${styles.forceStatNumAlive}`}>
                          {stat.alive}
                        </div>
                        <div class={styles.forceStatLabel}>{t("alive")}</div>
                      </div>
                      <div class={styles.forceStatPill}>
                        <div
                          class={styles.forceStatNum}
                          classList={{ [styles.forceStatNumKills]: stat.kills > 0 }}
                        >
                          {stat.kills}
                        </div>
                        <div class={styles.forceStatLabel}>{t("kills_label")}</div>
                      </div>
                      <div class={styles.forceStatPill}>
                        <div
                          class={styles.forceStatNum}
                          classList={{ [styles.forceStatNumDeaths]: stat.deaths > 0 }}
                        >
                          {stat.deaths}
                        </div>
                        <div class={styles.forceStatLabel}>{t("deaths_label")}</div>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        {/* Leaderboard */}
        <Show when={showPlayerKillCount() && leaderboard().length > 0}>
          <div>
            <div class={styles.statsLabel}>{t("leaderboard")}</div>
            <div class={styles.leaderboard} style={{ "margin-top": "8px" }}>
              <div
                class={styles.leaderboardRow}
                style={{ "margin-bottom": "4px" }}
              >
                <span class={styles.leaderboardRank}>#</span>
                <span class={styles.leaderboardName} style={{ color: "var(--text-dimmer)", "font-size": "9px" }}>
                  {t("name")}
                </span>
                <span class={styles.leaderboardKills} style={{ color: "var(--text-dimmer)", "font-size": "9px" }}>
                  K
                </span>
                <span class={styles.leaderboardVehicleKills} style={{ color: "var(--text-dimmer)", "font-size": "9px" }}>
                  VK
                </span>
                <span class={styles.leaderboardDeaths} style={{ color: "var(--text-dimmer)", "font-size": "9px" }}>
                  D
                </span>
              </div>
              <For each={leaderboard()}>
                {(entry, i) => (
                  <div
                    class={styles.leaderboardRow}
                    classList={{ [styles.leaderboardRowAlt]: i() % 2 === 1 }}
                  >
                    <span class={styles.leaderboardRank}>{i() + 1}</span>
                    <span
                      class={styles.leaderboardName}
                      style={{ color: SIDE_COLORS_UI[entry.side] }}
                    >
                      {entry.name}
                    </span>
                    <span class={styles.leaderboardKills}>{entry.kills}</span>
                    <span class={styles.leaderboardVehicleKills}>{entry.vehicleKills}</span>
                    <span class={styles.leaderboardDeaths}>{entry.deaths}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
