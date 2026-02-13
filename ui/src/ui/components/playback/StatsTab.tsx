import { createMemo, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Side } from "../../../data/types";
import { Unit } from "../../../playback/entities/unit";
import { SIDE_COLORS_UI, SIDE_BG_COLORS } from "../../../config/side-colors";
import { useEngine } from "../../hooks/useEngine";
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
}

export function StatsTab(): JSX.Element {
  const engine = useEngine();

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
    const { kills, deaths } = killDeathCounts();
    return units
      .filter((u) => (kills.get(u.id) ?? 0) > 0 || (deaths.get(u.id) ?? 0) > 0)
      .sort((a, b) => (kills.get(b.id) ?? 0) - (kills.get(a.id) ?? 0))
      .map((u) => ({
        name: u.name || `Unit ${u.id}`,
        side: u.side,
        kills: kills.get(u.id) ?? 0,
        deaths: deaths.get(u.id) ?? 0,
      }));
  });

  return (
    <div class={styles.tabContent}>
      <div class={styles.statsContainer}>
        {/* Force summary */}
        <div>
          <div class={styles.statsLabel}>FORCES</div>
          <div class={styles.forceSummary} style={{ "margin-top": "8px" }}>
            <For each={sideStats()}>
              {(stat) => {
                const pct = () => stat.total > 0 ? (stat.alive / stat.total) * 100 : 0;
                return (
                  <div
                    class={styles.forceCard}
                    style={{ background: SIDE_BG_COLORS[stat.side] }}
                  >
                    <div
                      class={styles.forceCardLabel}
                      style={{ color: SIDE_COLORS_UI[stat.side] }}
                    >
                      {SIDE_LABELS[stat.side]}
                    </div>
                    <div class={styles.forceStrengthBar}>
                      <div
                        class={styles.forceStrengthFill}
                        style={{
                          width: pct() + "%",
                          background: SIDE_COLORS_UI[stat.side],
                        }}
                      />
                    </div>
                    <div class={styles.forceStats}>
                      <div>
                        <div
                          class={styles.forceStatNum}
                          style={{ color: SIDE_COLORS_UI[stat.side] }}
                        >
                          {stat.alive}<span style={{ color: "#445566", "font-size": "10px" }}>/{stat.total}</span>
                        </div>
                        <div class={styles.forceStatLabel}>Alive</div>
                      </div>
                      <div>
                        <div class={styles.forceStatNum} style={{ color: "#FF4A4A" }}>
                          {stat.kills}
                        </div>
                        <div class={styles.forceStatLabel}>Kills</div>
                      </div>
                      <div>
                        <div class={styles.forceStatNum} style={{ color: "#FFB84A" }}>
                          {stat.deaths}
                        </div>
                        <div class={styles.forceStatLabel}>Deaths</div>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        {/* Leaderboard */}
        <Show when={leaderboard().length > 0}>
          <div>
            <div class={styles.statsLabel}>LEADERBOARD</div>
            <div class={styles.leaderboard} style={{ "margin-top": "8px" }}>
              <div
                class={styles.leaderboardRow}
                style={{ "margin-bottom": "4px" }}
              >
                <span class={styles.leaderboardRank}>#</span>
                <span class={styles.leaderboardName} style={{ color: "#556677", "font-size": "9px" }}>
                  Name
                </span>
                <span class={styles.leaderboardKills} style={{ color: "#556677", "font-size": "9px" }}>
                  K
                </span>
                <span class={styles.leaderboardDeaths} style={{ color: "#556677", "font-size": "9px" }}>
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
