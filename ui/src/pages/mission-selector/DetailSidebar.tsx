import { Show } from "solid-js";
import type { Operation } from "../../data/types";
import { C, SIDE_COLORS } from "./constants";
import { Icons } from "./icons";
import { formatDuration, formatDate, getMapColor, getStatusInfo, isOpReady } from "./helpers";
import { StatPill, TagBadge, StatusBadge } from "./components";
import styles from "./MissionSelector.module.css";

export function DetailSidebar(props: {
  op: Operation;
  onLaunch: (op: Operation) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const mapColor = () => getMapColor(props.op.worldName);
  const status = () => getStatusInfo(props.op);
  const ready = () => isOpReady(props.op);

  return (
    <div class={styles.sidebar}>
      {/* Map Hero */}
      <div class={styles.sidebarHero} style={{ background: `linear-gradient(135deg, ${mapColor()}15, ${mapColor()}05)` }}>
        {/* Grid pattern */}
        <svg width="100%" height="100%" style={{ position: "absolute", inset: "0", opacity: "0.06" }}>
          <defs>
            <pattern id="detailGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke={mapColor()} stroke-width="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#detailGrid)"/>
        </svg>
        {/* Contour shapes */}
        <svg width="100%" height="100%" style={{ position: "absolute", inset: "0", opacity: "0.08" }}>
          <ellipse cx="50%" cy="50%" rx="80" ry="50" fill="none" stroke={mapColor()} stroke-width="1"/>
          <ellipse cx="50%" cy="50%" rx="120" ry="75" fill="none" stroke={mapColor()} stroke-width="0.7"/>
          <ellipse cx="50%" cy="50%" rx="160" ry="100" fill="none" stroke={mapColor()} stroke-width="0.5"/>
        </svg>
        <div style={{ "text-align": "center", "z-index": "1" }}>
          <div class={styles.sidebarHeroMapName} style={{ color: mapColor() }}>{props.op.worldName}</div>
          <div class={styles.sidebarHeroTerrain}>{props.op.worldName}</div>
        </div>
        <button class={styles.sidebarCloseButton} onClick={() => props.onClose()}>
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
          <StatPill icon={<Icons.Calendar />} value={formatDate(props.op.date)} label="DATE" />
          <StatPill icon={<Icons.Clock />} value={formatDuration(props.op.missionDuration)} label="DURATION" />
          <StatPill icon={<Icons.Users />} value={"\u2014"} label="PLAYERS" />
        </div>

        {/* Force composition placeholder */}
        <div>
          <div class={styles.sidebarSectionLabel}>{props.t("force_composition")}</div>
          <div class={styles.sidebarSideRow}>
            <div class={styles.sidebarSideDot} style={{ background: SIDE_COLORS.BLUFOR }} />
            <span class={styles.sidebarSideName} style={{ color: SIDE_COLORS.BLUFOR }}>BLUFOR</span>
            <div class={styles.sidebarSideBar}>
              <div class={styles.sidebarSideBarFill} style={{ width: "100%", background: SIDE_COLORS.BLUFOR }} />
            </div>
            <span class={styles.sidebarSideCount}>&mdash;</span>
          </div>
        </div>

        {/* Combat Summary placeholder */}
        <div class={styles.sidebarCombat}>
          <div class={styles.sidebarCombatItem}>
            <span class={styles.sidebarCombatIcon}><Icons.Crosshair /></span>
            <div>
              <div class={styles.sidebarCombatValue} style={{ color: C.red }}>&mdash;</div>
              <div class={styles.sidebarCombatLabel}>{props.t("total_kills")}</div>
            </div>
          </div>
          <div class={styles.sidebarCombatDivider} />
          <div class={styles.sidebarCombatItem}>
            <span class={styles.sidebarCombatIconOrange}><Icons.Zap /></span>
            <div>
              <div class={styles.sidebarCombatValue} style={{ color: C.orange }}>&mdash;</div>
              <div class={styles.sidebarCombatLabel}>{props.t("kills_per_min")}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Launch Button */}
      <div class={styles.sidebarLaunchArea}>
        <button
          data-testid="launch-button"
          class={`${styles.launchButton} ${ready() ? styles.launchButtonReady : styles.launchButtonDisabled}`}
          disabled={!ready()}
          onClick={() => ready() && props.onLaunch(props.op)}
        >
          <Show when={ready()} fallback={<>{status().label}</>}>
            <Icons.Play /> {props.t("open_replay")}
            <span class={styles.launchArrow}><Icons.ArrowRight /></span>
          </Show>
        </button>
      </div>
    </div>
  );
}
