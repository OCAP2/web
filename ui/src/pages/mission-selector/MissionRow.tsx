import { Show } from "solid-js";
import type { Operation } from "../../data/types";
import { useI18n } from "../../hooks/useLocale";
import { Icons } from "./icons";
import { formatDuration, formatDate, relativeDate, getMapColor, getStatusInfo, isOpReady } from "./helpers";
import { TagBadge, StatusBadge } from "./components";
import styles from "./MissionSelector.module.css";

export function MissionRow(props: {
  op: Operation;
  selected: boolean;
  onSelect: (id: string) => void;
  onLaunch: (op: Operation) => void;
  index: number;
  showPlayers?: boolean;
  showKills?: boolean;
  gridColumns?: string;
}) {
  const { locale } = useI18n();
  const mapColor = () => getMapColor(props.op.worldName);
  const status = () => getStatusInfo(props.op);
  const ready = () => isOpReady(props.op);

  return (
    <div
      data-testid={`operation-${props.op.id}`}
      class={`${styles.missionRow} ${props.selected ? styles.missionRowSelected : ""}`}
      style={props.gridColumns ? { "grid-template-columns": props.gridColumns } : undefined}
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
        <span class={styles.rowDateValue}>{formatDate(props.op.date, locale())}</span>
        <span class={styles.rowDateRelative}>{relativeDate(props.op.date, locale())}</span>
      </div>

      {/* Duration */}
      <div class={styles.rowDuration}>{formatDuration(props.op.missionDuration)}</div>

      <Show when={props.showPlayers}>
        <div class={styles.rowPlayers}>
          <span class={styles.rowPlayersIcon}><Icons.Users /></span>
          <span class={styles.rowPlayersValue}>{(props.op.playerCount ?? 0) > 0 ? props.op.playerCount : "\u2014"}</span>
        </div>
      </Show>

      <Show when={props.showKills}>
        <div class={styles.rowKills}>
          <span class={styles.rowKillsIcon}><Icons.Crosshair /></span>
          <span class={styles.rowKillsValue} style={{ color: (props.op.killCount ?? 0) > 0 ? "var(--text-muted)" : "var(--text-dimmer)" }}>
            {(props.op.killCount ?? 0) > 0 ? props.op.killCount : "\u2014"}
          </span>
        </div>
      </Show>

      {/* Tag */}
      <Show when={props.op.tag} fallback={<span />}>
        <TagBadge tag={props.op.tag!} />
      </Show>

      {/* Status */}
      <div class={styles.rowStatus}>
        <StatusBadge status={status().key} />
      </div>

      {/* Play */}
      <div class={styles.rowPlay}>
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
