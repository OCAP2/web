import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { useI18n } from "../../hooks/useLocale";
import { STATUS_MAP } from "./constants";
import { getTagColor } from "./helpers";
import { Icons } from "./icons";
import styles from "./RecordingSelector.module.css";

export function StatPill(props: { icon: JSX.Element; value: string | number; label: string; class?: string }) {
  return (
    <div class={`${styles.statPill}${props.class ? ` ${props.class}` : ""}`}>
      <div class={styles.statPillValue}>
        <span class={styles.statPillIcon}>{props.icon}</span>
        <span class={styles.statPillNumber}>{props.value}</span>
      </div>
      <span class={styles.statPillLabel}>{props.label}</span>
    </div>
  );
}

export function TagBadge(props: { tag: string; clickable?: boolean; active?: boolean; onClick?: () => void; "data-testid"?: string }) {
  const tc = () => getTagColor(props.tag);
  const isActive = () => props.active !== false;
  return (
    <button
      class={`${styles.tagBadge} ${props.clickable ? styles.tagBadgeClickable : ""}`}
      data-testid={props["data-testid"]}
      style={{
        color: isActive() ? tc().color : "var(--text-dimmer)",
        background: isActive() ? tc().bg : "rgba(255,255,255,0.02)",
        "border-color": isActive() ? tc().border : "rgba(255,255,255,0.05)",
      }}
      onClick={() => props.onClick?.()}
    >
      {props.tag}
    </button>
  );
}

export function StatusBadge(props: { status: string }) {
  const { t } = useI18n();
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
      {t(info().labelKey)}
    </div>
  );
}

export function SortHeader(props: {
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
