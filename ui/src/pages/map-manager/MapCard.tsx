import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { MapInfo } from "./types";
import { MAP_STATUS_COLORS } from "./constants";
import { mapHue, formatWorldSize } from "./helpers";
import styles from "./MapManager.module.css";

export function MapCard(props: {
  map: MapInfo;
  selected: boolean;
  baseUrl: string;
  onSelect: () => void;
}): JSX.Element {
  const hue = () => mapHue(props.map.name);
  const statusColor = () => MAP_STATUS_COLORS[props.map.status] ?? "var(--text-dimmer)";

  return (
    <div
      class={styles.card}
      classList={{ [styles.cardSelected]: props.selected }}
      onClick={props.onSelect}
    >
      <div
        class={styles.cardPreview}
        style={{
          background: `linear-gradient(135deg, hsl(${hue()}, 22%, 11%), hsl(${(hue() + 40) % 360}, 18%, 7%))`,
        }}
      >
        <Show
          when={props.map.hasPreview}
          fallback={<span class={styles.cardNoPreview}>No preview</span>}
        >
          <img
            src={`${props.baseUrl}/images/maps/${props.map.name}/preview_256.png`}
            alt={props.map.name}
            class={styles.cardImg}
            loading="lazy"
          />
        </Show>
        <span
          class={styles.cardStatusBadge}
          style={{
            background: `${statusColor()}14`,
            color: statusColor(),
            border: `1px solid ${statusColor()}22`,
          }}
        >
          {props.map.status}
        </span>
      </div>
      <div class={styles.cardBody}>
        <span class={styles.cardName}>{props.map.name}</span>
        <div class={styles.cardMeta}>
          <Show when={props.map.worldSize}>
            <span class={styles.cardMetaItem}>
              {formatWorldSize(props.map.worldSize!)}
            </span>
            <span class={styles.cardMetaSep}>&middot;</span>
          </Show>
          <Show when={props.map.featureLayers?.length}>
            <span class={styles.cardLayers}>
              {props.map.featureLayers!.length} layers
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}
