import type { JSX } from "solid-js";
import type { MapInfo } from "./types";
import { MAP_STATUS_COLORS } from "./constants";
import { formatWorldSize, formatFileSize, totalDiskMB, statusLabelKey } from "./helpers";
import { useI18n } from "../../hooks/useLocale";
import styles from "./MapManager.module.css";

export function MapRow(props: {
  map: MapInfo;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const disk = () => totalDiskMB(props.map.files);

  return (
    <div
      class={styles.row}
      classList={{ [styles.rowSelected]: props.selected }}
      onClick={() => props.onSelect()}
    >
      <span class={styles.rowName}>{props.map.name}</span>
      <span class={styles.rowSize}>
        {props.map.worldSize ? formatWorldSize(props.map.worldSize) : "—"}
      </span>
      <span class={styles.rowLayers}>
        {props.map.featureLayers?.length ?? 0}
      </span>
      <span class={styles.rowDisk}>
        {disk() > 0 ? formatFileSize(disk() * 1_048_576) : "—"}
      </span>
      <span
        class={styles.rowStatus}
        style={{ color: MAP_STATUS_COLORS[props.map.status] }}
      >
        ● {t(statusLabelKey(props.map.status))}
      </span>
    </div>
  );
}
