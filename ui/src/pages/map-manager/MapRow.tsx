import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { MapInfo } from "./types";
import { MAP_STATUS_COLORS } from "./constants";
import { mapHue, formatWorldSize } from "./helpers";
import styles from "./MapManager.module.css";

export function MapRow(props: {
  map: MapInfo;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const hue = () => mapHue(props.map.name);
  const color = () => `hsl(${hue()}, 55%, 55%)`;

  return (
    <div
      class={styles.row}
      classList={{ [styles.rowSelected]: props.selected }}
      onClick={props.onSelect}
    >
      <span class={styles.rowDot} style={{ background: color() }} />
      <span class={styles.rowName}>{props.map.name}</span>
      <Show when={props.map.worldSize}>
        <span class={styles.rowSize}>{formatWorldSize(props.map.worldSize!)}</span>
      </Show>
      <span
        class={styles.rowStatus}
        style={{ color: MAP_STATUS_COLORS[props.map.status] }}
      >
        {props.map.status}
      </span>
    </div>
  );
}
