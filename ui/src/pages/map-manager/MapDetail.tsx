import type { JSX } from "solid-js";
import { Show, For } from "solid-js";
import type { MapInfo } from "./types";
import { MAP_STATUS_COLORS, OUTPUT_FILES, STYLE_VARIANTS } from "./constants";
import { mapHue, formatWorldSize } from "./helpers";
import {
  XIcon,
  GlobeIcon,
  TrashIcon,
} from "../../components/Icons";
import styles from "./MapDetail.module.css";

export function MapDetail(props: {
  map: MapInfo;
  baseUrl: string;
  onClose: () => void;
  onDelete: () => void;
}): JSX.Element {
  const hue = () => mapHue(props.map.name);

  return (
    <div class={styles.sidebar}>
      {/* Hero */}
      <div class={styles.hero}>
        <Show
          when={props.map.hasPreview}
          fallback={
            <div
              class={styles.heroPlaceholder}
              style={{ background: `hsl(${hue()}, 25%, 15%)` }}
            >
              <GlobeIcon size={48} />
            </div>
          }
        >
          <img
            src={`${props.baseUrl}/images/maps/${props.map.name}/preview_256.png`}
            alt={props.map.name}
            class={styles.heroImg}
          />
        </Show>
        <div class={styles.heroOverlay}>
          <h2 class={styles.heroTitle}>{props.map.name}</h2>
        </div>
        <button class={styles.heroClose} onClick={props.onClose}>
          <XIcon size={18} />
        </button>
      </div>

      {/* Info */}
      <div class={styles.content}>
        <div class={styles.infoGrid}>
          <div class={styles.infoItem}>
            <span class={styles.infoLabel}>Status</span>
            <span
              class={styles.infoValue}
              style={{ color: MAP_STATUS_COLORS[props.map.status] }}
            >
              {props.map.status}
            </span>
          </div>
          <Show when={props.map.worldSize}>
            <div class={styles.infoItem}>
              <span class={styles.infoLabel}>World Size</span>
              <span class={styles.infoValue}>
                {formatWorldSize(props.map.worldSize!)}
              </span>
            </div>
          </Show>
        </div>

        {/* Output files */}
        <div class={styles.section}>
          <h4 class={styles.sectionTitle}>Tile Layers</h4>
          <div class={styles.fileList}>
            <For each={OUTPUT_FILES}>
              {(f) => (
                <div class={styles.fileItem}>
                  <span>{f.label}</span>
                  <span class={styles.fileCheck}>
                    {f.name}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Styles */}
        <div class={styles.section}>
          <h4 class={styles.sectionTitle}>Style Variants</h4>
          <div class={styles.fileList}>
            <For each={STYLE_VARIANTS}>
              {(v) => (
                <div class={styles.fileItem}>
                  <span>{v.label}</span>
                  <span class={styles.fileCheck}>{v.file}</span>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Actions */}
        <div class={styles.actions}>
          <button class={styles.deleteBtn} onClick={props.onDelete}>
            <TrashIcon size={14} /> Delete Map
          </button>
        </div>
      </div>
    </div>
  );
}
