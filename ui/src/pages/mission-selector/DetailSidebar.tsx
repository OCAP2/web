import { Show, For, createSignal, createEffect, on } from "solid-js";
import type { Operation } from "../../data/types";
import { useI18n } from "../../ui/hooks/useLocale";
import { C, SIDE_COLORS, SIDE_HEX } from "./constants";
import { Icons } from "./icons";
import { formatDuration, formatDate, getMapColor, getStatusInfo, isOpReady } from "./helpers";
import { StatPill, TagBadge, StatusBadge } from "./components";
import styles from "./MissionSelector.module.css";

export function DetailSidebar(props: {
  op: Operation;
  onLaunch: (op: Operation) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const mapColor = () => getMapColor(props.op.worldName);
  const status = () => getStatusInfo(props.op);
  const ready = () => isOpReady(props.op);
  const [previewFailed, setPreviewFailed] = createSignal(false);

  // Reset when switching to a different map
  createEffect(on(() => props.op.worldName, () => setPreviewFailed(false)));

  return (
    <div class={styles.sidebar}>
      {/* Map Hero */}
      <div class={styles.sidebarHero} style={{ background: `linear-gradient(135deg, ${mapColor()}15, ${mapColor()}05)` }}>
        <Show when={!previewFailed()} fallback={
          <>
            <svg width="100%" height="100%" class={styles.sidebarHeroFallback}>
              <defs>
                <pattern id="detailGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke={mapColor()} stroke-width="0.5"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#detailGrid)"/>
            </svg>
            <svg width="100%" height="100%" class={styles.sidebarHeroFallback} style={{ opacity: "0.25" }}>
              <ellipse cx="50%" cy="50%" rx="80" ry="50" fill="none" stroke={mapColor()} stroke-width="1"/>
              <ellipse cx="50%" cy="50%" rx="120" ry="75" fill="none" stroke={mapColor()} stroke-width="0.7"/>
              <ellipse cx="50%" cy="50%" rx="160" ry="100" fill="none" stroke={mapColor()} stroke-width="0.5"/>
            </svg>
          </>
        }>
          <img
            src={`${import.meta.env.BASE_URL}images/maps/${encodeURIComponent(props.op.worldName)}/preview_512.png`}
            alt=""
            class={styles.sidebarHeroImg}
            onError={() => setPreviewFailed(true)}
          />
        </Show>
        <div class={styles.sidebarHeroOverlay} />
        <div style={{ "text-align": "center", "z-index": "1" }}>
          <div class={styles.sidebarHeroMapName} style={{ color: mapColor() }}>{props.op.worldName}</div>
          {/* <div class={styles.sidebarHeroTerrain}>{props.op.worldName}</div> */}
        </div>
        <button data-testid="sidebar-close" class={styles.sidebarCloseButton} onClick={() => props.onClose()}>
          <Icons.X />
        </button>
      </div>

      {/* Content */}
      <div class={styles.sidebarContent}>
        {/* Title */}
        <div>
          <div class={styles.sidebarTitle}>{props.op.missionName}</div>
          <div class={styles.sidebarMeta}>
            <Show when={props.op.tag}>
              <TagBadge tag={props.op.tag!} />
            </Show>
            <StatusBadge status={status().key} />
          </div>
        </div>

        {/* Stats Grid */}
        <div class={styles.sidebarStatsGrid}>
          <StatPill class={styles.sidebarStatsGridFull} icon={<Icons.Calendar />} value={formatDate(props.op.date, locale())} label={t("data")} />
          <StatPill icon={<Icons.Clock />} value={formatDuration(props.op.missionDuration)} label={t("durability")} />
          <StatPill icon={<Icons.Users />} value={(props.op.playerCount ?? 0) > 0 ? props.op.playerCount! : "\u2014"} label={t("players")} />
        </div>

        {/* Force Composition — per-side stat cards */}
        <Show when={props.op.sideComposition && Object.keys(props.op.sideComposition).length > 0}>
          {(_) => {
            const SIDE_ORDER: Record<string, number> = { EAST: 0, WEST: 1, GUER: 2, CIV: 3 };
            const entries = () =>
              Object.entries(props.op.sideComposition!)
                .sort(([a], [b]) => (SIDE_ORDER[a] ?? 99) - (SIDE_ORDER[b] ?? 99));
            return (
              <div>
                <div class={styles.sidebarSectionLabel}>{t("force_composition")}</div>
                <div class={styles.sideCardStack}>
                  <For each={entries()}>
                    {([side, count]) => {
                      const color = () => SIDE_COLORS[side] ?? C.muted;
                      const hex = () => SIDE_HEX[side] ?? "#667788";
                      const dead = () => count.dead ?? 0;
                      const kills = () => count.kills ?? 0;
                      const alive = () => count.units - dead();
                      return (
                        <div class={styles.sideCard} style={{ background: `${hex()}08`, "border-color": `${hex()}18` }}>
                          <div class={styles.sideCardHeader}>
                            <div class={styles.sideCardName}>
                              <div class={styles.sidebarSideDot} style={{ background: color() }} />
                              <span style={{ color: color() }}>{side}</span>
                            </div>
                            <Show when={count.players > 0} fallback={
                              <span class={styles.sideCardBadgeAi}>{t("ai_only")}</span>
                            }>
                              <span class={styles.sideCardBadgePlayers}>
                                {count.players} {count.players === 1 ? t("player_singular") : t("players_label")}
                              </span>
                            </Show>
                          </div>
                          <div class={styles.sideCardStats}>
                            <div class={styles.sideCardStat}>
                              <div class={styles.sideCardStatValue}>{count.units.toLocaleString()}</div>
                              <div class={styles.sideCardStatLabel}>{t("total")}</div>
                            </div>
                            <div class={styles.sideCardStat}>
                              <div class={styles.sideCardStatValue} style={{ color: alive() > 0 ? C.green : C.dimmer }}>{alive().toLocaleString()}</div>
                              <div class={styles.sideCardStatLabel}>{t("alive")}</div>
                            </div>
                            <div class={styles.sideCardStat}>
                              <div class={styles.sideCardStatValue} style={{ color: dead() > 0 ? C.red : C.dimmer }}>{dead().toLocaleString()}</div>
                              <div class={styles.sideCardStatLabel}>{t("dead")}</div>
                            </div>
                            <div class={styles.sideCardStat}>
                              <div class={styles.sideCardStatValue} style={{ color: kills() > 0 ? C.orange : C.dimmer }}>{kills().toLocaleString()}</div>
                              <div class={styles.sideCardStatLabel}>{t("kills_label")}</div>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            );
          }}
        </Show>

        {/* Combat Summary — grid layout */}
        <Show when={(props.op.killCount ?? 0) > 0}>
          {(_) => {
            const kills = () => props.op.killCount!;
            const playerKills = () => props.op.playerKillCount ?? 0;
            const killsPerMin = () => {
              const dur = props.op.missionDuration;
              return dur > 0 ? (kills() / (dur / 60)).toFixed(1) : "\u2014";
            };
            return (
              <div class={styles.sidebarCombatGrid}>
                <div class={styles.sidebarCombatCell} style={{ background: "rgba(255,74,74,0.04)", "border-color": "rgba(255,74,74,0.08)" }}>
                  <div class={styles.sidebarCombatCellTop}>
                    <span class={styles.sidebarCombatIcon}><Icons.Crosshair /></span>
                    <span class={styles.sidebarCombatCellValue} style={{ color: C.red }}>{kills().toLocaleString()}</span>
                  </div>
                  <div class={styles.sidebarCombatCellLabel}>{t("total_kills")}</div>
                </div>
                <Show when={playerKills() > 0}>
                  <div class={styles.sidebarCombatCell} style={{ background: "rgba(74,158,255,0.04)", "border-color": "rgba(74,158,255,0.08)" }}>
                    <div class={styles.sidebarCombatCellTop}>
                      <span style={{ color: `${C.blue}88` }}><Icons.Users /></span>
                      <span class={styles.sidebarCombatCellValue} style={{ color: C.blue }}>{playerKills().toLocaleString()}</span>
                    </div>
                    <div class={styles.sidebarCombatCellLabel}>{t("player_kills")}</div>
                  </div>
                </Show>
                <div class={styles.sidebarCombatCell} style={{ background: "rgba(255,184,74,0.04)", "border-color": "rgba(255,184,74,0.08)" }}>
                  <div class={styles.sidebarCombatCellTop}>
                    <span class={styles.sidebarCombatIconOrange}><Icons.Zap /></span>
                    <span class={styles.sidebarCombatCellValue} style={{ color: C.orange }}>{killsPerMin()}</span>
                  </div>
                  <div class={styles.sidebarCombatCellLabel}>{t("kills_per_min")}</div>
                </div>
              </div>
            );
          }}
        </Show>
      </div>

      {/* Launch Button */}
      <div class={styles.sidebarLaunchArea}>
        <button
          data-testid="launch-button"
          class={`${styles.launchButton} ${ready() ? styles.launchButtonReady : styles.launchButtonDisabled}`}
          disabled={!ready()}
          onClick={() => ready() && props.onLaunch(props.op)}
        >
          <Show when={ready()} fallback={<>{t(status().labelKey)}</>}>
            <Icons.Play /> {t("open_replay")}
          </Show>
        </button>
      </div>
    </div>
  );
}
