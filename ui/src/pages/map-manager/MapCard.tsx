import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { MapInfo } from "./types";
import { MAP_STATUS_COLORS } from "./constants";
import { mapHue, formatWorldSize } from "./helpers";
import { GlobeIcon } from "../../components/Icons";
import styles from "./MapManager.module.css";

export function MapCard(props: {
  map: MapInfo;
  selected: boolean;
  baseUrl: string;
  onSelect: () => void;
}): JSX.Element {
  const hue = () => mapHue(props.map.name);
  const color = () => `hsl(${hue()}, 55%, 55%)`;

  return (
    <div
      class={styles.card}
      classList={{ [styles.cardSelected]: props.selected }}
      onClick={props.onSelect}
    >
      <div class={styles.cardPreview} style={{ "border-color": color() }}>
        <Show
          when={props.map.hasPreview}
          fallback={
            <div
              class={styles.cardPlaceholder}
              style={{ background: `hsl(${hue()}, 25%, 15%)` }}
            >
              <GlobeIcon size={32} />
            </div>
          }
        >
          <img
            src={`${props.baseUrl}/images/maps/${props.map.name}/preview_256.png`}
            alt={props.map.name}
            class={styles.cardImg}
            loading="lazy"
          />
        </Show>
      </div>
      <div class={styles.cardBody}>
        <span class={styles.cardName}>{props.map.name}</span>
        <div class={styles.cardMeta}>
          <Show when={props.map.worldSize}>
            <span>{formatWorldSize(props.map.worldSize!)}</span>
          </Show>
          <span
            class={styles.cardStatus}
            style={{ color: MAP_STATUS_COLORS[props.map.status] }}
          >
            {props.map.status}
          </span>
        </div>
      </div>
    </div>
  );
}
