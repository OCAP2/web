import { Show } from "solid-js";
import type { Recording } from "../../data/types";
import { useI18n } from "../../hooks/useLocale";
import { GlobeIcon, UsersIcon, CrosshairIcon, PlayIcon } from "../../components/Icons";
import { formatDuration, formatDate, relativeDate, getMapColor, getStatusInfo, isRecordingReady } from "./helpers";
import { TagBadge, StatusBadge } from "./components";
import styles from "./RecordingSelector.module.css";

export function RecordingRow(props: {
  rec: Recording;
  selected: boolean;
  onSelect: (id: string) => void;
  onLaunch: (rec: Recording) => void;
  index: number;
  showPlayers?: boolean;
  showKills?: boolean;
  gridColumns?: string;
  worldDisplayName?: string;
}) {
  const { locale } = useI18n();
  const mapColor = () => getMapColor(props.rec.worldName);
  const status = () => getStatusInfo(props.rec);
  const ready = () => isRecordingReady(props.rec);

  return (
    <div
      data-testid={`recording-${props.rec.id}`}
      class={`${styles.missionRow} ${props.selected ? styles.missionRowSelected : ""}`}
      style={props.gridColumns ? { "grid-template-columns": props.gridColumns } : undefined}
      onClick={() => props.onSelect(props.rec.id)}
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
          <GlobeIcon />
        </div>
        <div class={styles.rowMissionInfo}>
          <div class={styles.rowMissionName}>{props.rec.missionName}</div>
          <div class={styles.rowMapName}>
            {props.worldDisplayName ?? props.rec.worldName}
            <Show when={props.worldDisplayName && props.worldDisplayName !== props.rec.worldName}>
              <span class={styles.rowMapSystemName}>{props.rec.worldName}</span>
            </Show>
          </div>
        </div>
      </div>

      {/* Date */}
      <div class={styles.rowDate}>
        <span class={styles.rowDateValue}>{formatDate(props.rec.date, locale())}</span>
        <span class={styles.rowDateRelative}>{relativeDate(props.rec.date, locale())}</span>
      </div>

      {/* Duration */}
      <div class={styles.rowDuration}>{formatDuration(props.rec.missionDuration)}</div>

      <Show when={props.showPlayers}>
        <div class={styles.rowPlayers}>
          <span class={styles.rowPlayersIcon}><UsersIcon /></span>
          <span class={styles.rowPlayersValue}>{(props.rec.playerCount ?? 0) > 0 ? props.rec.playerCount : "\u2014"}</span>
        </div>
      </Show>

      <Show when={props.showKills}>
        <div class={styles.rowKills}>
          <span class={styles.rowKillsIcon}><CrosshairIcon /></span>
          <span class={styles.rowKillsValue} style={{ color: (props.rec.killCount ?? 0) > 0 ? "var(--text-muted)" : "var(--text-dimmer)" }}>
            {(props.rec.killCount ?? 0) > 0 ? props.rec.killCount : "\u2014"}
          </span>
        </div>
      </Show>

      {/* Tag */}
      <Show when={props.rec.tag} fallback={<span />}>
        <TagBadge tag={props.rec.tag!} />
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
            onClick={(e) => { e.stopPropagation(); props.onLaunch(props.rec); }}
          >
            <PlayIcon />
          </button>
        </Show>
      </div>
    </div>
  );
}
