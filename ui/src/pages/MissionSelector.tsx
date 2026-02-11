import { createSignal, createMemo, Show, For, onMount, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { Operation } from "../data/types";
import { ApiClient, type BuildInfo } from "../data/api-client";
import { useI18n } from "../ui/hooks/useLocale";
import { LOCALES } from "../ui/i18n/i18n";
import type { Locale } from "../ui/i18n/i18n";
import styles from "./MissionSelector.module.css";

// ─── Constants ───

// All accent colors in one place — CSS vars for inline styles
const C = {
  blue:    "var(--ms-accent-blue)",
  red:     "var(--ms-accent-red)",
  green:   "var(--ms-accent-green)",
  purple:  "var(--ms-accent-purple)",
  orange:  "var(--ms-accent-orange)",
  muted:   "var(--ms-text-muted)",
  dimmer:  "var(--ms-text-dimmer)",
} as const;

const MAP_COLORS: Record<string, string> = {
  altis: C.blue,
  stratis: C.purple,
  tanoa: "#FF9F43",
  livonia: C.orange,
  malden: C.green,
  enoch: C.orange,
  vr: C.muted,
};

const TAG_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  TvT:      { bg: "rgba(255,74,74,0.12)",  color: "#FF6B6B",  border: "rgba(255,74,74,0.2)" },
  COOP:     { bg: "rgba(74,158,255,0.12)", color: "#6BB3FF",  border: "rgba(74,158,255,0.2)" },
  Zeus:     { bg: "rgba(167,139,250,0.12)", color: "#B5A3FA", border: "rgba(167,139,250,0.2)" },
  Training: { bg: "rgba(255,184,74,0.12)",  color: "#FFC66B", border: "rgba(255,184,74,0.2)" },
};

const STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  ready:      { label: "Ready",      color: C.green,  icon: "\u25CF" },
  streaming:  { label: "Streaming",  color: C.blue,   icon: "\u25C9" },
  converting: { label: "Converting", color: C.orange,  icon: "\u25CC" },
  pending:    { label: "Pending",    color: C.muted,  icon: "\u25CB" },
  failed:     { label: "Failed",     color: C.red,    icon: "\u2715" },
};

const SIDE_COLORS: Record<string, string> = {
  BLUFOR: C.blue,  WEST: C.blue,
  OPFOR:  C.red,   EAST: C.red,
  IND:    C.green, GUER: C.green,
  CIV:    C.purple,
};

const LOCALE_LABELS: Record<Locale, { label: string; flag: string }> = {
  en: { label: "English",  flag: "\uD83C\uDDEC\uD83C\uDDE7" },
  de: { label: "Deutsch",  flag: "\uD83C\uDDE9\uD83C\uDDEA" },
  ru: { label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",  flag: "\uD83C\uDDF7\uD83C\uDDFA" },
  cs: { label: "\u010Ce\u0161tina",  flag: "\uD83C\uDDE8\uD83C\uDDFF" },
  it: { label: "Italiano", flag: "\uD83C\uDDEE\uD83C\uDDF9" },
};

// ─── Icons ───

const Icons = {
  Search: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Calendar: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Clock: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Users: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Crosshair: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>,
  Play: () => <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>,
  Map: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  Tag: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  X: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  ChevronDown: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>,
  ArrowRight: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  Globe: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Zap: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>,
  SortAsc: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 5v14M5 12l7 7 7-7"/></svg>,
  SortDesc: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 19V5M5 12l7-7 7 7"/></svg>,
  GitHub: () => <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>,
  ExternalLink: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  Heart: () => <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
};

// ─── Helpers ───

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m 0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function relativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  return `${Math.floor(diff / 30)}mo ago`;
}

function getMapColor(worldName: string): string {
  return MAP_COLORS[worldName.toLowerCase()] || C.muted;
}

function getStatusInfo(op: Operation): { label: string; color: string; icon: string; key: string } {
  const format = op.storageFormat || "json";
  const conversionStatus = op.conversionStatus || "completed";
  if (conversionStatus === "pending") return { ...STATUS_MAP.pending, key: "pending" };
  if (conversionStatus === "converting") return { ...STATUS_MAP.converting, key: "converting" };
  if (conversionStatus === "failed") return { ...STATUS_MAP.failed, key: "failed" };
  if (format === "protobuf") return { ...STATUS_MAP.streaming, key: "streaming" };
  return { ...STATUS_MAP.ready, key: "ready" };
}

function isOpReady(op: Operation): boolean {
  const s = getStatusInfo(op);
  return s.key === "ready" || s.key === "streaming";
}

// ─── OCAP Logo SVG ───

function OcapLogoSvg(props: { size?: number }) {
  const s = props.size ?? 42;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
      <circle cx={s / 2} cy={s / 2} r={s / 2 - 2} stroke="url(#logoGrad)" stroke-width="1.5" opacity="0.3"/>
      <circle cx={s / 2} cy={s / 2} r={s * 0.095} fill={C.blue}/>
      <circle cx={s * 0.238} cy={s * 0.286} r={s * 0.06} fill={C.red}/>
      <circle cx={s * 0.762} cy={s * 0.286} r={s * 0.06} fill={C.red}/>
      <circle cx={s * 0.238} cy={s * 0.714} r={s * 0.06} fill={C.blue}/>
      <circle cx={s * 0.762} cy={s * 0.714} r={s * 0.06} fill={C.blue}/>
      <circle cx={s / 2} cy={s * 0.143} r={s * 0.048} fill={C.green}/>
      <circle cx={s / 2} cy={s * 0.857} r={s * 0.048} fill={C.green}/>
      <line x1={s / 2} y1={s / 2} x2={s * 0.238} y2={s * 0.286} stroke={C.red} stroke-width="1" opacity="0.4"/>
      <line x1={s / 2} y1={s / 2} x2={s * 0.762} y2={s * 0.286} stroke={C.red} stroke-width="1" opacity="0.4"/>
      <line x1={s / 2} y1={s / 2} x2={s * 0.238} y2={s * 0.714} stroke={C.blue} stroke-width="1" opacity="0.4"/>
      <line x1={s / 2} y1={s / 2} x2={s * 0.762} y2={s * 0.714} stroke={C.blue} stroke-width="1" opacity="0.4"/>
      <line x1={s / 2} y1={s / 2} x2={s / 2} y2={s * 0.143} stroke={C.green} stroke-width="1" opacity="0.3"/>
      <line x1={s / 2} y1={s / 2} x2={s / 2} y2={s * 0.857} stroke={C.green} stroke-width="1" opacity="0.3"/>
      <circle cx={s / 2} cy={s / 2} r={s * 0.143} fill={C.blue} opacity="0.1"/>
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2={s} y2={s}>
          <stop offset="0%" style={{ "stop-color": C.blue }}/>
          <stop offset="100%" style={{ "stop-color": C.green }}/>
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Sub-components ───

function StatPill(props: { icon: JSX.Element; value: string | number; label: string }) {
  return (
    <div class={styles.statPill}>
      <div class={styles.statPillValue}>
        <span class={styles.statPillIcon}>{props.icon}</span>
        <span class={styles.statPillNumber}>{props.value}</span>
      </div>
      <span class={styles.statPillLabel}>{props.label}</span>
    </div>
  );
}

function TagBadge(props: { tag: string; clickable?: boolean; active?: boolean; onClick?: () => void }) {
  const tc = () => TAG_COLORS[props.tag] || { bg: "rgba(255,255,255,0.06)", color: C.muted, border: "rgba(255,255,255,0.1)" };
  const isActive = () => props.active !== false;
  return (
    <button
      class={`${styles.tagBadge} ${props.clickable ? styles.tagBadgeClickable : ""}`}
      style={{
        color: isActive() ? tc().color : "var(--ms-text-dimmer)",
        background: isActive() ? tc().bg : "rgba(255,255,255,0.02)",
        "border-color": isActive() ? tc().border : "rgba(255,255,255,0.05)",
      }}
      onClick={() => props.onClick?.()}
    >
      {props.tag}
    </button>
  );
}

function StatusBadge(props: { status: string }) {
  const info = () => {
    const si = STATUS_MAP[props.status];
    return si || STATUS_MAP.pending;
  };
  return (
    <div class={styles.statusBadge} style={{ color: info().color }}>
      <span
        class={`${styles.statusIcon} ${props.status === "converting" ? styles.statusIconSpin : ""} ${props.status === "streaming" ? styles.statusIconPulse : ""}`}
        style={{ "font-size": props.status === "converting" ? "10px" : "8px" }}
      >
        {info().icon}
      </span>
      {info().label}
    </div>
  );
}

function SortHeader(props: {
  label: string;
  sortKey: string;
  currentSort: string;
  currentDir: string;
  onSort: (key: string) => void;
}) {
  const active = () => props.currentSort === props.sortKey;
  return (
    <button
      class={`${styles.sortButton} ${active() ? styles.sortButtonActive : ""}`}
      onClick={() => props.onSort(props.sortKey)}
    >
      {props.label}
      <Show when={active()}>
        {props.currentDir === "asc" ? <Icons.SortDesc /> : <Icons.SortAsc />}
      </Show>
    </button>
  );
}

function MissionRow(props: {
  op: Operation;
  selected: boolean;
  onSelect: (id: string) => void;
  onLaunch: (op: Operation) => void;
  index: number;
}) {
  const mapColor = () => getMapColor(props.op.worldName);
  const status = () => getStatusInfo(props.op);
  const ready = () => isOpReady(props.op);
  const delay = () => `${Math.min(props.index * 0.03, 0.3)}s`;

  return (
    <div
      data-testid={`operation-${props.op.id}`}
      class={`${styles.missionRow} ${props.selected ? styles.missionRowSelected : ""}`}
      style={{ animation: `stagger 0.3s ease-out ${delay()} both` }}
      onClick={() => props.onSelect(props.op.id)}
    >
      {/* Mission Name */}
      <div class={styles.rowMission}>
        <div
          class={styles.rowMapIcon}
          style={{
            background: `linear-gradient(135deg, ${mapColor()}22, ${mapColor()}08)`,
            border: `1px solid ${mapColor()}30`,
            color: mapColor(),
          }}
        >
          <Icons.Globe />
        </div>
        <div class={styles.rowMissionInfo}>
          <div class={styles.rowMissionName}>{props.op.missionName}</div>
          <div class={styles.rowMapName}>{props.op.worldName}</div>
        </div>
      </div>

      {/* Date */}
      <div class={styles.rowDate}>
        <span class={styles.rowDateValue}>{formatDate(props.op.date)}</span>
        <span class={styles.rowDateRelative}>{relativeDate(props.op.date)}</span>
      </div>

      {/* Duration */}
      <div class={styles.rowDuration}>{formatDuration(props.op.missionDuration)}</div>

      {/* Players — placeholder */}
      <div class={styles.rowPlayers}>
        <span class={styles.rowPlayersIcon}><Icons.Users /></span>
        <span class={styles.rowPlayersValue}>&mdash;</span>
      </div>

      {/* Kills — placeholder */}
      <div class={styles.rowKills}>
        <span class={styles.rowKillsIcon}><Icons.Crosshair /></span>
        <span class={styles.rowKillsValue} style={{ color: "var(--ms-text-dimmer)" }}>&mdash;</span>
      </div>

      {/* Tag */}
      <Show when={props.op.tag} fallback={<span />}>
        <TagBadge tag={props.op.tag!} />
      </Show>

      {/* Status + Play */}
      <div class={styles.rowStatus}>
        <StatusBadge status={status().key} />
        <Show when={ready() && props.selected}>
          <button
            class={styles.playButton}
            onClick={(e) => { e.stopPropagation(); props.onLaunch(props.op); }}
          >
            <Icons.Play />
          </button>
        </Show>
      </div>
    </div>
  );
}

function DetailSidebar(props: {
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

// ─── Main Component ───

export function MissionSelector(): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const api = new ApiClient();

  // State
  const [operations, setOperations] = createSignal<Operation[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [tagFilter, setTagFilter] = createSignal<string | null>(null);
  const [mapFilter, setMapFilter] = createSignal<string | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [sortBy, setSortBy] = createSignal("date");
  const [sortDir, setSortDir] = createSignal("desc");
  const [launched, setLaunched] = createSignal<Operation | null>(null);
  const [langOpen, setLangOpen] = createSignal(false);
  const [buildInfo, setBuildInfo] = createSignal<BuildInfo | null>(null);

  let searchRef: HTMLInputElement | undefined;

  // Fetch operations
  onMount(async () => {
    setLoading(true);
    try {
      const [ops, info] = await Promise.all([
        api.getOperations(),
        api.getVersion().catch(() => null),
      ]);
      setOperations(ops.reverse());
      if (info) setBuildInfo(info);
    } catch {
      setOperations([]);
    } finally {
      setLoading(false);
    }
  });

  // Keyboard shortcuts
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "/" && document.activeElement !== searchRef) {
      e.preventDefault();
      searchRef?.focus();
    }
    if (e.key === "Escape") {
      setSelectedId(null);
      setLangOpen(false);
      searchRef?.blur();
    }
    if (e.key === "Enter" && selectedId()) {
      const op = operations().find((o) => o.id === selectedId());
      if (op && isOpReady(op)) handleLaunch(op);
    }
  };

  onMount(() => window.addEventListener("keydown", handleKeydown));
  onCleanup(() => window.removeEventListener("keydown", handleKeydown));

  // Sort handler
  const handleSort = (key: string) => {
    if (sortBy() === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  // Derived data
  const uniqueMaps = createMemo(() => [...new Set(operations().map((o) => o.worldName))]);
  const uniqueTags = createMemo(() => [...new Set(operations().map((o) => o.tag).filter(Boolean))] as string[]);

  const filtered = createMemo(() => {
    let result = [...operations()];
    const s = search().toLowerCase();
    if (s) {
      result = result.filter((op) =>
        op.missionName.toLowerCase().includes(s) ||
        op.worldName.toLowerCase().includes(s)
      );
    }
    const tf = tagFilter();
    if (tf) result = result.filter((op) => op.tag === tf);
    const mf = mapFilter();
    if (mf) result = result.filter((op) => op.worldName === mf);

    const sb = sortBy();
    const sd = sortDir();
    result.sort((a, b) => {
      let cmp = 0;
      switch (sb) {
        case "date": cmp = new Date(a.date).getTime() - new Date(b.date).getTime(); break;
        case "name": cmp = a.missionName.localeCompare(b.missionName); break;
        case "duration": cmp = a.missionDuration - b.missionDuration; break;
        default: cmp = 0;
      }
      return sd === "desc" ? -cmp : cmp;
    });
    return result;
  });

  const selectedOp = createMemo(() => {
    const id = selectedId();
    return id ? operations().find((o) => o.id === id) ?? null : null;
  });

  const serverVersion = () => {
    const info = buildInfo();
    if (!info) return "—";
    return info.BuildVersion || info.BuildCommit || "—";
  };

  const hasFilters = () => search() || tagFilter() || mapFilter();

  const clearFilters = () => {
    setSearch("");
    setTagFilter(null);
    setMapFilter(null);
  };

  // Launch handler
  const handleLaunch = (op: Operation) => {
    setLaunched(op);
    setTimeout(() => {
      const id = op.filename ?? op.id;
      navigate(`/recording/${encodeURIComponent(id)}`);
    }, 2000);
  };

  // ── Loading transition ──
  const launchedOp = () => launched();
  return (
    <Show when={!launchedOp()} fallback={
      <div class={styles.loadingScreen} data-testid="loading-screen">
        <div class={styles.loadingContent}>
          <div class={styles.loadingLogo}>
            <OcapLogoSvg size={56} />
          </div>
          <div class={styles.loadingTitle}>Loading {launchedOp()!.missionName}</div>
          <div class={styles.loadingSubtitle}>{launchedOp()!.worldName} &middot; {formatDuration(launchedOp()!.missionDuration)}</div>
          <div class={styles.loadingBarTrack}>
            <div class={styles.loadingBarFill} />
          </div>
          <div class={styles.loadingHint}>Initializing replay engine...</div>
        </div>
      </div>
    }>
      <div data-testid="mission-selector" class={styles.page}>
        {/* ── Header ── */}
        <header class={styles.header}>
          <div class={styles.headerRow}>
            <div class={styles.logoArea}>
              <div class={styles.logoWrap}>
                <OcapLogoSvg />
              </div>
              <div>
                <div class={styles.titleGroup}>
                  <span class={styles.title}>OCAP</span>
                  <span class={styles.versionBadge}>v2</span>
                </div>
                <div class={styles.subtitle}>
                  Operation Capture and Playback &middot; {operations().length} {t("recordings")}
                </div>
              </div>
            </div>

            {/* Right side: stats + language */}
            <div class={styles.statsArea}>
              <div class={styles.statPills}>
                <StatPill icon={<Icons.Globe />} value={uniqueMaps().length} label={t("maps_label")} />
                <StatPill icon={<Icons.Users />} value={"\u2014"} label={t("max_players")} />
                <StatPill icon={<Icons.Crosshair />} value={"\u2014"} label={t("total_kills")} />
              </div>

              <div class={styles.divider} />

              {/* Language Selector */}
              <div class={styles.langSelector}>
                <button class={styles.langButton} onClick={() => setLangOpen(!langOpen())}>
                  <span class={styles.langFlag}>{LOCALE_LABELS[locale()]?.flag}</span>
                  <span class={styles.langLabel}>{LOCALE_LABELS[locale()]?.label}</span>
                  <span class={`${styles.langChevron} ${langOpen() ? styles.langChevronOpen : ""}`}>
                    <Icons.ChevronDown />
                  </span>
                </button>
                <Show when={langOpen()}>
                  <div class={styles.langOverlay} onClick={() => setLangOpen(false)} />
                  <div class={styles.langDropdown}>
                    <div class={styles.langDropdownTitle}>LANGUAGE</div>
                    <For each={LOCALES}>
                      {(loc) => (
                        <button
                          class={`${styles.langOption} ${locale() === loc ? styles.langOptionActive : ""}`}
                          onClick={() => { setLocale(loc); setLangOpen(false); }}
                        >
                          <span class={styles.langOptionFlag}>{LOCALE_LABELS[loc]?.flag}</span>
                          <span class={`${styles.langOptionLabel} ${locale() === loc ? styles.langOptionLabelActive : ""}`}>
                            {LOCALE_LABELS[loc]?.label}
                          </span>
                          <Show when={locale() === loc}>
                            <span class={styles.langOptionCheck}>{"\u2713"}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </div>

          {/* ── Filter bar ── */}
          <div class={styles.filterBar}>
            {/* Search */}
            <div class={styles.searchWrap}>
              <span class={styles.searchIcon}><Icons.Search /></span>
              <input
                ref={searchRef}
                data-testid="search-input"
                type="text"
                placeholder={t("search_placeholder")}
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                class={styles.searchInput}
              />
              <kbd class={styles.searchKbd}>/</kbd>
            </div>

            {/* Tag filters */}
            <div class={styles.tagFilters}>
              <span class={styles.tagIcon}><Icons.Tag /></span>
              <For each={uniqueTags()}>
                {(tag) => (
                  <TagBadge
                    tag={tag}
                    clickable
                    active={tagFilter() === null || tagFilter() === tag}
                    onClick={() => setTagFilter(tagFilter() === tag ? null : tag)}
                  />
                )}
              </For>
            </div>

            {/* Map filters */}
            <Show when={uniqueMaps().length > 1}>
              <div class={styles.mapFilters}>
                <span class={styles.mapIcon}><Icons.Map /></span>
                <For each={uniqueMaps()}>
                  {(mapName) => {
                    const color = getMapColor(mapName);
                    const active = () => mapFilter() === null || mapFilter() === mapName;
                    return (
                      <button
                        class={styles.mapButton}
                        style={{
                          background: active() ? `${color}18` : "rgba(255,255,255,0.02)",
                          color: active() ? color : "var(--ms-text-dimmer)",
                          border: `1px solid ${active() ? color + "30" : "rgba(255,255,255,0.05)"}`,
                        }}
                        onClick={() => setMapFilter(mapFilter() === mapName ? null : mapName)}
                      >
                        <div class={styles.mapDot} style={{ background: active() ? color : "var(--ms-text-dimmer)" }} />
                        {mapName}
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* Clear */}
            <Show when={hasFilters()}>
              <button class={styles.clearButton} onClick={clearFilters}>
                <Icons.X /> Clear
              </button>
            </Show>
          </div>
        </header>

        {/* ── Main Content ── */}
        <div class={styles.mainContent}>
          <div class={styles.tableArea}>
            {/* Column Headers */}
            <div class={styles.tableHeader}>
              <SortHeader label="MISSION" sortKey="name" currentSort={sortBy()} currentDir={sortDir()} onSort={handleSort} />
              <SortHeader label="DATE" sortKey="date" currentSort={sortBy()} currentDir={sortDir()} onSort={handleSort} />
              <SortHeader label="DURATION" sortKey="duration" currentSort={sortBy()} currentDir={sortDir()} onSort={handleSort} />
              <span class={styles.colLabel}>PLAYERS</span>
              <span class={styles.colLabel}>KILLS</span>
              <span class={styles.colLabel}>TAG</span>
              <span class={styles.colLabelRight}>STATUS</span>
            </div>

            {/* Rows */}
            <div class={styles.tableBody} data-testid="operations-list">
              <Show when={loading()}>
                <div data-testid="loading-indicator" style={{
                  display: "flex", "align-items": "center", "justify-content": "center",
                  padding: "40px", color: "var(--ms-text-dim)", "font-family": "var(--ms-font-mono)",
                  "font-size": "12px",
                }}>
                  {t("loading")}
                </div>
              </Show>
              <Show when={!loading() && filtered().length === 0}>
                <div class={styles.emptyState}>
                  <Icons.Search />
                  <span class={styles.emptyText}>{t("no_missions_found")}</span>
                  <span class={styles.emptyHint}>{t("adjust_filters")}</span>
                </div>
              </Show>
              <For each={filtered()}>
                {(op, i) => (
                  <MissionRow
                    op={op}
                    selected={selectedId() === op.id}
                    onSelect={setSelectedId}
                    onLaunch={handleLaunch}
                    index={i()}
                  />
                )}
              </For>
            </div>

            {/* Footer */}
            <div class={styles.footer}>
              <div class={styles.footerLeft}>
                <a href="https://github.com/OCAP2/web" target="_blank" rel="noopener noreferrer" class={styles.footerGithub}>
                  <Icons.GitHub />
                  <span>OCAP2</span>
                  <Icons.ExternalLink />
                </a>
                <div class={styles.dividerShort} />
                <div class={styles.footerVersions}>
                  <span class={styles.footerVersion}>
                    Server <span class={styles.footerVersionValue}>{serverVersion()}</span>
                  </span>
                </div>
                <div class={styles.dividerShort} />
                <span class={styles.footerMadeWith}>
                  Made with <span class={styles.footerHeart}><Icons.Heart /></span> for the Arma community
                </span>
              </div>
              <span class={styles.footerCenter}>
                {filtered().length} of {operations().length} missions
              </span>
              <div class={styles.footerRight}>
                <div class={styles.footerShortcut}>
                  <kbd class={styles.footerKbd}>Esc</kbd>
                  <span class={styles.footerAction}>{t("deselect")}</span>
                </div>
                <div class={styles.footerShortcut}>
                  <kbd class={styles.footerKbd}>/</kbd>
                  <span class={styles.footerAction}>{t("search_shortcut")}</span>
                </div>
                <div class={styles.footerShortcut}>
                  <kbd class={styles.footerKbd}>Enter</kbd>
                  <span class={styles.footerAction}>{t("open_shortcut")}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Detail Sidebar ── */}
          <Show when={selectedOp()}>
            {(op) => (
              <DetailSidebar
                op={op()}
                onLaunch={handleLaunch}
                onClose={() => setSelectedId(null)}
                t={t}
              />
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}
