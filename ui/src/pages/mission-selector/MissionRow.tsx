import { Show } from "solid-js";
import type { Operation } from "../../data/types";
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

      {/* Players — uncomment when data is available
      <div class={styles.rowPlayers}>
        <span class={styles.rowPlayersIcon}><Icons.Users /></span>
        <span class={styles.rowPlayersValue}>&mdash;</span>
      </div>
      */}

      {/* Kills — uncomment when data is available
      <div class={styles.rowKills}>
        <span class={styles.rowKillsIcon}><Icons.Crosshair /></span>
        <span class={styles.rowKillsValue} style={{ color: "var(--ms-text-dimmer)" }}>&mdash;</span>
      </div>
      */}

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
