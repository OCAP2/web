import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Side } from "../../../data/types";
import { SIDE_COLORS_UI, SIDE_BG_COLORS } from "../../../config/sideColors";
import { useEngine } from "../../../hooks/useEngine";
import { useCustomize } from "../../../hooks/useCustomize";
import { useI18n } from "../../../hooks/useLocale";
import { buildMovementStats, formatDistance, type MovementStats } from "../movement";
import styles from "./SidePanel.module.css";
import commsStyles from "./CommsTab.module.css";
import movementStyles from "./MovementTable.module.css";
import {
  compassFromDegrees,
  formatPercent,
  moonPhaseEmoji,
  moonPhaseName,
} from "../../../data/weather";

const SIDES: Side[] = ["WEST", "EAST", "GUER", "CIV", "VIRTUAL"];

const SIDE_LABELS: Record<Side, string> = {
  WEST: "BLUFOR",
  EAST: "OPFOR",
  GUER: "IND",
  CIV: "CIV",
  VIRTUAL: "VIRTUAL",
};

interface SideStats {
  side: Side;
  total: number;
  alive: number;
  kills: number;
  deaths: number;
  teamKills: number;
}

interface LeaderboardEntry {
  name: string;
  side: Side;
  kills: number;
  deaths: number;
  vehicleKills: number;
  teamKills: number;
}

export function StatsTab(): JSX.Element {
  const engine = useEngine();
  const customize = useCustomize();
  const { t } = useI18n();
  const showPlayerKillCount = (): boolean => !customize().disableKillCount;

  const weather = createMemo(() =>
    engine.eventManager.getWeatherAt(engine.currentFrame()),
  );

  const weatherMetrics = createMemo(() => {
    const sample = weather();
    if (!sample) return undefined;
    const metrics: { value: string; label: string }[] = [
      { value: formatPercent(sample.overcast), label: t("weather_overcast") },
    ];
    if (sample.rain !== undefined) {
      metrics.push({ value: formatPercent(sample.rain), label: t("weather_rain") });
    }
    if (sample.fog !== undefined) {
      metrics.push({ value: formatPercent(sample.fog), label: t("weather_fog") });
    }
    if (sample.windSpeed !== undefined) {
      const dir = sample.windDir !== undefined
        ? `${compassFromDegrees(sample.windDir)} ${Math.round(sample.windDir)}°`
        : "";
      metrics.push({
        value: `${sample.windSpeed.toFixed(1)} m/s`,
        label: dir ? `${t("weather_wind")} ${dir}` : t("weather_wind"),
      });
    } else if (sample.windDir !== undefined) {
      metrics.push({
        value: `${compassFromDegrees(sample.windDir)} ${Math.round(sample.windDir)}°`,
        label: t("weather_wind"),
      });
    }
    if (sample.humidity !== undefined) {
      metrics.push({ value: formatPercent(sample.humidity), label: t("weather_humidity") });
    }
    if (sample.temperature !== undefined) {
      metrics.push({
        value: `${sample.temperature.toFixed(1)} °C`,
        label: t("weather_temperature"),
      });
    }
    if (sample.moonPhase !== undefined) {
      metrics.push({
        value: `${moonPhaseEmoji(sample.moonPhase)} ${formatPercent(sample.moonPhase)}`,
        label: t(`weather_moon_${moonPhaseName(sample.moonPhase)}`),
      });
    }
    if (sample.gusts !== undefined) {
      metrics.push({ value: formatPercent(sample.gusts), label: t("weather_gusts") });
    }
    if (sample.lightnings !== undefined) {
      metrics.push({ value: formatPercent(sample.lightnings), label: t("weather_lightnings") });
    }
    if (sample.waves !== undefined) {
      metrics.push({ value: formatPercent(sample.waves), label: t("weather_waves") });
    }
    return metrics;
  });

  // Accumulate totals while each chunk is held; retain only the resulting rows.
  const [movement, setMovement] = createSignal<MovementStats[]>([]);
  const [movementReady, setMovementReady] = createSignal(false);
  createEffect(() => {
    engine.endFrame();
    let active = true;
    onCleanup(() => { active = false; });
    setMovement([]);
    setMovementReady(false);
    void buildMovementStats(engine).then((stats) => {
      if (active) setMovement(stats);
    }).catch((error) => console.error("Failed to analyze movement", error))
      .finally(() => { if (active) setMovementReady(true); });
  });

  // Frame-aware kill/death counts
  const killDeathCounts = createMemo(() => {
    engine.eventReferencesVersion();
    return engine.eventManager.getKillDeathCounts(engine.currentFrame());
  });

  const sideStats = createMemo((): SideStats[] => {
    const snaps = engine.entitySnapshots();
    const units = engine.entityManager.getUnits();
    const { kills, deaths, teamKills } = killDeathCounts();
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
      const sideTeamKills = sideUnits.reduce((s, u) => s + (teamKills.get(u.id) ?? 0), 0);
      return { side, total, alive, kills: sideKills, deaths: sideDeaths, teamKills: sideTeamKills };
    }).filter((s) => s.total > 0);
  });

  const leaderboard = createMemo((): LeaderboardEntry[] => {
    const units = engine.entityManager.getUnits();
    const { kills, deaths, vehicleKills, teamKills } = killDeathCounts();
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
        teamKills: teamKills.get(u.id) ?? 0,
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
                      <div class={styles.forceStatPill}>
                        <div
                          class={styles.forceStatNum}
                          classList={{ [styles.forceStatNumTeamKills]: stat.teamKills > 0 }}
                        >
                          {stat.teamKills}
                        </div>
                        <div class={styles.forceStatLabel}>{t("team_kills_label")}</div>
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
                <span class={styles.leaderboardTeamKills} style={{ color: "var(--text-dimmer)", "font-size": "9px" }}>
                  {t("team_kills_label")}
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
                    <span class={styles.leaderboardTeamKills}>{entry.teamKills}</span>
                    <span class={styles.leaderboardDeaths}>{entry.deaths}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={weatherMetrics()} keyed>
          {(metrics) => (
            <div>
              <div class={styles.weatherHeader}>
                <div class={`${styles.statsLabel} ${styles.serverFpsTitle}`}>{t("weather")}</div>
                <div class={styles.weatherSource}>
                  {weather()?.ace ? t("weather_ace") : t("weather_vanilla")}
                </div>
              </div>
              <div class={styles.weatherCard}>
                <For each={metrics}>
                  {(metric) => (
                    <div class={styles.weatherMetric}>
                      <div class={styles.weatherValue}>{metric.value}</div>
                      <div class={styles.weatherLabel}>{metric.label}</div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </Show>

        {/* ── Distance and pace ── */}
        <div class={styles.statsLabel}>{t("movement")}</div>
        <Show
          when={movementReady()}
          fallback={<div class={commsStyles.note}>{t("movement_loading")}</div>}
        >
          <Show
            when={movement().length > 0}
            fallback={<div class={commsStyles.note}>{t("movement_none")}</div>}
          >
            <div class={styles.leaderboard} style={{ "margin-top": "8px" }}>
              <div class={styles.leaderboardRow} style={{ "margin-bottom": "4px" }}>
                <span class={styles.leaderboardRank}>#</span>
                <span
                  class={styles.leaderboardName}
                  style={{ color: "var(--text-dimmer)", "font-size": "9px" }}
                >
                  {t("name")}
                </span>
                <span class={movementStyles.col} title={t("movement_on_foot")}>
                  {t("movement_foot_short")}
                </span>
                <span class={movementStyles.col} title={t("movement_mounted")}>
                  {t("movement_mounted_short")}
                </span>
                <span class={movementStyles.colTotal} title={t("movement_total")}>
                  {t("movement_total_short")}
                </span>
              </div>
              <For each={movement().slice(0, 20)}>
                {(entry, i) => (
                  <div
                    class={styles.leaderboardRow}
                    classList={{ [styles.leaderboardRowAlt]: i() % 2 === 1 }}
                  >
                    <span class={styles.leaderboardRank}>{i() + 1}</span>
                    <span
                      class={styles.leaderboardName}
                      style={{ color: entry.side ? SIDE_COLORS_UI[entry.side] : undefined }}
                    >
                      {entry.name}
                    </span>
                    <span class={movementStyles.col}>{formatDistance(entry.onFoot)}</span>
                    <span class={movementStyles.col}>{formatDistance(entry.mounted)}</span>
                    <span class={movementStyles.colTotal}>{formatDistance(entry.total)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
