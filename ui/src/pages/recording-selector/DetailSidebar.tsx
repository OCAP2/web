import { Show, For, createSignal, createEffect, on } from "solid-js";
import type { Recording } from "../../data/types";
import { useI18n } from "../../hooks/useLocale";
import { C, SIDE_COLORS, SIDE_HEX } from "./constants";
import { XIcon, CalendarIcon, ClockIcon, UsersIcon, CrosshairIcon, ZapIcon, EditIcon, TrashIcon, RefreshCwIcon, PlayIcon } from "../../components/Icons";
import { formatDuration, formatDate, getMapColor, getStatusInfo, isRecordingReady } from "./helpers";
import { StatPill, TagBadge, StatusBadge } from "./components";
import { basePath } from "../../data/basePath";
import styles from "./RecordingSelector.module.css";

export function DetailSidebar(props: {
  rec: Recording;
  onLaunch: (rec: Recording) => void;
  onClose: () => void;
  isAdmin?: boolean;
  onEdit?: (rec: Recording) => void;
  onDelete?: (rec: Recording) => void;
  onRetry?: (id: string) => void;
  worldDisplayName?: string;
}) {
  const { t, locale } = useI18n();
  const mapColor = () => getMapColor(props.rec.worldName);
  const status = () => getStatusInfo(props.rec);
  const ready = () => isRecordingReady(props.rec);
  const [previewFailed, setPreviewFailed] = createSignal(false);

  // Reset when switching to a different map
  createEffect(on(() => props.rec.worldName, () => setPreviewFailed(false)));

  return (
    <div data-testid="detail-sidebar" class={styles.sidebar}>
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
            data-testid="map-preview"
            src={`${basePath}images/maps/${encodeURIComponent(props.rec.worldName)}/preview_512.png`}
            alt=""
            class={styles.sidebarHeroImg}
            onError={() => setPreviewFailed(true)}
          />
        </Show>
        <div class={styles.sidebarHeroOverlay} />
        <div style={{ "text-align": "center", "z-index": "1" }}>
          <div class={styles.sidebarHeroMapName} style={{ color: mapColor() }}>
            {props.worldDisplayName ?? props.rec.worldName}
          </div>
          <Show when={props.worldDisplayName && props.worldDisplayName !== props.rec.worldName}>
            <div class={styles.sidebarHeroSystemName}>{props.rec.worldName}</div>
          </Show>
        </div>
        <button data-testid="sidebar-close" class={styles.sidebarCloseButton} onClick={() => props.onClose()}>
          <XIcon />
        </button>
      </div>

      {/* Content */}
      <div class={styles.sidebarContent}>
        {/* Title */}
        <div>
          <div class={styles.sidebarTitle}>{props.rec.missionName}</div>
          <div class={styles.sidebarMeta}>
            <Show when={props.rec.tag}>
              <TagBadge tag={props.rec.tag!} />
            </Show>
            <StatusBadge status={status().key} />
          </div>
        </div>

        {/* Stats Grid */}
        <div class={styles.sidebarStatsGrid}>
          <StatPill class={styles.sidebarStatsGridFull} icon={<CalendarIcon />} value={formatDate(props.rec.date, locale())} label={t("date")} />
          <StatPill icon={<ClockIcon />} value={formatDuration(props.rec.missionDuration)} label={t("durability")} />
          <StatPill icon={<UsersIcon />} value={(props.rec.playerCount ?? 0) > 0 ? props.rec.playerCount! : "\u2014"} label={t("players")} />
        </div>

        {/* Force Composition — per-side stat cards */}
        <Show when={props.rec.sideComposition && Object.keys(props.rec.sideComposition).length > 0}>
          {(_) => {
            const SIDE_ORDER: Record<string, number> = { EAST: 0, WEST: 1, GUER: 2, CIV: 3 };
            const entries = () =>
              Object.entries(props.rec.sideComposition!)
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
                              <div class={styles.sideCardStatValue} style={{ color: alive() > 0 ? C.success : C.dimmer }}>{alive().toLocaleString()}</div>
                              <div class={styles.sideCardStatLabel}>{t("alive")}</div>
                            </div>
                            <div class={styles.sideCardStat}>
                              <div class={styles.sideCardStatValue} style={{ color: dead() > 0 ? C.danger : C.dimmer }}>{dead().toLocaleString()}</div>
                              <div class={styles.sideCardStatLabel}>{t("dead")}</div>
                            </div>
                            <div class={styles.sideCardStat}>
                              <div class={styles.sideCardStatValue} style={{ color: kills() > 0 ? C.warning : C.dimmer }}>{kills().toLocaleString()}</div>
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
        <Show when={(props.rec.killCount ?? 0) > 0}>
          {(_) => {
            const kills = () => props.rec.killCount!;
            const playerKills = () => props.rec.playerKillCount ?? 0;
            const killsPerMin = () => {
              const dur = props.rec.missionDuration;
              return dur > 0 ? (kills() / (dur / 60)).toFixed(1) : "\u2014";
            };
            return (
              <div class={styles.sidebarCombatGrid}>
                <div class={styles.sidebarCombatCell} style={{ background: "color-mix(in srgb, var(--accent-danger) 4%, transparent)", "border-color": "color-mix(in srgb, var(--accent-danger) 8%, transparent)" }}>
                  <div class={styles.sidebarCombatCellTop}>
                    <span class={styles.sidebarCombatIcon}><CrosshairIcon /></span>
                    <span class={styles.sidebarCombatCellValue} style={{ color: C.danger }}>{kills().toLocaleString()}</span>
                  </div>
                  <div class={styles.sidebarCombatCellLabel}>{t("total_kills")}</div>
                </div>
                <Show when={playerKills() > 0}>
                  <div class={styles.sidebarCombatCell} style={{ background: "color-mix(in srgb, var(--accent-primary) 4%, transparent)", "border-color": "color-mix(in srgb, var(--accent-primary) 8%, transparent)" }}>
                    <div class={styles.sidebarCombatCellTop}>
                      <span style={{ color: `${C.primary}88` }}><UsersIcon /></span>
                      <span class={styles.sidebarCombatCellValue} style={{ color: C.primary }}>{playerKills().toLocaleString()}</span>
                    </div>
                    <div class={styles.sidebarCombatCellLabel}>{t("player_kills")}</div>
                  </div>
                </Show>
                <div class={styles.sidebarCombatCell} style={{ background: "color-mix(in srgb, var(--accent-warning) 4%, transparent)", "border-color": "color-mix(in srgb, var(--accent-warning) 8%, transparent)" }}>
                  <div class={styles.sidebarCombatCellTop}>
                    <span class={styles.sidebarCombatIconOrange}><ZapIcon /></span>
                    <span class={styles.sidebarCombatCellValue} style={{ color: C.warning }}>{killsPerMin()}</span>
                  </div>
                  <div class={styles.sidebarCombatCellLabel}>{t("kills_per_min")}</div>
                </div>
              </div>
            );
          }}
        </Show>
      </div>

      {/* Admin Actions */}
      <Show when={props.isAdmin}>
        <div class={styles.adminActions}>
          <div class={styles.sidebarSectionLabel} style={{ "margin-bottom": "2px" }}>{t("admin_actions")}</div>
          <div class={styles.adminActionButtons}>
            <button class={styles.adminActionBtn} onClick={() => props.onEdit?.(props.rec)}>
              <EditIcon /> {t("edit")}
            </button>
            <button class={`${styles.adminActionBtn} ${styles.adminActionBtnDanger}`} onClick={() => props.onDelete?.(props.rec)}>
              <TrashIcon /> {t("delete")}
            </button>
            <Show when={props.rec.conversionStatus === "failed"}>
              <button class={styles.adminActionBtn} onClick={() => props.onRetry?.(props.rec.id)}>
                <RefreshCwIcon /> {t("retry")}
              </button>
            </Show>
          </div>
        </div>
      </Show>

      {/* Launch Button */}
      <div class={styles.sidebarLaunchArea}>
        <button
          data-testid="launch-button"
          class={`${styles.launchButton} ${ready() ? styles.launchButtonReady : styles.launchButtonDisabled}`}
          disabled={!ready()}
          onClick={() => ready() && props.onLaunch(props.rec)}
        >
          <Show when={ready()} fallback={<>{t(status().labelKey)}</>}>
            <PlayIcon /> {t("open_recording")}
          </Show>
        </button>
      </div>
    </div>
  );
}
